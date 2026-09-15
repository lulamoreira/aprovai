ALTER TABLE public.acessos_cliente
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_tentativas int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_bloqueado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS desbloqueado_em timestamptz;

-- Acessos criados antes desta mudança continuam funcionando sem código.
UPDATE public.acessos_cliente SET desbloqueado_em = COALESCE(desbloqueado_em, now())
WHERE pin_hash IS NULL AND desbloqueado_em IS NULL;

CREATE OR REPLACE FUNCTION public.acesso_liberado(p_token text)
RETURNS public.acessos_cliente
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_a public.acessos_cliente;
BEGIN
  v_a := public.acesso_por_token(p_token);
  IF v_a.desbloqueado_em IS NULL THEN
    RAISE EXCEPTION 'Código de aprovação necessário.';
  END IF;
  RETURN v_a;
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_validar_pin(p_token text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_a public.acessos_cliente; v_tent int;
BEGIN
  v_a := public.acesso_por_token(p_token);
  IF v_a.pin_bloqueado THEN
    RAISE EXCEPTION 'Código bloqueado por tentativas. Peça um novo link.';
  END IF;
  IF v_a.desbloqueado_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF v_a.pin_hash IS NULL THEN
    RAISE EXCEPTION 'Nenhum código foi gerado para este link. Peça um novo link.';
  END IF;
  IF v_a.pin_hash = extensions.crypt(COALESCE(trim(p_pin), ''), v_a.pin_hash) THEN
    UPDATE public.acessos_cliente
      SET desbloqueado_em = now(), pin_tentativas = 0
      WHERE id = v_a.id;
    RETURN jsonb_build_object('ok', true);
  END IF;
  v_tent := v_a.pin_tentativas + 1;
  UPDATE public.acessos_cliente
    SET pin_tentativas = v_tent, pin_bloqueado = (v_tent >= 5)
    WHERE id = v_a.id;
  RETURN jsonb_build_object('ok', false, 'tentativas_restantes', GREATEST(5 - v_tent, 0),
                            'bloqueado', v_tent >= 5);
END; $$;

GRANT EXECUTE ON FUNCTION public.cliente_validar_pin(text, text) TO anon, authenticated;

-- Prévia interna (sem código, sem efeitos colaterais)
CREATE OR REPLACE FUNCTION public.cliente_previa(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_out jsonb; v_nome text;
        v_total int; v_decididos int; v_aprovados int;
BEGIN
  IF NOT public.is_interno() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO v_a FROM public.acessos_cliente WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link inválido'; END IF;
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;

  SELECT count(*), count(decisao), count(*) FILTER (WHERE decisao = 'aprovado')
    INTO v_total, v_decididos, v_aprovados
  FROM public.acessos_cliente
  WHERE peca_id = v_a.peca_id
    AND ((v_a.handoff_id IS NOT NULL AND handoff_id = v_a.handoff_id)
      OR (v_a.handoff_id IS NULL AND handoff_id IS NULL));

  SELECT jsonb_build_object(
    'contato', jsonb_build_object('id', v_a.cliente_contato_id, 'nome', v_nome),
    'acesso', jsonb_build_object('decisao', v_a.decisao, 'decidido_em', v_a.decidido_em,
        'total', v_total, 'decididos', v_decididos, 'aprovados', v_aprovados),
    'peca', to_jsonb(v_peca),
    'versoes', COALESCE((SELECT jsonb_agg(to_jsonb(pv) ORDER BY pv.numero)
        FROM public.peca_versoes pv WHERE pv.peca_id = v_peca.id), '[]'::jsonb),
    'comentarios', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
        FROM public.comentarios c WHERE c.peca_id = v_peca.id
          AND (c.visivel_para_cliente = true OR c.autor_papel = 'cliente')), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', e.tipo, 'ator_nome', e.ator_nome,
        'ator_papel', e.ator_papel, 'created_at', e.created_at) ORDER BY e.created_at DESC)
        FROM public.eventos e WHERE e.peca_id = v_peca.id AND e.tipo IN ('enviou','viu','comentou','aprovou','devolveu')), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END; $$;

GRANT EXECUTE ON FUNCTION public.cliente_previa(text) TO authenticated;

-- ===== Ações do cliente agora exigem o código =====

