import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Eye,
  History,
  Lock,
  MessageSquare,
  Send,
  ShieldCheck,
  Undo2,
  Unlock,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  EVENTO_LABEL,
  PAPEL_LABEL,
  buscarTudo,
  formatarData,
  urlAssinada,
  type PieceStatus,
} from "@/lib/aprova";
import { useAuth } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pecas/$pecaId")({
  head: () => ({
    meta: [
      { title: "Peça em aprovação — Aprova" },
      { name: "description", content: "Arte, comentários com marcação e histórico da peça." },
      { property: "og:title", content: "Peça em aprovação — Aprova" },
      {
        property: "og:description",
        content: "Arte, comentários com marcação e histórico da peça.",
      },
    ],
  }),
  component: TelaPeca,
});

interface Peca {
  id: string;
  campanha_id: string;
  nome: string;
  tamanho: string | null;
  status: PieceStatus;
  versao_atual: number;
}
interface Versao {
  id: string;
  numero: number;
  imagem_path: string | null;
  observacao: string | null;
  created_at: string;
}
interface Comentario {
  id: string;
  versao_id: string | null;
  handoff_id: string | null;
  autor_user_id: string | null;
  autor_papel: "criacao" | "atendimento" | "cliente";
  texto: string;
  texto_original: string | null;
  pin_x: number | null;
  pin_y: number | null;
  visivel_para_cliente: boolean;
  editavel: boolean;
  edicao_autorizada: boolean;
  locked_em: string | null;
  created_at: string;
}
interface Handoff {
  id: string;
  de_papel: string;
  para_papel: string;
  enviado_por: string | null;
  enviado_em: string;
  visto_em: string | null;
  recolhido_em: string | null;
}
interface Evento {
  id: string;
  tipo: keyof typeof EVENTO_LABEL;
  ator_nome: string | null;
  ator_papel: string | null;
  detalhe: string | null;
  created_at: string;
}

