
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin','atendimento','criacao');
CREATE TYPE public.piece_status AS ENUM ('criacao_ajustando','aguardando_atendimento','aguardando_cliente','retorno_atendimento','aprovada','arquivada');
CREATE TYPE public.papel_ator AS ENUM ('criacao','atendimento','cliente');
CREATE TYPE public.tipo_evento AS ENUM ('subiu_versao','enviou','viu','comentou','autorizou_edicao','revogou_autorizacao','aprovou','devolveu');
CREATE TYPE public.tipo_notificacao AS ENUM ('pronta_aprovacao','enviada_cliente','cliente_devolveu','enviada_correcao','aprovada','edicao_autorizada');

-- TABELAS
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  nome text,
  email text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  empresa text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cliente_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cliente_contatos_cliente ON public.cliente_contatos(cliente_id);

CREATE TABLE public.campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  arquivada boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campanhas_cliente ON public.campanhas(cliente_id);

CREATE TABLE public.pecas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tamanho text,
  tipo text,
  status public.piece_status NOT NULL DEFAULT 'criacao_ajustando',
  versao_atual int NOT NULL DEFAULT 0,
  thumb_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pecas_campanha ON public.pecas(campanha_id);
CREATE INDEX idx_pecas_status ON public.pecas(status);

CREATE TABLE public.peca_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id uuid NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  imagem_url text,
  imagem_path text,
  largura_px int,
  altura_px int,
  nome_snapshot text,
  tamanho_snapshot text,
  observacao text,
  enviada_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (peca_id, numero)
);
CREATE INDEX idx_peca_versoes_peca ON public.peca_versoes(peca_id);

CREATE TABLE public.handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id uuid NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  versao_id uuid REFERENCES public.peca_versoes(id) ON DELETE SET NULL,
  de_papel public.papel_ator NOT NULL,
  para_papel public.papel_ator NOT NULL,
  enviado_por uuid,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  visto_em timestamptz,
  visto_por uuid,
  recolhido_em timestamptz
);
CREATE INDEX idx_handoffs_peca ON public.handoffs(peca_id);

CREATE TABLE public.comentarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id uuid NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  versao_id uuid REFERENCES public.peca_versoes(id) ON DELETE CASCADE,
  handoff_id uuid REFERENCES public.handoffs(id) ON DELETE SET NULL,
  autor_user_id uuid,
  autor_cliente_contato_id uuid REFERENCES public.cliente_contatos(id) ON DELETE SET NULL,
  autor_papel public.papel_ator NOT NULL,
  texto text NOT NULL,
  texto_original text,
  pin_x numeric,
  pin_y numeric,
  anotacao_json jsonb,
  visivel_para_cliente boolean NOT NULL DEFAULT false,
  editavel boolean NOT NULL DEFAULT true,
  edicao_autorizada boolean NOT NULL DEFAULT false,
  locked_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_comentarios_peca ON public.comentarios(peca_id);
CREATE INDEX idx_comentarios_versao ON public.comentarios(versao_id);

