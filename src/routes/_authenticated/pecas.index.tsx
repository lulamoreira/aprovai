import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  buscarTudo,
  formatarData,
  PAPEL_LABEL,
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
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
      { title: "Central de peças — AprovAI" },
      {
        name: "description",
        content:
          "Todas as peças de campanha com situação do fluxo, tempo parado, edição, exclusão e exportação em PDF.",
      },
      { property: "og:title", content: "Central de peças — AprovAI" },
      {
        property: "og:description",
        content:
          "Todas as peças de campanha com situação do fluxo, tempo parado, edição, exclusão e exportação em PDF.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CentralPecas,
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
  modo_aprovacao: string | null;
  campanhas: { nome: string; clientes: { nome: string } | null } | null;
}

interface LinhaHandoff {
  peca_id: string;
  de_papel: string;
  para_papel: string;
  enviado_em: string;
  visto_em: string | null;
  recolhido_em: string | null;
}

interface LinhaAcesso {
  peca_id: string;
  handoff_id: string | null;
  decisao: string | null;
  criado_em: string;
}

/** Placar "X de N aprovaram" da rodada atual da peça, ou null quando não se aplica. */
function placarRodada(acessos: LinhaAcesso[]): { aprovados: number; total: number } | null {
  if (acessos.length === 0) return null;
  const recente = [...acessos].sort(
    (a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime(),
  )[0]!;
  const rodada = acessos.filter((a) => a.handoff_id === recente.handoff_id);
  const base = rodada.length > 0 ? rodada : acessos;
  return { aprovados: base.filter((a) => a.decisao === "aprovado").length, total: base.length };
}

/** Formata uma duração em milissegundos como "2 d 4 h" / "3 h 10 min" / "8 min". */
function duracaoHumana(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60000));
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const min = minutos % 60;
  if (dias > 0) return horas > 0 ? `${dias} d ${horas} h` : `${dias} d`;
  if (horas > 0) return min > 0 ? `${horas} h ${min} min` : `${horas} h`;
  return `${min} min`;
}

function papelRotulo(papel: string): string {
  return PAPEL_LABEL[papel] ?? papel;
}

interface Situacao {
  texto: string;
  detalhe: string;
  /** milissegundos parados — usado para ordenar; null quando não se aplica. */
  paradaMs: number | null;
}

function montarSituacao(peca: LinhaPeca, handoffs: LinhaHandoff[], agora: number): Situacao {
  if (peca.status === "aprovada") {
    return {
      texto: `Aprovada em ${formatarData(peca.updated_at)}`,
      detalhe: "Fluxo concluído",
      paradaMs: null,
    };
  }

  const ativos = handoffs
    .filter((h) => !h.recolhido_em)
    .sort((a, b) => new Date(b.enviado_em).getTime() - new Date(a.enviado_em).getTime());
  const atual = ativos[0];

  if (!atual) {
    if (peca.status === "criacao_ajustando") {
      return { texto: "Com a Criação (nova)", detalhe: "Ainda não enviada", paradaMs: null };
    }
    return {
      texto: "Sem envio registrado",
      detalhe: `Atualizada em ${formatarData(peca.updated_at)}`,
      paradaMs: null,
    };
  }

  const enviadoMs = new Date(atual.enviado_em).getTime();
  const visto = atual.visto_em
    ? `visto em ${formatarData(atual.visto_em)}`
    : "ainda não visto";

  return {
    texto: `De ${papelRotulo(atual.de_papel)} → ${papelRotulo(atual.para_papel)}`,
    detalhe: `Enviada em ${formatarData(atual.enviado_em)} · ${visto} · parada há ${duracaoHumana(agora - enviadoMs)}`,
    paradaMs: agora - enviadoMs,
  };
}

