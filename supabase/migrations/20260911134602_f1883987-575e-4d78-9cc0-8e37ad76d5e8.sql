
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_interno() FROM anon;
REVOKE EXECUTE ON FUNCTION public.papel_atual() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_profile(text) FROM anon;

-- bootstrap: primeiro usuario vira admin
CREATE OR REPLACE FUNCTION public.ensure_profile(_nome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao autenticado'; END IF;
  INSERT INTO public.profiles (id, nome, email)
  SELECT v_uid, COALESCE(NULLIF(trim(_nome),''), u.email), u.email FROM auth.users u WHERE u.id = v_uid
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin') ON CONFLICT DO NOTHING;
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.ensure_profile(text) FROM anon;

CREATE OR REPLACE FUNCTION public.nome_ator()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(nome, email, 'Usuário') FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.nome_ator() FROM anon;

-- SUBIR VERSAO
CREATE OR REPLACE FUNCTION public.subir_versao(
  p_peca_id uuid, p_imagem_url text, p_imagem_path text,
  p_largura int DEFAULT NULL, p_altura int DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_peca public.pecas; v_num int; v_id uuid;
BEGIN
  SELECT * INTO v_peca FROM public.pecas WHERE id = p_peca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada'; END IF;
  IF NOT (public.has_role(auth.uid(),'criacao') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Apenas a Criação pode subir arte'; END IF;
  IF v_peca.status <> 'criacao_ajustando' THEN RAISE EXCEPTION 'A peça não está com a Criação'; END IF;
  v_num := v_peca.versao_atual + 1;
  INSERT INTO public.peca_versoes (peca_id, numero, imagem_url, imagem_path, largura_px, altura_px,
    nome_snapshot, tamanho_snapshot, observacao, enviada_por)
  VALUES (p_peca_id, v_num, p_imagem_url, p_imagem_path, p_largura, p_altura,
    v_peca.nome, v_peca.tamanho, p_observacao, auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.pecas SET versao_atual = v_num, thumb_url = p_imagem_url WHERE id = p_peca_id;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (p_peca_id, v_id, 'subiu_versao', public.nome_ator(), 'criacao', 'Versão v' || v_num);
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.subir_versao(uuid,text,text,int,int,text) FROM anon;

-- COMENTAR (interno)
CREATE OR REPLACE FUNCTION public.comentar_interno(
  p_peca_id uuid, p_texto text, p_visivel_cliente boolean DEFAULT false,
  p_pin_x numeric DEFAULT NULL, p_pin_y numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_peca public.pecas; v_versao uuid; v_papel public.papel_ator; v_id uuid;
BEGIN
  SELECT * INTO v_peca FROM public.pecas WHERE id = p_peca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada'; END IF;
  v_papel := public.papel_atual();
  IF v_papel IS NULL THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF coalesce(trim(p_texto),'') = '' THEN RAISE EXCEPTION 'Comentário vazio'; END IF;
  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = p_peca_id AND numero = v_peca.versao_atual;
  INSERT INTO public.comentarios (peca_id, versao_id, autor_user_id, autor_papel, texto,
    pin_x, pin_y, visivel_para_cliente, editavel)
  VALUES (p_peca_id, v_versao, auth.uid(), v_papel, p_texto, p_pin_x, p_pin_y,
    CASE WHEN v_papel = 'atendimento' THEN p_visivel_cliente ELSE false END, true)
  RETURNING id INTO v_id;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (p_peca_id, v_versao, 'comentou', public.nome_ator(), v_papel);
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.comentar_interno(uuid,text,boolean,numeric,numeric) FROM anon;

-- ENVIAR PECA
CREATE OR REPLACE FUNCTION public.enviar_peca(p_peca_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_peca public.pecas; v_de public.papel_ator; v_para public.papel_ator;
  v_novo public.piece_status; v_versao uuid; v_handoff uuid; v_contato record; v_cliente_id uuid; v_tok text;
BEGIN
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
    SELECT c.cliente_id INTO v_cliente_id FROM public.campanhas c WHERE c.id = v_peca.campanha_id;
    FOR v_contato IN SELECT * FROM public.cliente_contatos WHERE cliente_id = v_cliente_id LOOP
      v_tok := encode(extensions.gen_random_bytes(24),'hex');
      INSERT INTO public.acessos_cliente (peca_id, cliente_contato_id, token)
      VALUES (p_peca_id, v_contato.id, v_tok);
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
END; $$;
REVOKE EXECUTE ON FUNCTION public.enviar_peca(uuid) FROM anon;

-- MARCAR VISTO
CREATE OR REPLACE FUNCTION public.marcar_visto(p_peca_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_papel public.papel_ator; v_h public.handoffs;
BEGIN
  v_papel := public.papel_atual();
  IF v_papel IS NULL THEN RETURN; END IF;
  SELECT * INTO v_h FROM public.handoffs
  WHERE peca_id = p_peca_id AND para_papel = v_papel AND visto_em IS NULL AND recolhido_em IS NULL
  ORDER BY enviado_em DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.handoffs SET visto_em = now(), visto_por = auth.uid() WHERE id = v_h.id;
  UPDATE public.comentarios SET editavel = false, locked_em = now()
  WHERE handoff_id = v_h.id AND editavel = true;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (p_peca_id, v_h.versao_id, 'viu', public.nome_ator(), v_papel);
END; $$;
REVOKE EXECUTE ON FUNCTION public.marcar_visto(uuid) FROM anon;

-- RECOLHER ENVIO
CREATE OR REPLACE FUNCTION public.recolher_envio(p_peca_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_h public.handoffs; v_status public.piece_status;
BEGIN
  SELECT * INTO v_h FROM public.handoffs
  WHERE peca_id = p_peca_id AND visto_em IS NULL AND recolhido_em IS NULL
  ORDER BY enviado_em DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nada para recolher: o destinatário já visualizou'; END IF;
  IF v_h.enviado_por IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Apenas quem enviou pode recolher'; END IF;
  v_status := CASE
    WHEN v_h.de_papel = 'criacao' THEN 'criacao_ajustando'::public.piece_status
    WHEN v_h.de_papel = 'atendimento' AND v_h.para_papel = 'cliente' THEN 'aguardando_atendimento'::public.piece_status
    WHEN v_h.de_papel = 'atendimento' AND v_h.para_papel = 'criacao' THEN 'retorno_atendimento'::public.piece_status
    ELSE 'aguardando_cliente'::public.piece_status END;
  UPDATE public.handoffs SET recolhido_em = now() WHERE id = v_h.id;
  UPDATE public.comentarios SET handoff_id = NULL, editavel = true, locked_em = NULL WHERE handoff_id = v_h.id;
  IF v_h.para_papel = 'cliente' THEN
    DELETE FROM public.acessos_cliente WHERE peca_id = p_peca_id;
  END IF;
  UPDATE public.pecas SET status = v_status WHERE id = p_peca_id;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (p_peca_id, v_h.versao_id, 'enviou', public.nome_ator(), v_h.de_papel, 'Envio recolhido');
END; $$;
REVOKE EXECUTE ON FUNCTION public.recolher_envio(uuid) FROM anon;

-- AUTORIZAR EDICAO DO CLIENTE
CREATE OR REPLACE FUNCTION public.autorizar_edicao_cliente(p_handoff_id uuid, p_motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_h public.handoffs; v_id uuid; v_contato uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;
  IF coalesce(trim(p_motivo),'') = '' THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  SELECT * INTO v_h FROM public.handoffs WHERE id = p_handoff_id;
  IF NOT FOUND OR v_h.de_papel <> 'cliente' THEN RAISE EXCEPTION 'Envio inválido'; END IF;

  UPDATE public.comentarios
  SET editavel = true, edicao_autorizada = true, locked_em = NULL,
      texto_original = COALESCE(texto_original, texto)
  WHERE handoff_id = p_handoff_id AND autor_papel = 'cliente';

  INSERT INTO public.autorizacoes_edicao (peca_id, handoff_id, autorizado_por, motivo)
  VALUES (v_h.peca_id, p_handoff_id, auth.uid(), p_motivo) RETURNING id INTO v_id;

  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (v_h.peca_id, v_h.versao_id, 'autorizou_edicao', public.nome_ator(), 'atendimento', p_motivo);

  SELECT autor_cliente_contato_id INTO v_contato FROM public.comentarios
  WHERE handoff_id = p_handoff_id AND autor_cliente_contato_id IS NOT NULL LIMIT 1;
  IF v_contato IS NOT NULL THEN
    INSERT INTO public.notificacoes (destinatario_cliente_contato_id, peca_id, tipo, titulo, mensagem)
    VALUES (v_contato, v_h.peca_id, 'edicao_autorizada', 'Edição liberada', p_motivo);
  END IF;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.autorizar_edicao_cliente(uuid,text) FROM anon;

CREATE OR REPLACE FUNCTION public.revogar_autorizacao(p_autorizacao_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.autorizacoes_edicao;
BEGIN
  IF NOT (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO v_a FROM public.autorizacoes_edicao WHERE id = p_autorizacao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Autorização não encontrada'; END IF;
  IF v_a.usado THEN RAISE EXCEPTION 'Autorização já utilizada'; END IF;
  IF v_a.revogado_em IS NOT NULL THEN RETURN; END IF;
  UPDATE public.autorizacoes_edicao SET revogado_em = now() WHERE id = p_autorizacao_id;
  UPDATE public.comentarios SET editavel = false, edicao_autorizada = false, locked_em = now()
  WHERE handoff_id = v_a.handoff_id AND autor_papel = 'cliente';
  INSERT INTO public.eventos (peca_id, tipo, ator_nome, ator_papel, detalhe)
  VALUES (v_a.peca_id, 'revogou_autorizacao', public.nome_ator(), 'atendimento', 'Autorização revogada');
END; $$;
REVOKE EXECUTE ON FUNCTION public.revogar_autorizacao(uuid) FROM anon;

-- ============ FUNÇÕES DO CLIENTE (token) ============
CREATE OR REPLACE FUNCTION public.acesso_por_token(p_token text)
RETURNS public.acessos_cliente LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.acessos_cliente;
BEGIN
  SELECT * INTO v_a FROM public.acessos_cliente WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link inválido'; END IF;
  IF v_a.expira_em < now() THEN RAISE EXCEPTION 'Link expirado'; END IF;
  RETURN v_a;
END; $$;
REVOKE EXECUTE ON FUNCTION public.acesso_por_token(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.cliente_abrir(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_h public.handoffs; v_out jsonb; v_nome text;
BEGIN
  v_a := public.acesso_por_token(p_token);
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

  SELECT jsonb_build_object(
    'contato', jsonb_build_object('id', v_a.cliente_contato_id, 'nome', v_nome),
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

CREATE OR REPLACE FUNCTION public.cliente_comentar(p_token text, p_texto text,
  p_pin_x numeric DEFAULT NULL, p_pin_y numeric DEFAULT NULL, p_anotacao_json jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_id uuid; v_nome text;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Esta peça não está aberta para comentários'; END IF;
  IF coalesce(trim(p_texto),'') = '' THEN RAISE EXCEPTION 'Comentário vazio'; END IF;
  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;
  INSERT INTO public.comentarios (peca_id, versao_id, autor_cliente_contato_id, autor_papel, texto,
    pin_x, pin_y, anotacao_json, visivel_para_cliente, editavel)
  VALUES (v_peca.id, v_versao, v_a.cliente_contato_id, 'cliente', p_texto, p_pin_x, p_pin_y, p_anotacao_json, true, true)
  RETURNING id INTO v_id;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (v_peca.id, v_versao, 'comentou', COALESCE(v_nome,'Cliente'), 'cliente');
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_editar_comentario(p_token text, p_comentario_id uuid, p_texto text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.acessos_cliente; v_c public.comentarios; v_auth uuid;
BEGIN
  v_a := public.acesso_por_token(p_token);
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

CREATE OR REPLACE FUNCTION public.cliente_devolver(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_handoff uuid; v_nome text;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;
  INSERT INTO public.handoffs (peca_id, versao_id, de_papel, para_papel)
  VALUES (v_peca.id, v_versao, 'cliente', 'atendimento') RETURNING id INTO v_handoff;
  UPDATE public.comentarios SET handoff_id = v_handoff
  WHERE peca_id = v_peca.id AND versao_id IS NOT DISTINCT FROM v_versao
    AND autor_papel = 'cliente' AND handoff_id IS NULL;
  UPDATE public.pecas SET status = 'retorno_atendimento' WHERE id = v_peca.id;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (v_peca.id, v_versao, 'devolveu', COALESCE(v_nome,'Cliente'), 'cliente');
  INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
  SELECT ur.user_id, v_peca.id, 'cliente_devolveu', 'Cliente devolveu com comentários', v_peca.nome
  FROM public.user_roles ur WHERE ur.role IN ('atendimento','admin');
END; $$;

CREATE OR REPLACE FUNCTION public.cliente_aprovar(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.acessos_cliente; v_peca public.pecas; v_versao uuid; v_nome text;
BEGIN
  v_a := public.acesso_por_token(p_token);
  SELECT * INTO v_peca FROM public.pecas WHERE id = v_a.peca_id;
  IF v_peca.status <> 'aguardando_cliente' THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = v_peca.id AND numero = v_peca.versao_atual;
  SELECT nome INTO v_nome FROM public.cliente_contatos WHERE id = v_a.cliente_contato_id;
  UPDATE public.pecas SET status = 'aprovada' WHERE id = v_peca.id;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (v_peca.id, v_versao, 'aprovou', COALESCE(v_nome,'Cliente'), 'cliente');
  INSERT INTO public.notificacoes (destinatario_user_id, peca_id, tipo, titulo, mensagem)
  SELECT ur.user_id, v_peca.id, 'aprovada', 'Peça aprovada', v_peca.nome FROM public.user_roles ur;
END; $$;

GRANT EXECUTE ON FUNCTION public.cliente_abrir(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_comentar(text,text,numeric,numeric,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_editar_comentario(text,uuid,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_devolver(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_aprovar(text) TO anon, authenticated;
