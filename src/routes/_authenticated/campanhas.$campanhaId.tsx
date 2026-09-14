import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buscarTudo, STATUS_LABEL, STATUS_ORDEM, type PieceStatus } from "@/lib/aprova";
import { gerarCatalogoMudancas } from "@/lib/catalogo-pdf";
import { useAuth } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ThumbArte } from "@/components/ThumbArte";

export const Route = createFileRoute("/_authenticated/campanhas/$campanhaId")({
  head: () => ({
    meta: [
      { title: "Campanha — Aprova" },
      { name: "description", content: "Quadro de peças da campanha por etapa de aprovação." },
      { property: "og:title", content: "Campanha — Aprova" },
      {
        property: "og:description",
        content: "Quadro de peças da campanha por etapa de aprovação.",
      },
    ],
  }),
  component: QuadroCampanha,
});

interface Peca {
  id: string;
  nome: string;
  tamanho: string | null;
  status: PieceStatus;
  versao_atual: number;
  thumb_url: string | null;
}

function QuadroCampanha() {
  const { campanhaId } = Route.useParams();
  const { papel, temPapel } = useAuth();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [tamanho, setTamanho] = useState("");

  const { data: campanha } = useQuery({
    queryKey: ["campanha", campanhaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campanhas")
        .select("id, nome, descricao, cliente_id, clientes(nome)")
        .eq("id", campanhaId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: pecas = [], isLoading } = useQuery({
    queryKey: ["pecas", campanhaId],
    queryFn: () =>
      buscarTudo<Peca>(() =>
        supabase
          .from("pecas")
          .select("id, nome, tamanho, status, versao_atual, thumb_url")
          .eq("campanha_id", campanhaId)
          .order("created_at", { ascending: false })
          .order("id"),
      ),
  });

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pecas").insert({
        campanha_id: campanhaId,
        nome: nome.trim(),
        tamanho: tamanho.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Peça criada.");
      setNome("");
      setTamanho("");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["pecas", campanhaId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const meuStatus: PieceStatus[] =
    papel === "criacao"
      ? ["criacao_ajustando"]
      : papel === "atendimento"
        ? ["aguardando_atendimento", "retorno_atendimento"]
        : [];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/painel"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Painel
          </Link>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
            {campanha?.nome ?? "Campanha"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {(campanha as { clientes?: { nome: string } } | undefined)?.clientes?.nome ?? ""}
          </p>
        </div>

        {temPapel("criacao", "admin") && (
          <Dialog open={aberto} onOpenChange={setAberto}>
            <DialogTrigger asChild>
              <Button className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95">
                <Plus className="mr-1 size-4" /> Nova peça
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-3xl">
              <DialogHeader>
                <DialogTitle>Nova peça</DialogTitle>
                <DialogDescription>
                  Crie a peça e depois suba a arte na tela dela.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="peca-nome">Nome</Label>
                  <Input
                    id="peca-nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Cartaz gôndola"
                    className="rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="peca-tamanho">Tamanho</Label>
                  <Input
                    id="peca-tamanho"
                    value={tamanho}
                    onChange={(e) => setTamanho(e.target.value)}
                    placeholder="A3 · 297x420mm"
                    className="rounded-2xl"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={!nome.trim() || criar.isPending}
                  onClick={() => criar.mutate()}
                  className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
                >
                  Criar peça
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {STATUS_ORDEM.map((status) => {
            const coluna = pecas.filter((p) => p.status === status);
            return (
              <section key={status} className="rounded-3xl bg-muted/50 p-3">
                <header className="flex items-center justify-between px-2 py-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {STATUS_LABEL[status]}
                  </h2>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {coluna.length}
                  </span>
                </header>
                <div className="space-y-3">
                  {coluna.map((peca) => (
                    <Link
                      key={peca.id}
                      to="/pecas/$pecaId"
                      params={{ pecaId: peca.id }}
                      className="block rounded-2xl border bg-card p-3 shadow-soft transition-shadow hover:shadow-lift"
                    >
                      <ThumbArte path={peca.thumb_url} alt={`Arte da peça ${peca.nome}`} />
                      <p className="mt-2 truncate text-sm font-semibold">{peca.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {peca.tamanho ?? "sem tamanho"} · v{peca.versao_atual}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <StatusBadge status={peca.status} />
                        {meuStatus.includes(peca.status) && (
                          <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                            Aguardando você
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                  {coluna.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">Vazio</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
