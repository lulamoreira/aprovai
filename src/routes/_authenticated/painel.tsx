import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, FolderOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buscarTudo, STATUS_LABEL, type PieceStatus } from "@/lib/aprova";
import { useAuth } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({
    meta: [
      { title: "Painel de campanhas — AprovAI" },
      { name: "description", content: "Campanhas e peças em aprovação, organizadas por cliente." },
      { property: "og:title", content: "Painel de campanhas — AprovAI" },
      {
        property: "og:description",
        content: "Campanhas e peças em aprovação, organizadas por cliente.",
      },
    ],
  }),
  component: Painel,
});

interface Cliente {
  id: string;
  nome: string;
  empresa: string | null;
}
interface Campanha {
  id: string;
  cliente_id: string;
  nome: string;
  descricao: string | null;
  arquivada: boolean;
}
interface PecaResumo {
  id: string;
  campanha_id: string;
  nome: string;
  status: PieceStatus;
}

function Painel() {
  const { papel } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["painel"],
    queryFn: async () => {
      const clientes = await buscarTudo<Cliente>(() =>
        supabase.from("clientes").select("id, nome, empresa").order("nome").order("id"),
      );
      const campanhas = await buscarTudo<Campanha>(() =>
        supabase
          .from("campanhas")
          .select("id, cliente_id, nome, descricao, arquivada")
          .eq("arquivada", false)
          .order("created_at", { ascending: false })
          .order("id"),
      );
      const pecas = await buscarTudo<PecaResumo>(() =>
        supabase
          .from("pecas")
          .select("id, campanha_id, nome, status")
          .order("created_at", { ascending: false })
          .order("id"),
      );
      return { clientes, campanhas, pecas };
    },
  });

  const statusDoPapel: PieceStatus | null =
    papel === "criacao"
      ? "criacao_ajustando"
      : papel === "atendimento"
        ? "aguardando_atendimento"
        : null;

  const aguardandoVoce = (data?.pecas ?? []).filter(
    (p) =>
      (statusDoPapel && p.status === statusDoPapel) ||
      (papel === "atendimento" && p.status === "retorno_atendimento"),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Painel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suas campanhas e o que está esperando por você.
        </p>
      </header>

      {aguardandoVoce.length > 0 && (
        <section className="rounded-3xl border bg-card p-6 shadow-soft">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Aguardando você
          </h2>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {aguardandoVoce.map((p) => (
              <li key={p.id}>
                <Link
                  to="/pecas/$pecaId"
                  params={{ pecaId: p.id }}
                  className="flex items-center justify-between gap-3 rounded-2xl border bg-background px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <span className="truncate text-sm font-medium">{p.nome}</span>
                  <StatusBadge status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
        </div>
      )}

      {!isLoading && (data?.clientes.length ?? 0) === 0 && (
        <div className="rounded-3xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum cliente cadastrado ainda. Um administrador pode criar clientes e campanhas na
            área de Administração.
          </p>
        </div>
      )}

      {(data?.clientes ?? []).map((cliente) => {
        const campanhas = (data?.campanhas ?? []).filter((c) => c.cliente_id === cliente.id);
        return (
          <section key={cliente.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <h2 className="text-lg font-bold">{cliente.nome}</h2>
              {cliente.empresa && (
                <span className="text-sm text-muted-foreground">· {cliente.empresa}</span>
              )}
            </div>
            {campanhas.length === 0 ? (
              <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                Sem campanhas ativas.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {campanhas.map((campanha) => {
                  const pecas = (data?.pecas ?? []).filter((p) => p.campanha_id === campanha.id);
                  const contagem = pecas.reduce<Record<string, number>>((acc, p) => {
                    acc[p.status] = (acc[p.status] ?? 0) + 1;
                    return acc;
                  }, {});
                  return (
                    <Link
                      key={campanha.id}
                      to="/campanhas/$campanhaId"
                      params={{ campanhaId: campanha.id }}
                      className="group rounded-3xl border bg-card p-5 shadow-soft transition-shadow hover:shadow-lift"
                    >
                      <span className="flex size-10 items-center justify-center rounded-2xl bg-accent">
                        <FolderOpen className="size-5 text-accent-foreground" />
                      </span>
                      <h3 className="mt-3 font-semibold group-hover:text-primary">
                        {campanha.nome}
                      </h3>
                      {campanha.descricao && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {campanha.descricao}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-muted-foreground">
                        {pecas.length} peça{pecas.length === 1 ? "" : "s"}
                        {Object.entries(contagem).length > 0 && " · "}
                        {Object.entries(contagem)
                          .map(([s, n]) => `${n} ${STATUS_LABEL[s as PieceStatus].toLowerCase()}`)
                          .join(", ")}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
