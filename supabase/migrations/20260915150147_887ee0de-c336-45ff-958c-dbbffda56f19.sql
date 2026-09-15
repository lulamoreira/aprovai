ALTER TABLE public.comentarios
  ADD COLUMN IF NOT EXISTS feito_em timestamptz,
  ADD COLUMN IF NOT EXISTS feito_por uuid,
  ADD COLUMN IF NOT EXISTS revisado_em timestamptz,
  ADD COLUMN IF NOT EXISTS revisado_por uuid;

CREATE TABLE IF NOT EXISTS public.cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id uuid REFERENCES public.pecas(id) ON DELETE CASCADE,
  cliente_contato_id uuid REFERENCES public.cliente_contatos(id) ON DELETE CASCADE,
  cobrado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cobrancas_peca_contato_idx ON public.cobrancas (peca_id, cliente_contato_id);

GRANT SELECT ON public.cobrancas TO authenticated;
GRANT ALL ON public.cobrancas TO service_role;
ALTER TABLE public.cobrancas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "internos leem cobrancas" ON public.cobrancas;
CREATE POLICY "internos leem cobrancas" ON public.cobrancas
  FOR SELECT TO authenticated USING (public.is_interno());

-- 3) criação marca caso como feito
CREATE OR REPLACE FUNCTION public.criacao_marcar_feito(p_comentario_id uuid, p_feito boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_c public.comentarios; v_peca public.pecas;
BEGIN
  IF NOT (public.has_role(auth.uid(),'criacao') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Apenas a Criação pode marcar correções';
  END IF;
  SELECT * INTO v_c FROM public.comentarios WHERE id = p_comentario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marcação não encontrada'; END IF;
  IF NOT v_c.eh_caso THEN RAISE EXCEPTION 'Este comentário não é uma marcação'; END IF;
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_c.peca_id;
  IF v_peca.status <> 'criacao_ajustando' THEN RAISE EXCEPTION 'A peça não está com a Criação'; END IF;

  IF p_feito THEN
    UPDATE public.comentarios
    SET status_caso = 'feita', feito_em = now(), feito_por = auth.uid(), updated_at = now()
    WHERE id = v_c.id;
  ELSE
    UPDATE public.comentarios
    SET status_caso = 'aberta', feito_em = NULL, feito_por = NULL, updated_at = now()
    WHERE id = v_c.id;
  END IF;
END; $function$;

REVOKE ALL ON FUNCTION public.criacao_marcar_feito(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criacao_marcar_feito(uuid, boolean) TO authenticated;

-- 4) atendimento revisa caso
CREATE OR REPLACE FUNCTION public.atendimento_revisar_caso(p_comentario_id uuid, p_ok boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_c public.comentarios; v_peca public.pecas;
BEGIN
  IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Apenas o Atendimento pode revisar correções';
  END IF;
  SELECT * INTO v_c FROM public.comentarios WHERE id = p_comentario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marcação não encontrada'; END IF;
  IF NOT v_c.eh_caso THEN RAISE EXCEPTION 'Este comentário não é uma marcação'; END IF;
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_c.peca_id;
  IF v_peca.status <> 'aguardando_atendimento' THEN RAISE EXCEPTION 'A peça não está com o Atendimento'; END IF;

  IF p_ok THEN
    UPDATE public.comentarios
    SET status_caso = 'revisada', revisado_em = now(), revisado_por = auth.uid(), updated_at = now()
    WHERE id = v_c.id;
  ELSE
    UPDATE public.comentarios
    SET status_caso = 'aberta', revisado_em = NULL, revisado_por = NULL, feito_em = NULL, updated_at = now()
    WHERE id = v_c.id;
  END IF;
END; $function$;

REVOKE ALL ON FUNCTION public.atendimento_revisar_caso(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atendimento_revisar_caso(uuid, boolean) TO authenticated;

-- 5) devolver para a criação
CREATE OR REPLACE FUNCTION public.devolver_para_criacao(p_peca_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_peca public.pecas; v_versao uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Apenas o Atendimento pode devolver para a Criação';
  END IF;
  SELECT * INTO v_peca FROM public.pecas WHERE id = p_peca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada'; END IF;
  IF v_peca.status <> 'aguardando_atendimento' THEN RAISE EXCEPTION 'A peça não está com o Atendimento'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = p_peca_id AND numero = v_peca.versao_atual;

  INSERT INTO public.handoffs (peca_id, versao_id, de_papel, para_papel, enviado_por)
  VALUES (p_peca_id, v_versao, 'atendimento', 'criacao', auth.uid());

  UPDATE public.pecas SET status = 'criacao_ajustando' WHERE id = p_peca_id;

  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (p_peca_id, v_versao, 'enviou', public.nome_ator(), 'atendimento', 'Devolvido para a Criação');

  INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
  SELECT ur.user_id, p_peca_id, 'enviada_correcao', 'Peça voltou para correção', v_peca.nome
  FROM public.user_roles ur WHERE ur.role IN ('criacao','admin');
END; $function$;

REVOKE ALL ON FUNCTION public.devolver_para_criacao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.devolver_para_criacao(uuid) TO authenticated;

-- 6) enviar_peca com trava de casos abertos (mesma assinatura)
CREATE OR REPLACE FUNCTION public.enviar_peca(p_peca_id uuid, p_contato_ids uuid[] DEFAULT NULL::uuid[], p_modo_aprovacao text DEFAULT 'todos'::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_peca public.pecas; v_de public.papel_ator; v_para public.papel_ator;
  v_novo public.piece_status; v_versao uuid; v_handoff uuid; v_contato record; v_cliente_id uuid; v_tok text;
  v_modo text; v_abertos int;
BEGIN
  v_modo := CASE WHEN p_modo_aprovacao = 'um' THEN 'um' ELSE 'todos' END;

  SELECT * INTO v_peca FROM public.pecas WHERE id = p_peca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = p_peca_id AND numero = v_peca.versao_atual;

  SELECT count(*) INTO v_abertos FROM public.comentarios c
  WHERE c.peca_id = p_peca_id AND c.eh_caso = true AND c.status_caso = 'aberta'
    AND c.versao_id IS NOT DISTINCT FROM v_versao;

  IF v_peca.status = 'criacao_ajustando' THEN
    v_de := 'criacao'; v_para := 'atendimento'; v_novo := 'aguardando_atendimento';
    IF NOT (public.has_role(auth.uid(),'criacao') OR public.has_role(auth.uid(),'admin')) THEN
      RAISE EXCEPTION 'Apenas a Criação pode enviar agora'; END IF;
    IF v_peca.versao_atual < 1 THEN RAISE EXCEPTION 'Suba uma arte antes de enviar'; END IF;
    IF v_abertos > 0 THEN
      RAISE EXCEPTION 'Marque todas as correções como feitas antes de enviar ao atendimento.'; END IF;
  ELSIF v_peca.status = 'aguardando_atendimento' THEN
    v_de := 'atendimento'; v_para := 'cliente'; v_novo := 'aguardando_cliente';
    IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
      RAISE EXCEPTION 'Apenas o Atendimento pode enviar agora'; END IF;
    IF v_abertos > 0 THEN
      RAISE EXCEPTION 'Há correções não revisadas — revise cada uma ou volte para a criação.'; END IF;
  ELSIF v_peca.status = 'retorno_atendimento' THEN
    v_de := 'atendimento'; v_para := 'criacao'; v_novo := 'criacao_ajustando';
    IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
      RAISE EXCEPTION 'Apenas o Atendimento pode enviar agora'; END IF;
  ELSE
    RAISE EXCEPTION 'A peça não pode ser enviada neste status';
  END IF;

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

-- 7) cobrar_aprovador registra a cobrança (mesma assinatura)
CREATE OR REPLACE FUNCTION public.cobrar_aprovador(p_peca_id uuid, p_cliente_contato_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  INSERT INTO public.cobrancas (peca_id, cliente_contato_id, cobrado_por)
  VALUES (p_peca_id, p_cliente_contato_id, auth.uid());
END; $function$;