CREATE OR REPLACE FUNCTION public.registrar_pin_acesso(p_acesso_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.acessos_cliente
  SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      pin_tentativas = 0,
      pin_bloqueado = false,
      desbloqueado_em = NULL
  WHERE id = p_acesso_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.registrar_pin_acesso(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pin_acesso(uuid, text) TO service_role;