CREATE TABLE public.autorizacoes_edicao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id uuid NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  handoff_id uuid REFERENCES public.handoffs(id) ON DELETE CASCADE,
  autorizado_por uuid,
  motivo text NOT NULL CHECK (length(trim(motivo)) > 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  revogado_em timestamptz,
  usado boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_autorizacoes_peca ON public.autorizacoes_edicao(peca_id);

CREATE TABLE public.comentario_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comentario_id uuid NOT NULL REFERENCES public.comentarios(id) ON DELETE CASCADE,
  texto_antes text,
  texto_depois text,
  editado_por_cliente_contato_id uuid,
  autorizacao_id uuid REFERENCES public.autorizacoes_edicao(id) ON DELETE SET NULL,
  editado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_com_hist_comentario ON public.comentario_historico(comentario_id);

CREATE TABLE public.acessos_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id uuid NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  cliente_contato_id uuid NOT NULL REFERENCES public.cliente_contatos(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso timestamptz
);
CREATE INDEX idx_acessos_peca ON public.acessos_cliente(peca_id);

CREATE TABLE public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destinatario_user_id uuid,
  destinatario_cliente_contato_id uuid,
  peca_id uuid REFERENCES public.pecas(id) ON DELETE CASCADE,
  tipo public.tipo_notificacao NOT NULL,
  titulo text NOT NULL,
  mensagem text,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON public.notificacoes(destinatario_user_id, lida);

CREATE TABLE public.eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peca_id uuid NOT NULL REFERENCES public.pecas(id) ON DELETE CASCADE,
  versao_id uuid,
  tipo public.tipo_evento NOT NULL,
  ator_nome text,
  ator_papel public.papel_ator,
  detalhe text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eventos_peca ON public.eventos(peca_id, created_at DESC);

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_contatos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campanhas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pecas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.peca_versoes TO authenticated;
GRANT SELECT ON public.handoffs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comentarios TO authenticated;
GRANT SELECT ON public.comentario_historico TO authenticated;
GRANT SELECT ON public.autorizacoes_edicao TO authenticated;
GRANT SELECT ON public.acessos_cliente TO authenticated;
GRANT SELECT, UPDATE ON public.notificacoes TO authenticated;
GRANT SELECT ON public.eventos TO authenticated;
GRANT ALL ON public.profiles, public.user_roles, public.clientes, public.cliente_contatos,
  public.campanhas, public.pecas, public.peca_versoes, public.handoffs, public.comentarios,
  public.comentario_historico, public.autorizacoes_edicao, public.acessos_cliente,
  public.notificacoes, public.eventos TO service_role;

-- FUNÇÕES DE PAPEL
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_interno()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.papel_atual()
RETURNS public.papel_ator LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'criacao') THEN 'criacao'::public.papel_ator
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('atendimento','admin')) THEN 'atendimento'::public.papel_ator
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_profile(_nome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  SELECT auth.uid(), COALESCE(_nome, u.email), u.email FROM auth.users u WHERE u.id = auth.uid()
  ON CONFLICT (id) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_pecas_updated BEFORE UPDATE ON public.pecas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_comentarios_updated BEFORE UPDATE ON public.comentarios FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pecas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peca_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comentarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comentario_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autorizacoes_edicao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acessos_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfil proprio leitura" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_interno());
CREATE POLICY "perfil proprio update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin insere perfil" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "papeis leitura" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin gerencia papeis ins" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin gerencia papeis upd" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin gerencia papeis del" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "internos leem clientes" ON public.clientes FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "gestao clientes ins" ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "gestao clientes upd" ON public.clientes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "gestao clientes del" ON public.clientes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "internos leem contatos" ON public.cliente_contatos FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "gestao contatos ins" ON public.cliente_contatos FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "gestao contatos upd" ON public.cliente_contatos FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "gestao contatos del" ON public.cliente_contatos FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "internos leem campanhas" ON public.campanhas FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "gestao campanhas ins" ON public.campanhas FOR INSERT TO authenticated
  WITH CHECK (public.is_interno());
CREATE POLICY "gestao campanhas upd" ON public.campanhas FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'atendimento') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "gestao campanhas del" ON public.campanhas FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "internos leem pecas" ON public.pecas FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "criacao insere pecas" ON public.pecas FOR INSERT TO authenticated
  WITH CHECK (public.is_interno());
CREATE POLICY "criacao edita pecas" ON public.pecas FOR UPDATE TO authenticated
  USING (public.is_interno() AND status = 'criacao_ajustando')
  WITH CHECK (public.is_interno() AND status = 'criacao_ajustando');
CREATE POLICY "admin apaga pecas" ON public.pecas FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "internos leem versoes" ON public.peca_versoes FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "criacao insere versoes" ON public.peca_versoes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'criacao') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "internos leem handoffs" ON public.handoffs FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "internos leem comentarios" ON public.comentarios FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "internos criam comentarios" ON public.comentarios FOR INSERT TO authenticated
  WITH CHECK (public.is_interno() AND autor_user_id = auth.uid());
CREATE POLICY "autor edita comentario destravado" ON public.comentarios FOR UPDATE TO authenticated
  USING (autor_user_id = auth.uid() AND editavel = true)
  WITH CHECK (autor_user_id = auth.uid() AND editavel = true);
CREATE POLICY "autor apaga comentario destravado" ON public.comentarios FOR DELETE TO authenticated
  USING (autor_user_id = auth.uid() AND editavel = true);

CREATE POLICY "internos leem historico" ON public.comentario_historico FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "internos leem autorizacoes" ON public.autorizacoes_edicao FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "internos leem acessos" ON public.acessos_cliente FOR SELECT TO authenticated USING (public.is_interno());
CREATE POLICY "internos leem eventos" ON public.eventos FOR SELECT TO authenticated USING (public.is_interno());

CREATE POLICY "minhas notificacoes" ON public.notificacoes FOR SELECT TO authenticated
  USING (destinatario_user_id = auth.uid());
CREATE POLICY "marcar notificacao lida" ON public.notificacoes FOR UPDATE TO authenticated
  USING (destinatario_user_id = auth.uid()) WITH CHECK (destinatario_user_id = auth.uid());