CREATE OR REPLACE FUNCTION public.cliente_abrir(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_h public.handoffs; v_out jsonb; v_nome text;
  v_total int; v_decididos int; v_aprovados int;
BEGIN
  v_a := public.acesso_liberado(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  UPDATE public.acessos_cliente SET ultimo_acesso = now() WHERE id = v_a.id;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;

  SELECT * INTO v_h FROM public.handoffs
  WHERE peca_id = v_a.peca_id AND para_papel = 'cliente' AND visto_em IS NULL AND recolhido_em IS NULL
  ORDER BY enviado_em DESC LIMIT 1;
  IF FOUND THEN
    UPDATE public.handoffs SET visto_em = now() WHERE id = v_h.id;
    UPDATE public.comentarios SET editavel = false, locked_em = now()
    WHERE handoff_id = v_h.id AND editavel = true;
    INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
    VALUES (v_a.peca_id, v_h.versao_id, 'viu', COALESCE(v_nome,'Cliente'), 'cliente');
  END IF;

  SELECT count(*), count(decisao), count(*) FILTER (WHERE decisao = 'aprovado')
    INTO v_total, v_decididos, v_aprovados
  FROM public.acessos_cliente
  WHERE peca_id = v_a.peca_id
    AND ((v_a.handoff_id IS NOT NULL AND handoff_id = v_a.handoff_id)
      OR (v_a.handoff_id IS NULL AND handoff_id IS NULL));

  SELECT jsonb_build_object(
    'contato', jsonb_build_object('id', v_a.cliente_contato_id, 'nome', v_nome),
    'acesso', jsonb_build_object('decisao', v_a.decisao, 'decidido_em', v_a.decidido_em,
        'total', v_total, 'decididos', v_decididos, 'aprovados', v_aprovados),
    'peca', to_jsonb(v_peca),
    'versoes', COALESCE((SELECT jsonb_agg(to_jsonb(pv) ORDER BY pv.numero)
        FROM public.peca_versoes pv WHERE pv.peca_id = v_peca.id), '[]'::jsonb),
    'comentarios', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
        FROM public.comentarios c WHERE c.peca_id = v_peca.id
          AND (c.visivel_para_cliente = true OR c.autor_papel = 'cliente')), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', e.tipo, 'ator_nome', e.ator_nome,
        'ator_papel', e.ator_papel, 'created_at', e.created_at) ORDER BY e.created_at DESC)
        FROM public.eventos e WHERE e.peca_id = v_peca.id AND e.tipo IN ('enviou','viu','comentou','aprovou','devolveu')), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_comentar(p_token text, p_texto text, p_pin_x numeric DEFAULT NULL::numeric, p_pin_y numeric DEFAULT NULL::numeric, p_anotacao_json jsonb DEFAULT NULL::jsonb, p_eh_caso boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_id uuid; v_nome text;
BEGIN
  v_a := public.acesso_liberado(p_token);
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
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_decidir_caso(p_token text, p_comentario_id uuid, p_decisao text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_c public.comentarios; v_nome text;
BEGIN
  v_a := public.acesso_liberado(p_token);
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
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_remover_caso(p_token text, p_comentario_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_c public.comentarios; v_nome text;
BEGIN
  v_a := public.acesso_liberado(p_token);
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
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_editar_comentario(p_token text, p_comentario_id uuid, p_texto text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_a public.acessos_cliente; v_c public.comentarios; v_auth uuid;
BEGIN
  v_a := public.acesso_liberado(p_token);
  SELECT * INTO v_c FROM public.comentarios WHERE id = p_comentario_id AND peca_id = v_a.peca_id;
  IF NOT FOUND OR v_c.autor_cliente_contato_id IS DISTINCT FROM v_a.cliente_contato_id THEN
    RAISE EXCEPTION 'Comentário não encontrado'; END IF;
  IF NOT v_c.editavel THEN RAISE EXCEPTION 'Este comentário está bloqueado'; END IF;
  IF coalesce(trim(p_texto),'') = '' THEN RAISE EXCEPTION 'Comentário vazio'; END IF;
  IF v_c.edicao_autorizada THEN
    SELECT id INTO v_auth FROM public.autorizacoes_edicao
    WHERE handoff_id = v_c.handoff_id AND revogado_em IS NULL ORDER BY criado_em DESC LIMIT 1;
    INSERT INTO public.comentario_historico (comentario_id, texto_antes, texto_depois,
      editado_por_cliente_contato_id, autorizacao_id)
    VALUES (v_c.id, v_c.texto, p_texto, v_a.cliente_contato_id, v_auth);
    IF v_auth IS NOT NULL THEN UPDATE public.autorizacoes_edicao SET usado = true WHERE id = v_auth; END IF;
  END IF;
  UPDATE public.comentarios SET texto = p_texto WHERE id = v_c.id;
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_aprovar(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_marcacoes int; v_abertos int;
BEGIN
  v_a := public.acesso_liberado(p_token);
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
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_aprovar_tudo(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid;
        v_abertas int; v_pendentes int;
BEGIN
  v_a := public.acesso_liberado(p_token);
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
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_devolver(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_handoff uuid; v_nome text;
  v_total int; v_decididos int; v_rodada uuid;
BEGIN
  v_a := public.acesso_liberado(p_token);
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
END; $$;