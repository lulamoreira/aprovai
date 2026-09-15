CREATE OR REPLACE FUNCTION public.cliente_decidir_caso(p_token text, p_comentario_id uuid, p_decisao text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_c public.comentarios; v_nome text;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  SELECT * INTO v_c FROM public.comentarios WHERE id = p_comentario_id;
  IF NOT FOUND OR v_c.peca_id <> v_peca.id THEN RAISE EXCEPTION 'Marcação não encontrada'; END IF;
  IF NOT v_c.eh_caso THEN RAISE EXCEPTION 'Este comentário não é uma marcação'; END IF;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;

  IF p_decisao = 'aprovar' THEN
    IF v_c.status_caso IS DISTINCT FROM 'revisada' THEN
      RAISE EXCEPTION 'Só é possível aprovar uma marcação que voltou corrigida.';
    END IF;
    UPDATE public.comentarios SET status_caso = 'aprovada', resolvido_em = now(), updated_at = now()
    WHERE id = v_c.id;
  ELSIF p_decisao IN ('reabrir', 'pedir_correcao') THEN
    IF v_c.status_caso IS DISTINCT FROM 'revisada' THEN
      RAISE EXCEPTION 'Só é possível pedir correção em uma marcação que voltou corrigida.';
    END IF;
    UPDATE public.comentarios SET status_caso = 'aberta', resolvido_em = NULL, updated_at = now()
    WHERE id = v_c.id;
  ELSE
    RAISE EXCEPTION 'Decisão inválida';
  END IF;

  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (v_peca.id, v_c.versao_id, 'comentou', COALESCE(v_nome,'Cliente'), 'cliente',
    CASE WHEN p_decisao = 'aprovar' THEN 'aprovou uma marcação' ELSE 'pediu correção em uma marcação' END);
END; $function$;

CREATE OR REPLACE FUNCTION public.cliente_remover_caso(p_token text, p_comentario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_c public.comentarios; v_nome text;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  SELECT * INTO v_c FROM public.comentarios WHERE id = p_comentario_id AND peca_id = v_peca.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marcação não encontrada'; END IF;
  IF v_c.autor_cliente_contato_id IS DISTINCT FROM v_a.cliente_contato_id THEN
    RAISE EXCEPTION 'Você só pode remover as suas próprias marcações.'; END IF;
  IF NOT v_c.eh_caso THEN RAISE EXCEPTION 'Este comentário não é uma marcação'; END IF;
  IF NOT v_c.editavel THEN RAISE EXCEPTION 'Esta marcação já foi enviada e está bloqueada.'; END IF;
  IF v_c.status_caso IS DISTINCT FROM 'aberta' THEN
    RAISE EXCEPTION 'Só é possível remover uma marcação ainda em aberto.'; END IF;

  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;
  DELETE FROM public.comentarios WHERE id = v_c.id;

  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (v_peca.id, v_c.versao_id, 'comentou', COALESCE(v_nome,'Cliente'), 'cliente',
    'removeu uma marcação');
END; $function$;

GRANT EXECUTE ON FUNCTION public.cliente_remover_caso(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cliente_aprovar_tudo(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid;
        v_abertas int; v_pendentes int;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  IF v_a.decisao IS NOT NULL THEN RAISE EXCEPTION 'Você já respondeu esta rodada'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;

  SELECT count(*) FILTER (WHERE status_caso = 'aberta'),
         count(*) FILTER (WHERE status_caso IS DISTINCT FROM 'aprovada')
    INTO v_abertas, v_pendentes
  FROM public.comentarios
  WHERE peca_id = v_peca.id AND eh_caso = true AND versao_id IS NOT DISTINCT FROM v_versao;

  IF v_abertas > 0 THEN
    RAISE EXCEPTION 'Existem marcações em aberto. Use "Devolver para correção".';
  END IF;
  IF v_pendentes > 0 THEN
    RAISE EXCEPTION 'Decida cada marcação corrigida antes de aprovar a peça.';
  END IF;

  PERFORM public.finalizar_aprovacao_cliente(v_a.id);
END; $function$;