import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface DetalhesAutorizacao {
  client?: { name?: string; redirect_uri?: string } | null;
  scope?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
}

interface OAuthApi {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: DetalhesAutorizacao | null; error: { message: string } | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: DetalhesAutorizacao | null; error: { message: string } | null }>;
  denyAuthorization: (
    id: string,
  ) => Promise<{ data: DetalhesAutorizacao | null; error: { message: string } | null }>;
}

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Autorizar acesso — Aprova" },
      { name: "description", content: "Autorize um aplicativo a agir em seu nome no Aprova." },
      { property: "og:title", content: "Autorizar acesso — Aprova" },
      {
        property: "og:description",
        content: "Autorize um aplicativo a agir em seu nome no Aprova.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s["authorization_id"] === "string" ? s["authorization_id"] : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Pedido de autorização inválido.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/auth",
        search: { next: location.pathname + location.searchStr },
      });
    }
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(id);
    if (error) throw new Error(error.message);
    const imediato = data?.redirect_url ?? data?.redirect_to;
    if (imediato && !data?.client) throw redirect({ href: imediato });
    return data;
  },
  component: Consentimento,
  errorComponent: ({ error }) => (
    <main className="flex min-h-screen items-center justify-center px-4 text-center">
      <div className="max-w-md">
        <h1 className="text-xl font-bold">Não foi possível carregar este pedido</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {String((error as Error)?.message ?? error)}
        </p>
      </div>
    </main>
  ),
});

function Consentimento() {
  const detalhes = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const nomeApp = detalhes?.client?.name ?? "este aplicativo";

  async function decidir(aprovar: boolean) {
    setEnviando(true);
    setErro(null);
    const api = oauthApi();
    const { data, error } = aprovar
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setEnviando(false);
      setErro(error.message);
      return;
    }
    const destino = data?.redirect_url ?? data?.redirect_to;
    if (!destino) {
      setEnviando(false);
      setErro("O servidor de autorização não devolveu um endereço de retorno.");
      return;
    }
    window.location.href = destino;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-lift">
        <div className="mb-6 flex items-center gap-2">
          <span className="gradient-brand flex size-10 items-center justify-center rounded-2xl">
            <Sparkles className="size-5 text-primary-foreground" />
          </span>
          <span className="text-xl font-bold tracking-tight">Aprova</span>
        </div>

        <h1 className="text-2xl font-bold">Conectar {nomeApp} à sua conta</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Isso permite que {nomeApp} use o Aprova como você: consultar peças, ver comentários,
          comentar e enviar peças para a próxima etapa.
        </p>

        <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
          <li>· Compartilhar seu perfil básico e e-mail</li>
          {detalhes?.client?.redirect_uri && (
            <li className="break-all">· Retorno para {detalhes.client.redirect_uri}</li>
          )}
        </ul>

        <p className="mt-4 rounded-2xl bg-muted p-3 text-xs text-muted-foreground">
          As permissões do Aprova continuam valendo: o aplicativo só enxerga o que o seu papel
          permite.
        </p>

        {erro && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {erro}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <Button
            variant="outline"
            className="flex-1 rounded-2xl"
            disabled={enviando}
            onClick={() => void decidir(false)}
          >
            Cancelar conexão
          </Button>
          <Button
            className="gradient-brand flex-1 rounded-2xl text-primary-foreground hover:opacity-95"
            disabled={enviando}
            onClick={() => void decidir(true)}
          >
            Autorizar
          </Button>
        </div>
      </div>
    </main>
  );
}
