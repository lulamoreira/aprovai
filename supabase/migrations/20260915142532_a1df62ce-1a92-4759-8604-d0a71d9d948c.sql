CREATE OR REPLACE FUNCTION public.cliente_aprovar(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_nome text;
  v_total int; v_decididos int; v_aprovados int; v_devolvidos int; v_handoff uuid;
  v_marcacoes int;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  IF v_a.decisao IS NOT NULL THEN RAISE EXCEPTION 'Você já respondeu esta rodada'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;

  -- Trava: quem marcou alterações nesta versão não pode aprovar.
  SELECT count(*) INTO v_marcacoes FROM public.comentarios c
  WHERE c.peca_id = v_peca.id
    AND c.autor_cliente_contato_id = v_a.cliente_contato_id
    AND (c.versao_id = v_versao OR (v_versao IS NULL AND c.versao_id IS NULL));
  IF v_marcacoes > 0 THEN
    RAISE EXCEPTION 'Você marcou alterações nesta peça. Use "Voltar/Aguardar e enviar para o atendimento" em vez de aprovar.';
  END IF;

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

REVOKE ALL ON FUNCTION public.cliente_aprovar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_aprovar(text) TO anon, authenticated;