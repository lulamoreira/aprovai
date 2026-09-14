ALTER TABLE public.pecas ADD COLUMN IF NOT EXISTS modo_aprovacao text NOT NULL DEFAULT 'todos';
ALTER TABLE public.acessos_cliente ADD COLUMN IF NOT EXISTS handoff_id uuid REFERENCES public.handoffs(id) ON DELETE SET NULL;
ALTER TABLE public.acessos_cliente ADD COLUMN IF NOT EXISTS decisao text;
ALTER TABLE public.acessos_cliente ADD COLUMN IF NOT EXISTS decidido_em timestamptz;
CREATE INDEX IF NOT EXISTS idx_acessos_cliente_handoff ON public.acessos_cliente(handoff_id);

ALTER TYPE public.tipo_notificacao ADD VALUE IF NOT EXISTS 'lembrete_aprovacao';

CREATE OR REPLACE FUNCTION public.enviar_peca(p_peca_id uuid, p_contato_ids uuid[] DEFAULT NULL::uuid[], p_modo_aprovacao text DEFAULT 'todos')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_peca public.pecas; v_de public.papel_ator; v_para public.papel_ator;
  v_novo public.piece_status; v_versao uuid; v_handoff uuid; v_contato record; v_cliente_id uuid; v_tok text;
  v_modo text;
BEGIN
  v_modo := CASE WHEN p_modo_aprovacao = 'um' THEN 'um' ELSE 'todos' END;

  SELECT * INTO v_peca FROM public.pecas WHERE id = p_peca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada'; END IF;

  IF v_peca.status = 'criacao_ajustando' THEN
    v_de := 'criacao'; v_para := 'atendimento'; v_novo := 'aguardando_atendimento';
    IF NOT (public.has_role(auth.uid(),'criacao') OR public.has_role(auth.uid(),'admin')) THEN
      RAISE EXCEPTION 'Apenas a Criação pode enviar agora'; END IF;
    IF v_peca.versao_atual < 1 THEN RAISE EXCEPTION 'Suba uma arte antes de enviar'; END IF;
  ELSIF v_peca.status = 'aguardando_atendimento' THEN
    v_de := 'atendimento'; v_para := 'cliente'; v_novo := 'aguardando_cliente';
    IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
      RAISE EXCEPTION 'Apenas o Atendimento pode enviar agora'; END IF;
  ELSIF v_peca.status = 'retorno_atendimento' THEN
    v_de := 'atendimento'; v_para := 'criacao'; v_novo := 'criacao_ajustando';
    IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
      RAISE EXCEPTION 'Apenas o Atendimento pode enviar agora'; END IF;
  ELSE
    RAISE EXCEPTION 'A peça não pode ser enviada neste status';
  END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = p_peca_id AND numero = v_peca.versao_atual;

  INSERT INTO public.handoffs (peca_id, versao_id, de_papel, para_papel, enviado_por)
  VALUES (p_peca_id, v_versao, v_de, v_para, auth.uid()) RETURNING id INTO v_handoff;

  UPDATE public.comentarios SET handoff_id = v_handoff
  WHERE peca_id = p_peca_id AND versao_id IS NOT DISTINCT FROM v_versao
    AND autor_papel = v_de AND handoff_id IS NULL;

  UPDATE public.pecas SET status = v_novo WHERE id = p_peca_id;

  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (p_peca_id, v_versao, 'enviou', public.nome_ator(), v_de, 'Enviado para ' || v_para::text);

  IF v_para = 'cliente' THEN
    UPDATE public.pecas SET modo_aprovacao = v_modo WHERE id = p_peca_id;

    SELECT c.cliente_id INTO v_cliente_id FROM public.campanhas c WHERE c.id = v_peca.campanha_id;

    IF p_contato_ids IS NOT NULL AND array_length(p_contato_ids, 1) > 0 THEN
      IF EXISTS (
        SELECT 1 FROM unnest(p_contato_ids) AS x(id)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.cliente_contatos cc
          WHERE cc.id = x.id AND cc.cliente_id = v_cliente_id
        )
      ) THEN
        RAISE EXCEPTION 'Contato informado não pertence ao cliente desta campanha';
      END IF;
    END IF;

    FOR v_contato IN
      SELECT * FROM public.cliente_contatos
      WHERE cliente_id = v_cliente_id
        AND (p_contato_ids IS NULL OR array_length(p_contato_ids, 1) IS NULL OR id = ANY(p_contato_ids))
    LOOP
      v_tok := encode(extensions.gen_random_bytes(24),'hex');
      INSERT INTO public.acessos_cliente (peca_id, cliente_contato_id, token, handoff_id, decisao)
      VALUES (p_peca_id, v_contato.id, v_tok, v_handoff, NULL);
      INSERT INTO public.notificacoes (destinatario_cliente_contato_id, peca_id, tipo, titulo, mensagem)
      VALUES (v_contato.id, p_peca_id, 'pronta_aprovacao', 'Peça pronta para aprovação',
        v_peca.nome || ' está aguardando sua avaliação.');
    END LOOP;

    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, p_peca_id, 'enviada_cliente', 'Peça enviada ao cliente', v_peca.nome
    FROM public.user_roles ur WHERE ur.role IN ('atendimento','admin');
  ELSIF v_para = 'criacao' THEN
    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, p_peca_id, 'enviada_correcao', 'Peça enviada para correção', v_peca.nome
    FROM public.user_roles ur WHERE ur.role IN ('criacao','admin');
  ELSE
    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, p_peca_id, 'pronta_aprovacao', 'Peça aguardando atendimento', v_peca.nome
    FROM public.user_roles ur WHERE ur.role IN ('atendimento','admin');
  END IF;