function TelaPeca() {
  const { pecaId } = Route.useParams();
  const { papel, temPapel, userId } = useAuth();
  const qc = useQueryClient();
  const inputArquivo = useRef<HTMLInputElement>(null);

  const [versaoSelecionada, setVersaoSelecionada] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [visivelCliente, setVisivelCliente] = useState(true);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [urlImagem, setUrlImagem] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [modalMotivo, setModalMotivo] = useState(false);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [modalContatos, setModalContatos] = useState(false);
  const [contatosSelecionados, setContatosSelecionados] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["peca", pecaId],
    queryFn: async () => {
      await supabase.rpc("marcar_visto", { p_peca_id: pecaId });
      const { data: peca, error } = await supabase
        .from("pecas")
        .select("id, campanha_id, nome, tamanho, status, versao_atual")
        .eq("id", pecaId)
        .maybeSingle();
      if (error) throw error;
      const versoes = await buscarTudo<Versao>(() =>
        supabase
          .from("peca_versoes")
          .select("id, numero, imagem_path, observacao, created_at")
          .eq("peca_id", pecaId)
          .order("numero", { ascending: true })
          .order("id"),
      );
      const comentarios = await buscarTudo<Comentario>(() =>
        supabase
          .from("comentarios")
          .select(
            "id, versao_id, handoff_id, autor_user_id, autor_papel, texto, texto_original, pin_x, pin_y, visivel_para_cliente, editavel, edicao_autorizada, locked_em, created_at",
          )
          .eq("peca_id", pecaId)
          .order("created_at", { ascending: true })
          .order("id"),
      );
      const handoffs = await buscarTudo<Handoff>(() =>
        supabase
          .from("handoffs")
          .select("id, de_papel, para_papel, enviado_por, enviado_em, visto_em, recolhido_em")
          .eq("peca_id", pecaId)
          .order("enviado_em", { ascending: false })
          .order("id"),
      );
      const eventos = await buscarTudo<Evento>(() =>
        supabase
          .from("eventos")
          .select("id, tipo, ator_nome, ator_papel, detalhe, created_at")
          .eq("peca_id", pecaId)
          .order("created_at", { ascending: false })
          .order("id"),
      );
      return { peca: peca as Peca | null, versoes, comentarios, handoffs, eventos };
    },
  });

  const peca = data?.peca ?? null;
  const versoes = data?.versoes ?? [];
  const versaoAtiva =
    versoes.find((v) => v.id === versaoSelecionada) ?? versoes[versoes.length - 1] ?? null;

  useEffect(() => {
    let ativo = true;
    void urlAssinada(versaoAtiva?.imagem_path).then((u) => {
      if (ativo) setUrlImagem(u);
    });
    return () => {
      ativo = false;
    };
  }, [versaoAtiva?.imagem_path]);

  const comentariosVersao = (data?.comentarios ?? []).filter(
    (c) => c.versao_id === versaoAtiva?.id,
  );
  const pins = comentariosVersao.filter((c) => c.pin_x != null && c.pin_y != null);
  const ultimoHandoff = (data?.handoffs ?? []).find((h) => !h.recolhido_em) ?? null;
  const podeRecolher =
    !!ultimoHandoff &&
    !ultimoHandoff.visto_em &&
    (ultimoHandoff.enviado_por === userId || temPapel("admin"));
  const handoffCliente = (data?.handoffs ?? []).find(
    (h) => h.de_papel === "cliente" && !h.recolhido_em,
  );

  const status = peca?.status;
  const souCriacao = temPapel("criacao", "admin");
  const souAtendimento = temPapel("atendimento", "admin");
  const podeComentar =
    (souCriacao && status === "criacao_ajustando") ||
    (souAtendimento && (status === "aguardando_atendimento" || status === "retorno_atendimento"));

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ["peca", pecaId] });
    void qc.invalidateQueries({ queryKey: ["pecas"] });
    void qc.invalidateQueries({ queryKey: ["painel"] });
  }

  const comentar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("comentar_interno", {
        p_peca_id: pecaId,
        p_texto: texto.trim(),
        p_visivel_cliente: visivelCliente,
        ...(pin ? { p_pin_x: pin.x, p_pin_y: pin.y } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTexto("");
      setPin(null);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviar = useMutation({
    mutationFn: async (contatoIds?: string[]) => {
      const { error } = await supabase.rpc("enviar_peca", {
        p_peca_id: pecaId,
        ...(contatoIds && contatoIds.length > 0 ? { p_contato_ids: contatoIds } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Peça enviada.");
      setModalContatos(false);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recolher = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("recolher_envio", { p_peca_id: pecaId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Envio recolhido.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const autorizar = useMutation({
    mutationFn: async () => {
      if (!handoffCliente) throw new Error("Não há devolução do cliente para liberar.");
      const { error } = await supabase.rpc("autorizar_edicao_cliente", {
        p_handoff_id: handoffCliente.id,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Edição liberada para o cliente.");
      setMotivo("");
      setModalMotivo(false);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function subirArte(arquivo: File) {
    setEnviandoArquivo(true);
    try {
      const ext = arquivo.name.split(".").pop() ?? "png";
      const caminho = `${pecaId}/${crypto.randomUUID()}.${ext}`;
      const { error: erroUpload } = await supabase.storage
        .from("peca-imagens")
        .upload(caminho, arquivo, { contentType: arquivo.type });
      if (erroUpload) throw erroUpload;
      const { error } = await supabase.rpc("subir_versao", {
        p_peca_id: pecaId,
        p_imagem_url: caminho,
        p_imagem_path: caminho,
      });
      if (error) throw error;
      toast.success("Nova versão publicada.");
      setVersaoSelecionada(null);
      invalidar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao subir a arte.");
    } finally {
      setEnviandoArquivo(false);
    }
  }

  function clicarImagem(e: React.MouseEvent<HTMLDivElement>) {
    if (!podeComentar) return;
    const box = e.currentTarget.getBoundingClientRect();
    setPin({
      x: Number(((e.clientX - box.left) / box.width).toFixed(4)),
      y: Number(((e.clientY - box.top) / box.height).toFixed(4)),
    });
  }

  if (isLoading) return <Skeleton className="h-[70vh] rounded-3xl" />;
  if (!peca) return <p className="text-sm text-muted-foreground">Peça não encontrada.</p>;

  const rotuloEnvio =
    status === "criacao_ajustando"
      ? "Enviar para o Atendimento"
      : status === "aguardando_atendimento"
        ? "Enviar para o Cliente"
        : status === "retorno_atendimento"
          ? "Enviar para Correção (Criação)"
          : null;
  const podeEnviar =
    (status === "criacao_ajustando" && souCriacao && peca.versao_atual > 0) ||
    ((status === "aguardando_atendimento" || status === "retorno_atendimento") && souAtendimento);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/campanhas/$campanhaId"
            params={{ campanhaId: peca.campanha_id }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Voltar à campanha
          </Link>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">{peca.nome}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={peca.status} />
            <span className="text-sm text-muted-foreground">
              {peca.tamanho ?? "sem tamanho"} · v{peca.versao_atual}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {souCriacao && status === "criacao_ajustando" && (
            <>
              <input
                ref={inputArquivo}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void subirArte(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                className="rounded-2xl"
                disabled={enviandoArquivo}
                onClick={() => inputArquivo.current?.click()}
              >
                <Upload className="mr-1 size-4" />
                {enviandoArquivo ? "Enviando..." : "Subir/atualizar arte"}
              </Button>
            </>
          )}

          {souAtendimento && status === "retorno_atendimento" && handoffCliente && (
            <Button variant="outline" className="rounded-2xl" onClick={() => setModalMotivo(true)}>
              <Unlock className="mr-1 size-4" /> Autorizar edição do cliente
            </Button>
          )}

          {podeRecolher && (
            <Button variant="ghost" className="rounded-2xl" onClick={() => recolher.mutate()}>
              <Undo2 className="mr-1 size-4" /> Recolher envio
            </Button>
          )}

          {rotuloEnvio && podeEnviar && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95">
                  <Send className="mr-1 size-4" /> {rotuloEnvio}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-3xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar envio?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Depois que a outra parte visualizar, seus comentários desta rodada ficam
                    bloqueados para edição.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
                  <AlertDialogAction className="rounded-2xl" onClick={() => enviar.mutate()}>
                    Enviar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="rounded-3xl border bg-card p-4 shadow-soft">
          <div className="mb-3 flex flex-wrap gap-2">
            {versoes.map((v) => (
              <button
                key={v.id}
                onClick={() => setVersaoSelecionada(v.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  v.id === versaoAtiva?.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                v{v.numero}
              </button>
            ))}
            {versoes.length === 0 && (
              <span className="text-xs text-muted-foreground">Nenhuma arte enviada ainda.</span>
            )}
          </div>

          <div
            onClick={clicarImagem}
            className={cn(
              "relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-2xl bg-muted",
              podeComentar && "cursor-crosshair",
            )}
          >
            {urlImagem ? (
              <img
                src={urlImagem}
                alt={`Arte da peça ${peca.nome}`}
                className="max-h-[70vh] w-full object-contain"
              />
            ) : (
              <p className="p-10 text-sm text-muted-foreground">Sem arte nesta versão.</p>
            )}

            {pins.map((c, i) => (
              <span
                key={c.id}
                title={c.texto}
                style={{ left: `${(c.pin_x ?? 0) * 100}%`, top: `${(c.pin_y ?? 0) * 100}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground shadow-soft"
              >
                {i + 1}
              </span>
            ))}
            {pin && (
              <span
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                className="absolute size-4 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-cyan ring-2 ring-primary"
              />
            )}
          </div>
          {podeComentar && (
            <p className="mt-2 text-xs text-muted-foreground">
              Clique na arte para marcar um ponto antes de comentar.
            </p>
          )}
        </section>

        <aside className="rounded-3xl border bg-card p-4 shadow-soft">
          <Tabs defaultValue="comentarios">
            <TabsList className="grid w-full grid-cols-2 rounded-2xl">
              <TabsTrigger value="comentarios" className="rounded-xl">
                <MessageSquare className="mr-1 size-4" /> Comentários
              </TabsTrigger>
              <TabsTrigger value="linha" className="rounded-xl">
                <History className="mr-1 size-4" /> Linha do tempo
              </TabsTrigger>
            </TabsList>

            <TabsContent value="comentarios" className="mt-4 space-y-3">
              {comentariosVersao.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum comentário nesta versão.
                </p>
              )}
              {comentariosVersao.map((c, i) => (
                <article key={c.id} className="rounded-2xl border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {c.pin_x != null && (
                        <span className="mr-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                          {pins.findIndex((p) => p.id === c.id) + 1}
                        </span>
                      )}
                      {PAPEL_LABEL[c.autor_papel]}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {formatarData(c.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{c.texto}</p>
                  {c.texto_original && c.texto_original !== c.texto && (
                    <p className="mt-1 text-xs text-muted-foreground line-through">
                      antes: {c.texto_original}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {c.editavel ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 font-medium text-success-foreground">
                        <Eye className="size-3" /> Ainda não visto — pode editar
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                        <Lock className="size-3" /> Visto em {formatarData(c.locked_em)} — bloqueado
                      </span>
                    )}
                    {c.edicao_autorizada && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/25 px-2 py-0.5 font-medium text-warning-foreground">
                        <ShieldCheck className="size-3" /> Edição autorizada pelo atendimento
                      </span>
                    )}
                    {c.autor_papel === "atendimento" && c.visivel_para_cliente && (
                      <span className="rounded-full bg-cyan/25 px-2 py-0.5 font-medium text-cyan-foreground">
                        visível para o cliente
                      </span>
                    )}
                  </div>
                  <span className="sr-only">{i}</span>
                </article>
              ))}

              {podeComentar && (
                <div className="space-y-2 rounded-2xl border bg-background p-3">
                  <Textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder={
                      pin ? "Comentário sobre o ponto marcado..." : "Escreva um comentário..."
                    }
                    className="min-h-20 rounded-xl"
                  />
                  {souAtendimento && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="visivel"
                        checked={visivelCliente}
                        onCheckedChange={(v) => setVisivelCliente(v === true)}
                      />
                      <Label htmlFor="visivel" className="text-xs font-normal">
                        Visível para o cliente
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    {pin ? (
                      <button
                        onClick={() => setPin(null)}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        remover marcação
                      </button>
                    ) : (
                      <span />
                    )}
                    <Button
                      size="sm"
                      className="gradient-brand rounded-xl text-primary-foreground hover:opacity-95"
                      disabled={!texto.trim() || comentar.isPending}
                      onClick={() => comentar.mutate()}
                    >
                      Comentar
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="linha" className="mt-4 space-y-3">
              {(data?.eventos ?? []).map((ev) => (
                <div key={ev.id} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  <div>
                    <p className="text-sm">
                      <strong>{ev.ator_nome ?? "Alguém"}</strong>{" "}
                      <span className="text-muted-foreground">
                        ({PAPEL_LABEL[ev.ator_papel ?? ""] ?? "—"})
                      </span>{" "}
                      {EVENTO_LABEL[ev.tipo] ?? ev.tipo}
                    </p>
                    {ev.detalhe && <p className="text-xs text-muted-foreground">{ev.detalhe}</p>}
                    <p className="text-[11px] text-muted-foreground">
                      {formatarData(ev.created_at)}
                    </p>
                  </div>
                </div>
              ))}
              {(data?.eventos ?? []).length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Sem histórico ainda.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <Dialog open={modalMotivo} onOpenChange={setModalMotivo}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Autorizar edição do cliente</DialogTitle>
            <DialogDescription>
              O motivo fica registrado no histórico da peça e é obrigatório.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: cliente pediu para corrigir o preço informado por engano."
            className="min-h-24 rounded-2xl"
          />
          <DialogFooter>
            <Button
              disabled={!motivo.trim() || autorizar.isPending}
              onClick={() => autorizar.mutate()}
              className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
            >
              Liberar edição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
