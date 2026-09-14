CREATE OR REPLACE FUNCTION public.comentar_interno(p_peca_id uuid, p_texto text, p_visivel_cliente boolean DEFAULT false, p_pin_x numeric DEFAULT NULL::numeric, p_pin_y numeric DEFAULT NULL::numeric, p_anotacao_json jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_peca public.pecas; v_versao uuid; v_papel public.papel_ator; v_id uuid;
BEGIN
  SELECT * INTO v_peca FROM public.pecas WHERE id = p_peca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada'; END IF;
  v_papel := public.papel_atual();
  IF v_papel IS NULL THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF coalesce(trim(p_texto),'') = '' THEN RAISE EXCEPTION 'Comentário vazio'; END IF;
  SELECT id INTO v_versao FROM public.peca_versoes WHERE peca_id = p_peca_id AND numero = v_peca.versao_atual;
  INSERT INTO public.comentarios (peca_id, versao_id, autor_user_id, autor_papel, texto,
    pin_x, pin_y, anotacao_json, visivel_para_cliente, editavel)
  VALUES (p_peca_id, v_versao, auth.uid(), v_papel, p_texto, p_pin_x, p_pin_y, p_anotacao_json,
    CASE WHEN v_papel = 'atendimento' THEN p_visivel_cliente ELSE false END, true)
  RETURNING id INTO v_id;
  INSERT INTO public.eventos (peca_id, versao_id, tipo, ator_nome, ator_papel)
  VALUES (p_peca_id, v_versao, 'comentou', public.nome_ator(), v_papel);
  RETURN v_id;
END; $function$;

REVOKE ALL ON FUNCTION public.comentar_interno(uuid, text, boolean, numeric, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comentar_interno(uuid, text, boolean, numeric, numeric, jsonb) TO authenticated;