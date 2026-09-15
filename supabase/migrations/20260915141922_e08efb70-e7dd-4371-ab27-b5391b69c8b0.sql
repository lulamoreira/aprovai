DROP FUNCTION IF EXISTS public.comentar_interno(uuid, text, boolean, numeric, numeric);

REVOKE ALL ON FUNCTION public.comentar_interno(uuid, text, boolean, numeric, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.comentar_interno(uuid, text, boolean, numeric, numeric, jsonb) TO authenticated;