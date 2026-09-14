CREATE OR REPLACE FUNCTION public.cliente_abrir(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.acessos_cliente; v_peca public.pecas; v_h public.handoffs; v_out jsonb; v_nome text;
  v_total int; v_decididos int; v_aprovados int;
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
END; $function$;