function CentralPecas() {
  const { temPapel } = useAuth();
  const interno = temPapel("criacao", "atendimento", "admin");
  const admin = temPapel("admin");
  const qc = useQueryClient();

  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [campanha, setCampanha] = useState<string>("todas");
  const [ordem, setOrdem] = useState<"parada" | "recente">("parada");
  const [gerando, setGerando] = useState(false);

  const [editando, setEditando] = useState<LinhaPeca | null>(null);
  const [formNome, setFormNome] = useState("");
  const [formTamanho, setFormTamanho] = useState("");
  const [apagando, setApagando] = useState<LinhaPeca | null>(null);

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

  const { data: handoffs = [] } = useQuery({
    queryKey: ["pecas-handoffs"],
    queryFn: () =>
      buscarTudo<LinhaHandoff>(() =>
        supabase
          .from("handoffs")
          .select("peca_id, de_papel, para_papel, enviado_em, visto_em, recolhido_em")
          .order("enviado_em", { ascending: false })
          .order("id"),
      ),
  });

  const porPeca = useMemo(() => {
    const mapa = new Map<string, LinhaHandoff[]>();
    for (const h of handoffs) {
      const lista = mapa.get(h.peca_id);
      if (lista) lista.push(h);
      else mapa.set(h.peca_id, [h]);
    }
    return mapa;
  }, [handoffs]);

  const campanhas = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of pecas) mapa.set(p.campanha_id, p.campanhas?.nome ?? "Sem campanha");
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [pecas]);

  const linhas = useMemo(() => {
    const agora = Date.now();
    const termo = busca.trim().toLowerCase();
    const base = pecas
      .filter(
        (p) =>
          (!termo || p.nome.toLowerCase().includes(termo)) &&
          (status === "todos" || p.status === status) &&
          (campanha === "todas" || p.campanha_id === campanha),
      )
      .map((peca) => ({
        peca,
        situacao: montarSituacao(peca, porPeca.get(peca.id) ?? [], agora),
      }));

    return base.sort((a, b) => {
      if (ordem === "parada") {
        const pa = a.situacao.paradaMs ?? -1;
        const pb = b.situacao.paradaMs ?? -1;
        if (pa !== pb) return pb - pa;
      }
      return new Date(b.peca.updated_at).getTime() - new Date(a.peca.updated_at).getTime();
    });
  }, [pecas, porPeca, busca, status, campanha, ordem]);

  const filtradas = useMemo(() => linhas.map((l) => l.peca), [linhas]);

  const contadores = useMemo(
    () =>
      STATUS_ORDEM.map((s) => ({
        status: s,
        total: filtradas.filter((p) => p.status === s).length,
      })).filter((c) => c.total > 0),
    [filtradas],
  );

  const salvar = useMutation({
    mutationFn: async ({ id, nome, tamanho }: { id: string; nome: string; tamanho: string }) => {
      const { error } = await supabase.rpc("editar_peca_meta", {
        p_peca_id: id,
        p_nome: nome,
        p_tamanho: tamanho,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Peça atualizada.");
      setEditando(null);
      await qc.invalidateQueries({ queryKey: ["pecas-lista"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar."),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pecas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Peça apagada.");
      setApagando(null);
      await qc.invalidateQueries({ queryKey: ["pecas-lista"] });
      await qc.invalidateQueries({ queryKey: ["pecas-handoffs"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível apagar a peça."),
  });

  function abrirEdicao(peca: LinhaPeca) {
    setEditando(peca);
    setFormNome(peca.nome);
    setFormTamanho(peca.tamanho ?? "");
  }

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
          <h1 className="text-3xl font-extrabold tracking-tight">Central de peças</h1>
          <p className="text-sm text-muted-foreground">
            Todas as peças, com a situação atual do fluxo e há quanto tempo estão paradas.
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

      <div className="grid gap-3 rounded-3xl border bg-card p-4 shadow-soft md:grid-cols-4">
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
        <Select value={ordem} onValueChange={(v) => setOrdem(v as "parada" | "recente")}>
          <SelectTrigger className="rounded-2xl" aria-label="Ordenar peças">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="parada">Parada há mais tempo</SelectItem>
            <SelectItem value="recente">Atualização mais recente</SelectItem>
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
      ) : linhas.length === 0 ? (
        <div className="rounded-3xl border border-dashed bg-card p-12 text-center">
          <p className="text-lg font-semibold">Nenhuma peça por aqui</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie peças dentro de uma campanha para acompanhar a aprovação nesta central.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border bg-card shadow-soft">
          <div className="hidden grid-cols-[80px_1.4fr_1fr_1.6fr_150px] gap-3 border-b px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground md:grid">
            <span>Arte</span>
            <span>Peça</span>
            <span>Status</span>
            <span>Situação atual</span>
            <span className="text-right">Ações</span>
          </div>
          <ul className="divide-y">
            {linhas.map(({ peca, situacao }) => (
              <li
                key={peca.id}
                className="relative grid grid-cols-[64px_1fr] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 md:grid-cols-[80px_1.4fr_1fr_1.6fr_150px]"
              >
                <ThumbArte
                  path={peca.thumb_url}
                  alt={`Arte da peça ${peca.nome}`}
                  className="size-16 rounded-xl md:w-16"
                />
                <div className="min-w-0">
                  <Link
                    to="/pecas/$pecaId"
                    params={{ pecaId: peca.id }}
                    className="block truncate text-sm font-semibold after:absolute after:inset-0 after:content-['']"
                  >
                    {peca.nome}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      peca.tamanho ?? "sem tamanho",
                      peca.campanhas?.nome ?? "sem campanha",
                      peca.campanhas?.clientes?.nome ?? "sem cliente",
                    ].join(" · ")}
                  </p>
                </div>
                <div className="hidden flex-wrap items-center gap-2 md:flex">
                  <StatusBadge status={peca.status} />
                  <span className="text-xs text-muted-foreground">v{peca.versao_atual}</span>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <p className="text-sm font-medium">{situacao.texto}</p>
                  <p className="text-xs text-muted-foreground">{situacao.detalhe}</p>
                </div>
                <div className="relative z-10 col-span-2 flex justify-end gap-2 md:col-span-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-2xl"
                    onClick={() => abrirEdicao(peca)}
                  >
                    <Pencil className="mr-1 size-3.5" /> Editar
                  </Button>
                  {admin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-2xl text-destructive hover:bg-destructive/10"
                      aria-label={`Apagar peça ${peca.nome}`}
                      onClick={() => setApagando(peca)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={editando !== null} onOpenChange={(aberto) => !aberto && setEditando(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Editar peça</DialogTitle>
            <DialogDescription>
              Altera apenas o nome e o tamanho. O status de aprovação continua o mesmo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="peca-nome">Nome da peça</Label>
              <Input
                id="peca-nome"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
                className="rounded-2xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="peca-tamanho">Tamanho (opcional)</Label>
              <Input
                id="peca-tamanho"
                value={formTamanho}
                onChange={(e) => setFormTamanho(e.target.value)}
                placeholder="Ex: 1080x1080"
                className="rounded-2xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-2xl" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button
              className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
              disabled={!formNome.trim() || salvar.isPending}
              onClick={() =>
                editando &&
                salvar.mutate({ id: editando.id, nome: formNome, tamanho: formTamanho })
              }
            >
              {salvar.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={apagando !== null} onOpenChange={(aberto) => !aberto && setApagando(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar “{apagando?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. Serão apagados também todas as versões, comentários,
              marcações, envios e o histórico desta peça.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={excluir.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (apagando) excluir.mutate(apagando.id);
              }}
            >
              Apagar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
