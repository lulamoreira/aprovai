import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  buscarTudo,
  formatarData,
  STATUS_CLASSE,
  STATUS_LABEL,
  STATUS_ORDEM,
  type PieceStatus,
} from "@/lib/aprova";
import { cn } from "@/lib/utils";
import { gerarCatalogoMudancas } from "@/lib/catalogo-pdf";
import { useAuth } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { ThumbArte } from "@/components/ThumbArte";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/pecas/")({
  head: () => ({
    meta: [
      { title: "Peças em aprovação — AprovAI" },
      {
        name: "description",
        content: "Todas as peças de campanha com status de aprovação, filtros e exportação em PDF.",
      },
      { property: "og:title", content: "Peças em aprovação — AprovAI" },
      {
        property: "og:description",
        content: "Todas as peças de campanha com status de aprovação, filtros e exportação em PDF.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ListaPecas,
});

interface LinhaPeca {
  id: string;
  nome: string;
  tamanho: string | null;
  status: PieceStatus;
  versao_atual: number;
  thumb_url: string | null;
  updated_at: string;
  campanha_id: string;
  campanhas: { nome: string; clientes: { nome: string } | null } | null;
}

function ListaPecas() {
  const { temPapel } = useAuth();
  const interno = temPapel("criacao", "atendimento", "admin");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [campanha, setCampanha] = useState<string>("todas");
  const [gerando, setGerando] = useState(false);

  const { data: pecas = [], isLoading } = useQuery({
    queryKey: ["pecas-lista"],
    queryFn: () =>
      buscarTudo<LinhaPeca>(() =>
        supabase
          .from("pecas")
          .select(
            "id, nome, tamanho, status, versao_atual, thumb_url, updated_at, campanha_id, campanhas(nome, clientes(nome))",
          )
          .order("updated_at", { ascending: false })
          .order("id"),
      ),
  });

  const campanhas = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of pecas) mapa.set(p.campanha_id, p.campanhas?.nome ?? "Sem campanha");
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [pecas]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pecas.filter(
      (p) =>
        (!termo || p.nome.toLowerCase().includes(termo)) &&
        (status === "todos" || p.status === status) &&
        (campanha === "todas" || p.campanha_id === campanha),
    );
  }, [pecas, busca, status, campanha]);

  const contadores = useMemo(
    () =>
      STATUS_ORDEM.map((s) => ({
        status: s,
        total: filtradas.filter((p) => p.status === s).length,
      })).filter((c) => c.total > 0),
    [filtradas],
  );

  async function exportar() {
    if (filtradas.length === 0) {
      toast.error("Nenhuma peça no filtro atual.");
      return;
    }
    setGerando(true);
    try {
      const nomesCampanha = new Set(filtradas.map((p) => p.campanhas?.nome ?? "Sem campanha"));
      const nomesCliente = new Set(filtradas.map((p) => p.campanhas?.clientes?.nome ?? ""));
      await gerarCatalogoMudancas({
        pecas: filtradas,
        cliente: nomesCliente.size === 1 ? ([...nomesCliente][0] ?? null) : null,
        contexto: nomesCampanha.size === 1 ? [...nomesCampanha][0]! : "Seleção de peças",
      });
      toast.success("Catálogo gerado.");
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível gerar o catálogo.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Peças</h1>
          <p className="text-sm text-muted-foreground">
            Todas as peças com o status de aprovação atual.
          </p>
        </div>
        {interno && (
          <Button
            onClick={() => void exportar()}
            disabled={gerando}
            className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
          >
            {gerando ? (
              <>
                <Loader2 className="mr-1 size-4 animate-spin" /> Gerando catálogo...
              </>
            ) : (
              <>
                <FileDown className="mr-1 size-4" /> Exportar catálogo de mudanças (PDF)
              </>
            )}
          </Button>
        )}
      </div>

      <div className="grid gap-3 rounded-3xl border bg-card p-4 shadow-soft md:grid-cols-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome da peça"
            aria-label="Buscar por nome da peça"
            className="rounded-2xl pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="rounded-2xl" aria-label="Filtrar por status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {(Object.keys(STATUS_LABEL) as PieceStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={campanha} onValueChange={setCampanha}>
          <SelectTrigger className="rounded-2xl" aria-label="Filtrar por campanha">
            <SelectValue placeholder="Campanha" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as campanhas</SelectItem>
            {campanhas.map(([id, nome]) => (
              <SelectItem key={id} value={id}>
                {nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {contadores.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {contadores.map((c) => (
            <span
              key={c.status}
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
                STATUS_CLASSE[c.status],
              )}
            >
              {c.total} {STATUS_LABEL[c.status].toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : filtradas.length === 0 ? (
        <div className="rounded-3xl border border-dashed bg-card p-12 text-center">
          <p className="text-lg font-semibold">Nenhuma peça por aqui</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie peças dentro de uma campanha para acompanhar a aprovação nesta lista.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border bg-card shadow-soft">
          <div className="hidden grid-cols-[80px_1.4fr_1fr_1fr_0.7fr_0.6fr_1fr_1fr] gap-3 border-b px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground md:grid">
            <span>Arte</span>
            <span>Peça</span>
            <span>Campanha</span>
            <span>Cliente</span>
            <span>Tamanho</span>
            <span>Versão</span>
            <span>Status</span>
            <span>Atualizada em</span>
          </div>
          <ul className="divide-y">
            {filtradas.map((p) => (
              <li key={p.id}>
                <Link
                  to="/pecas/$pecaId"
                  params={{ pecaId: p.id }}
                  className="grid grid-cols-[64px_1fr] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 md:grid-cols-[80px_1.4fr_1fr_1fr_0.7fr_0.6fr_1fr_1fr]"
                >
                  <ThumbArte
                    path={p.thumb_url}
                    alt={`Arte da peça ${p.nome}`}
                    className="size-16 rounded-xl md:w-16"
                  />
                  <span className="truncate text-sm font-semibold">{p.nome}</span>
                  <span className="hidden truncate text-sm text-muted-foreground md:block">
                    {p.campanhas?.nome ?? "—"}
                  </span>
                  <span className="hidden truncate text-sm text-muted-foreground md:block">
                    {p.campanhas?.clientes?.nome ?? "—"}
                  </span>
                  <span className="hidden text-sm text-muted-foreground md:block">
                    {p.tamanho ?? "—"}
                  </span>
                  <span className="hidden text-sm text-muted-foreground md:block">
                    v{p.versao_atual}
                  </span>
                  <span className="hidden md:block">
                    <StatusBadge status={p.status} />
                  </span>
                  <span className="hidden text-sm text-muted-foreground md:block">
                    {formatarData(p.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