END; $function$;

GRANT EXECUTE ON FUNCTION public.enviar_peca(uuid, uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cliente_aprovar(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_nome text;
  v_total int; v_decididos int; v_aprovados int; v_devolvidos int; v_handoff uuid;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  IF v_a.decisao IS NOT NULL THEN RAISE EXCEPTION 'Você já respondeu esta rodada'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;

  UPDATE public.acessos_cliente SET decisao = 'aprovado', decidido_em = now() WHERE id = v_a.id;

  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (v_peca.id, v_versao, 'aprovou', COALESCE(v_nome,'Cliente'), 'cliente');

  IF COALESCE(v_peca.modo_aprovacao,'todos') = 'um' THEN
    UPDATE public.pecas SET status = 'aprovada' WHERE id = v_peca.id;
    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, v_peca.id, 'aprovada', 'Peça aprovada', v_peca.nome FROM public.user_roles ur;
    RETURN;
  END IF;

  v_handoff := v_a.handoff_id;
  SELECT count(*), count(decisao), count(*) FILTER (WHERE decisao = 'aprovado'), count(*) FILTER (WHERE decisao = 'devolvido')
    INTO v_total, v_decididos, v_aprovados, v_devolvidos
  FROM public.acessos_cliente
  WHERE peca_id = v_peca.id AND ((v_handoff IS NOT NULL AND handoff_id = v_handoff) OR (v_handoff IS NULL AND handoff_id IS NULL));

  IF v_decididos < v_total THEN
    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, v_peca.id, 'aprovada', 'Aprovação parcial',
      COALESCE(v_nome,'Cliente') || ' aprovou ' || v_peca.nome || ' — ' || v_decididos || ' de ' || v_total || ' responderam.'
    FROM public.user_roles ur WHERE ur.role IN ('atendimento','admin');
    RETURN;
  END IF;

  IF v_devolvidos > 0 THEN
    UPDATE public.pecas SET status = 'retorno_atendimento' WHERE id = v_peca.id;
    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, v_peca.id, 'cliente_devolveu', 'Rodada encerrada com devolução', v_peca.nome
    FROM public.user_roles ur WHERE ur.role IN ('atendimento','admin');
  ELSE
    UPDATE public.pecas SET status = 'aprovada' WHERE id = v_peca.id;
    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, v_peca.id, 'aprovada', 'Peça aprovada por todos', v_peca.nome FROM public.user_roles ur;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.cliente_devolver(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_handoff uuid; v_nome text;
  v_total int; v_decididos int; v_rodada uuid;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  IF v_a.decisao IS NOT NULL THEN RAISE EXCEPTION 'Você já respondeu esta rodada'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;

  UPDATE public.acessos_cliente SET decisao = 'devolvido', decidido_em = now() WHERE id = v_a.id;

  INSERT INTO public.handoffs (peca_id, versao_id, de_papel, para_papel)
  VALUES (v_peca.id, v_versao, 'cliente', 'atendimento') RETURNING id INTO v_handoff;

  UPDATE public.comentarios SET handoff_id = v_handoff
  WHERE peca_id = v_peca.id AND versao_id IS NOT DISTINCT FROM v_versao
    AND autor_cliente_contato_id = v_a.cliente_contato_id
    AND autor_papel = 'cliente' AND handoff_id IS NULL;

  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (v_peca.id, v_versao, 'devolveu', COALESCE(v_nome,'Cliente'), 'cliente');

  IF COALESCE(v_peca.modo_aprovacao,'todos') = 'um' THEN
    UPDATE public.pecas SET status = 'retorno_atendimento' WHERE id = v_peca.id;
    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, v_peca.id, 'cliente_devolveu', 'Cliente devolveu com comentários', v_peca.nome
    FROM public.user_roles ur WHERE ur.role IN ('atendimento','admin');
    RETURN;
  END IF;

  v_rodada := v_a.handoff_id;
  SELECT count(*), count(decisao) INTO v_total, v_decididos
  FROM public.acessos_cliente
  WHERE peca_id = v_peca.id AND ((v_rodada IS NOT NULL AND handoff_id = v_rodada) OR (v_rodada IS NULL AND handoff_id IS NULL));

  IF v_decididos < v_total THEN
    INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
    SELECT ur.user_id, v_peca.id, 'cliente_devolveu', 'Resposta parcial',
      COALESCE(v_nome,'Cliente') || ' devolveu ' || v_peca.nome || ' — ' || v_decididos || ' de ' || v_total || ' responderam.'
    FROM public.user_roles ur WHERE ur.role IN ('atendimento','admin');
    RETURN;
  END IF;

  UPDATE public.pecas SET status = 'retorno_atendimento' WHERE id = v_peca.id;
  INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
  SELECT ur.user_id, v_peca.id, 'cliente_devolveu', 'Rodada encerrada com devolução', v_peca.nome
  FROM public.user_roles ur WHERE ur.role IN ('atendimento','admin');
END; $function$;

CREATE OR REPLACE FUNCTION public.cobrar_aprovador(p_peca_id uuid, p_cliente_contato_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_peca public.pecas; v_ok boolean;
BEGIN
  IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Apenas o Atendimento pode enviar lembretes';
  END IF;
  SELECT * INTO v_peca FROM public.pecas WHERE id = p_peca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.acessos_cliente ac
    WHERE ac.peca_id = p_peca_id AND ac.cliente_contato_id = p_cliente_contato_id AND ac.decisao IS NULL
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'Este aprovador não está pendente nesta rodada'; END IF;

  INSERT INTO public.notificacoes (destinatario_cliente_contato_id, peca_id, tipo, titulo, mensagem)
  VALUES (p_cliente_contato_id, p_peca_id, 'lembrete_aprovacao', 'Lembrete gentil de aprovação',
    'Oi! Quando puder, dá uma olhadinha na peça ' || v_peca.nome || ' pra gente seguir? 🙂');
END; $function$;

GRANT EXECUTE ON FUNCTION public.cobrar_aprovador(uuid, uuid) TO authenticated;