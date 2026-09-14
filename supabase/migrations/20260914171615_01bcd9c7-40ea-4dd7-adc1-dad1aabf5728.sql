CREATE OR REPLACE FUNCTION public.editar_peca_meta(p_peca_id uuid, p_nome text, p_tamanho text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_interno() THEN
    RAISE EXCEPTION 'Apenas usuarios internos podem editar pecas';
  END IF;
  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RAISE EXCEPTION 'O nome da peca e obrigatorio';
  END IF;
  UPDATE public.pecas
     SET nome = trim(p_nome),
         tamanho = NULLIF(trim(p_tamanho), '')
   WHERE id = p_peca_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peca nao encontrada';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.editar_peca_meta(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_peca_meta(uuid, text, text) TO authenticated;