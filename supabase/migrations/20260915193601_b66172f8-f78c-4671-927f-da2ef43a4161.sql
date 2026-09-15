CREATE OR REPLACE FUNCTION public.enviar_peca(p_peca_id uuid, p_contato_ids uuid[] DEFAULT NULL::uuid[], p_modo_aprovacao text DEFAULT 'todos'::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_peca public.pecas; v_de public.papel_ator; v_para public.papel_ator;
  v_novo public.piece_status; v_versao uuid; v_handoff uuid; v_contato record; v_cliente_id uuid; v_tok text;
  v_modo text; v_abertos int; v_nao_revisados int;
BEGIN
  v_modo := CASE WHEN p_modo_aprovacao = 'um' THEN 'um' ELSE 'todos' END;

  SELECT * INTO v_peca FROM public.pecas WHERE id = p_peca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = p_peca_id AND numero = v_peca.versao_atual;

  SELECT count(*) INTO v_abertos FROM public.comentarios c
  WHERE c.peca_id = p_peca_id AND c.eh_caso = true AND c.status_caso = 'aberta'
    AND c.versao_id IS NOT DISTINCT FROM v_versao;

  SELECT count(*) INTO v_nao_revisados FROM public.comentarios c
  WHERE c.peca_id = p_peca_id AND c.eh_caso = true
    AND c.status_caso IS DISTINCT FROM 'revisada'
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
    IF v_nao_revisados > 0 THEN
      RAISE EXCEPTION 'Revise todas as marcações (marque "Revisado") antes de enviar ao cliente.'; END IF;
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