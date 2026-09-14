CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private.config (
  chave text PRIMARY KEY,
  valor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.config FROM anon, authenticated;
GRANT ALL ON private.config TO service_role;
ALTER TABLE private.config ENABLE ROW LEVEL SECURITY;

INSERT INTO private.config (chave, valor) VALUES
  ('notificacao_email_url', 'https://aprovai.lovable.app/api/public/notificacao-email'),
  ('notificacao_email_secret', '07373a9b9a8cd447dc8bf8b2fcd93f3f07aaaa7140a35f9c')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();

CREATE OR REPLACE FUNCTION private.notificar_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, extensions, public
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
    PERFORM extensions.http_post(
      url := v_url,
      body := jsonb_build_object('notificacao_id', NEW.id),
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-aprovai-secret', v_secret
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao disparar e-mail da notificacao %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificacoes_email ON public.notificacoes;
CREATE TRIGGER trg_notificacoes_email
AFTER INSERT ON public.notificacoes
FOR EACH ROW EXECUTE FUNCTION private.notificar_email();