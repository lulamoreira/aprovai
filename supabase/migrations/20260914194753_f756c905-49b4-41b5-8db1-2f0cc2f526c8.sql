DROP FUNCTION IF EXISTS public.enviar_peca(uuid, uuid[]);

REVOKE ALL ON FUNCTION public.enviar_peca(uuid, uuid[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_peca(uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_peca(uuid, uuid[], text) TO service_role;

COMMENT ON FUNCTION public.enviar_peca(uuid, uuid[], text) IS 'Envia peça para o próximo estágio do fluxo (atendimento ou cliente), com modo de aprovação por rodada.';