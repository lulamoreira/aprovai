CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION private.notificar_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public, net, extensions
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT valor INTO v_url FROM private.config WHERE chave = 'notificacao_email_url';
  SELECT valor INTO v_secret FROM private.config WHERE chave = 'notificacao_email_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('notificacao_id', NEW.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-aprovai-secret', v_secret)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notificar_email falhou: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;