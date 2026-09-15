ALTER TABLE public.comentarios
  ADD COLUMN IF NOT EXISTS eh_caso boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_caso text,
  ADD COLUMN IF NOT EXISTS resolvido_em timestamptz;

ALTER TABLE public.comentarios DROP CONSTRAINT IF EXISTS comentarios_status_caso_chk;
ALTER TABLE public.comentarios ADD CONSTRAINT comentarios_status_caso_chk
  CHECK (status_caso IS NULL OR status_caso IN ('aberta','feita','revisada','aprovada'));

-- Marcações já existentes do cliente viram casos abertos.
UPDATE public.comentarios
SET eh_caso = true, status_caso = 'aberta'
WHERE autor_papel = 'cliente' AND eh_caso = false AND status_caso IS NULL;

-- 2) cliente_comentar com p_eh_caso
DROP FUNCTION IF EXISTS public.cliente_comentar(text, text, numeric, numeric, jsonb);

CREATE FUNCTION public.cliente_comentar(
  p_token text,
  p_texto text,
  p_pin_x numeric DEFAULT NULL,
  p_pin_y numeric DEFAULT NULL,
  p_anotacao_json jsonb DEFAULT NULL,
  p_eh_caso boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_id uuid; v_nome text;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Esta peça não está aberta para comentários'; END IF;
  IF coalesce(trim(p_texto),'') = '' THEN RAISE EXCEPTION 'Comentário vazio'; END IF;
  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;
  INSERT INTO public.comentarios (peca_id, versao_id, autor_cliente_contato_id, autor_papel, texto,
    pin_x, pin_y, anotacao_json, visivel_para_cliente, editavel, eh_caso, status_caso)
  VALUES (v_peca.id, v_versao, v_a.cliente_contato_id, 'cliente', p_texto, p_pin_x, p_pin_y, p_anotacao_json, true, true,
    COALESCE(p_eh_caso, true),
    CASE WHEN COALESCE(p_eh_caso, true) THEN 'aberta' ELSE NULL END)
  RETURNING id INTO v_id;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (v_peca.id, v_versao, 'comentou', COALESCE(v_nome,'Cliente'), 'cliente');
  RETURN v_id;
END; $function$;

REVOKE ALL ON FUNCTION public.cliente_comentar(text, text, numeric, numeric, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_comentar(text, text, numeric, numeric, jsonb, boolean) TO anon, authenticated;

-- 3) decisão por caso
CREATE OR REPLACE FUNCTION public.cliente_decidir_caso(p_token text, p_comentario_id uuid, p_decisao text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    UPDATE public.comentarios SET status_caso = 'aprovada', resolvido_em = now(), updated_at = now()
    WHERE id = v_c.id;
  ELSIF p_decisao = 'reabrir' THEN
    UPDATE public.comentarios SET status_caso = 'aberta', resolvido_em = NULL, updated_at = now()
    WHERE id = v_c.id;
  ELSE
    RAISE EXCEPTION 'Decisão inválida';
  END IF;

  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (v_peca.id, v_c.versao_id, 'comentou', COALESCE(v_nome,'Cliente'), 'cliente',
    CASE WHEN p_decisao = 'aprovar' THEN 'aprovou uma marcação' ELSE 'reabriu uma marcação' END);
END; $function$;

REVOKE ALL ON FUNCTION public.cliente_decidir_caso(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_decidir_caso(text, uuid, text) TO anon, authenticated;

-- Finalização compartilhada (modo um/todos)
CREATE OR REPLACE FUNCTION public.finalizar_aprovacao_cliente(p_acesso_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_nome text;
  v_total int; v_decididos int; v_aprovados int; v_devolvidos int; v_handoff uuid;
BEGIN
  SELECT * INTO v_a FROM public.acessos_cliente WHERE id = p_acesso_id;
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
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

REVOKE ALL ON FUNCTION public.finalizar_aprovacao_cliente(uuid) FROM PUBLIC;

-- 4) cliente_aprovar com trava de casos abertos
CREATE OR REPLACE FUNCTION public.cliente_aprovar(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_marcacoes int; v_abertos int;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  IF v_a.decisao IS NOT NULL THEN RAISE EXCEPTION 'Você já respondeu esta rodada'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;

  SELECT count(*) INTO v_abertos FROM public.comentarios c
  WHERE c.peca_id = v_peca.id AND c.eh_caso = true AND c.status_caso = 'aberta'
    AND c.versao_id IS NOT DISTINCT FROM v_versao;
  IF v_abertos > 0 THEN
    RAISE EXCEPTION 'Há marcações não aprovadas — decida cada uma antes de aprovar.';
  END IF;

  SELECT count(*) INTO v_marcacoes FROM public.comentarios c
  WHERE c.peca_id = v_peca.id
    AND c.autor_cliente_contato_id = v_a.cliente_contato_id
    AND c.versao_id IS NOT DISTINCT FROM v_versao
    AND COALESCE(c.status_caso,'') <> 'aprovada';
  IF v_marcacoes > 0 THEN
    RAISE EXCEPTION 'Você marcou alterações nesta peça. Use "Voltar/Aguardar e enviar para o atendimento" em vez de aprovar.';
  END IF;

  PERFORM public.finalizar_aprovacao_cliente(v_a.id);
END; $function$;

REVOKE ALL ON FUNCTION public.cliente_aprovar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_aprovar(text) TO anon, authenticated;

-- 5) aprovar tudo
CREATE OR REPLACE FUNCTION public.cliente_aprovar_tudo(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  IF v_a.decisao IS NOT NULL THEN RAISE EXCEPTION 'Você já respondeu esta rodada'; END IF;

  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;

  UPDATE public.comentarios
  SET status_caso = 'aprovada', resolvido_em = now(), updated_at = now()
  WHERE peca_id = v_peca.id AND eh_caso = true AND status_caso = 'aberta'
    AND versao_id IS NOT DISTINCT FROM v_versao;

  PERFORM public.finalizar_aprovacao_cliente(v_a.id);
END; $function$;

REVOKE ALL ON FUNCTION public.cliente_aprovar_tudo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_aprovar_tudo(text) TO anon, authenticated;