import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Eye,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { LogoAprovAI } from "@/components/LogoAprovAI";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PAPEL_LABEL, STATUS_LABEL, formatarData, type PieceStatus } from "@/lib/aprova";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  AnotacaoView,
  anotacaoParaJson,
  BarraAnotacao,
  CamadaAnotacao,
  lerAnotacao,
  useAnotador,
} from "@/components/Anotacao";
import { MolduraArte } from "@/components/MolduraArte";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/aprovar/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Aprovação de peça — AprovAI" },
      { name: "description", content: "Avalie a arte, comente e aprove ou devolva com pedidos." },
      { property: "og:title", content: "Aprovação de peça — AprovAI" },
      {
        property: "og:description",
        content: "Avalie a arte, comente e aprove ou devolva com pedidos.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TelaCliente,
});

type StatusCaso = "aberta" | "feita" | "revisada" | "aprovada";

interface ComentarioCliente {
  id: string;
  versao_id: string | null;
  autor_papel: "criacao" | "atendimento" | "cliente";
  autor_cliente_contato_id: string | null;
  texto: string;
  pin_x: number | null;
  pin_y: number | null;
  anotacao_json: unknown;
  editavel: boolean;
  edicao_autorizada: boolean;
  eh_caso: boolean | null;
  status_caso: StatusCaso | null;
  created_at: string;
}

interface RespostaCliente {
  contato: { id: string; nome: string | null };
  /** Situação deste aprovador na rodada atual. */
  acesso?: {
    decisao: string | null;
    decidido_em: string | null;
    total: number;
    decididos: number;
    aprovados: number;
  };
  peca: {
    id: string;
    nome: string;
    tamanho: string | null;
    status: PieceStatus;
    versao_atual: number;
    modo_aprovacao: string | null;
  };
  versoes: { id: string; numero: number; imagem_path: string | null }[];
  comentarios: ComentarioCliente[];
  eventos: { tipo: string; ator_nome: string | null; created_at: string }[];
}

const SELO_CASO: Record<StatusCaso, { rotulo: string; classe: string }> = {
  aberta: { rotulo: "Pedido", classe: "bg-warning/25 text-warning-foreground" },
  feita: { rotulo: "Em revisão na agência", classe: "bg-info/25 text-info-foreground" },
  revisada: { rotulo: "Corrigida — confira", classe: "bg-cyan/25 text-cyan-foreground" },
  aprovada: { rotulo: "Aprovada", classe: "bg-success/25 text-success-foreground" },
};

const CASO_FUNDO: Record<StatusCaso, string> = {
  aberta: "bg-warning/15",
  feita: "bg-info/15",
  revisada: "bg-cyan/15",
  aprovada: "bg-success/15",
};

function TelaCliente() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [textoGeral, setTextoGeral] = useState("");
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [urlImagem, setUrlImagem] = useState<string | null>(null);
  const [emFoco, setEmFoco] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState<string | null>(null);
  const [textoCorrecao, setTextoCorrecao] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [textoEdicao, setTextoEdicao] = useState("");
  const anotador = useAnotador();

  const { data, isLoading, error } = useQuery({
    queryKey: ["cliente", token],
    retry: false,
    queryFn: async () => {
      const { data: resposta, error: erro } = await supabase.rpc("cliente_abrir", {
        p_token: token,
      });
      if (erro) throw erro;
      return resposta as unknown as RespostaCliente;
    },
  });

  const versaoAtual = data?.versoes.find((v) => v.numero === data.peca.versao_atual) ?? null;

  const versaoAtualId = versaoAtual?.id ?? null;

  useEffect(() => {
    if (!versaoAtual?.imagem_path || !versaoAtualId) {
      setUrlImagem(null);
      return;
    }
    let ativo = true;
    void (async () => {
      try {
        const resposta = await fetch("/api/public/arte-cliente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, versao_id: versaoAtualId }),
        });
        if (!resposta.ok) throw new Error("falha ao abrir a arte");
        const corpo = (await resposta.json()) as { url?: string };
        if (ativo) setUrlImagem(corpo.url ?? null);
      } catch {
        if (ativo) setUrlImagem(null);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [token, versaoAtualId, versaoAtual?.imagem_path]);

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ["cliente", token] });
  }

  const comentar = useMutation({
    mutationFn: async (entrada: { texto: string; ehCaso: boolean; comDesenho: boolean }) => {
      const { error: erro } = await supabase.rpc("cliente_comentar", {
        p_token: token,
        p_texto: entrada.texto.trim(),
        p_eh_caso: entrada.ehCaso,
        ...(entrada.ehCaso && pin ? { p_pin_x: pin.x, p_pin_y: pin.y } : {}),
        ...(entrada.comDesenho && anotador.strokes.length > 0
          ? { p_anotacao_json: anotacaoParaJson(anotador.strokes) }
          : {}),
      });
      if (erro) throw erro;
    },
    onSuccess: (_d, entrada) => {
      if (entrada.ehCaso) {
        setTexto("");
        setPin(null);
        anotador.limpar();
        anotador.setDesenhando(false);
      } else {
        setTextoGeral("");
        setCorrigindo(null);
        setTextoCorrecao("");
      }
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decidirCaso = useMutation({
    mutationFn: async (entrada: { id: string; decisao: "aprovar" }) => {
      const { error: erro } = await supabase.rpc("cliente_decidir_caso", {
        p_token: token,
        p_comentario_id: entrada.id,
        p_decisao: entrada.decisao,
      });
      if (erro) throw erro;
    },
    onSuccess: () => {
      toast.success("Marcação aprovada.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Reabre uma marcação corrigida e registra o que ainda falta. */
  const pedirCorrecao = useMutation({
    mutationFn: async (entrada: { id: string; numero: number; texto: string }) => {
      const { error: erro } = await supabase.rpc("cliente_decidir_caso", {
        p_token: token,
        p_comentario_id: entrada.id,
        p_decisao: "pedir_correcao",
      });
      if (erro) throw erro;
      const complemento = entrada.texto.trim();
      if (complemento) {
        const { error: erro2 } = await supabase.rpc("cliente_comentar", {
          p_token: token,
          p_texto: `Sobre a marcação ${entrada.numero}: ${complemento}`,
          p_eh_caso: false,
        });
        if (erro2) throw erro2;
      }
    },
    onSuccess: () => {
      setCorrigindo(null);
      setTextoCorrecao("");
      toast.success("Pedido de correção registrado.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editarCaso = useMutation({
    mutationFn: async (entrada: { id: string; texto: string }) => {
      const { error: erro } = await supabase.rpc("cliente_editar_comentario", {
        p_token: token,
        p_comentario_id: entrada.id,
        p_texto: entrada.texto.trim(),
      });
      if (erro) throw erro;
    },
    onSuccess: () => {
      setEditando(null);
      setTextoEdicao("");
      toast.success("Marcação atualizada.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerCaso = useMutation({
    mutationFn: async (id: string) => {
      const { error: erro } = await supabase.rpc("cliente_remover_caso", {
        p_token: token,
        p_comentario_id: id,
      });
      if (erro) throw erro;
    },
    onSuccess: () => {
      toast.success("Marcação removida.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aprovarTudo = useMutation({
    mutationFn: async () => {
      const { error: erro } = await supabase.rpc("cliente_aprovar_tudo", { p_token: token });
      if (erro) throw erro;
    },
    onSuccess: () => {
      toast.success("Peça aprovada. Obrigado!");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const devolver = useMutation({
    mutationFn: async () => {
      const { error: erro } = await supabase.rpc("cliente_devolver", { p_token: token });
      if (erro) throw erro;
    },
    onSuccess: () => {
      toast.success("Enviado para a agência com seus pedidos.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-xl font-bold">Link indisponível</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este link de aprovação expirou ou não é válido. Peça um novo para a agência.
          </p>
        </div>
      </div>
    );
  }

  const modo = data.peca.modo_aprovacao === "um" ? "um" : "todos";
  const jaRespondeu = !!data.acesso?.decisao;
  const aguardandoDemais = jaRespondeu && data.peca.status === "aguardando_cliente";
  const aberta = data.peca.status === "aguardando_cliente" && !jaRespondeu;

  const daVersao = (c: ComentarioCliente) =>
    versaoAtual ? c.versao_id === versaoAtual.id : c.versao_id === null;
  const casos = data.comentarios.filter((c) => c.eh_caso && daVersao(c));
  const gerais = data.comentarios.filter((c) => !c.eh_caso);
  const abertos = casos.filter((c) => c.status_caso === "aberta");
  /** Marcações que voltaram corrigidas e ainda esperam a decisão do cliente. */
  const aDecidir = casos.filter((c) => c.status_caso !== "aberta" && c.status_caso !== "aprovada");
  const aprovadas = casos.filter((c) => c.status_caso === "aprovada");
  const podeAprovarTudo = abertos.length === 0 && aDecidir.length === 0;

  const caso = casos.find((c) => c.id === emFoco) ?? null;
  const strokesEmFoco = caso ? lerAnotacao(caso.anotacao_json) : [];

  return (
    <div className="min-h-screen bg-background pb-36">
      <header className="gradient-brand px-5 py-6 text-primary-foreground">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <LogoAprovAI tamanho={28} className="rounded-xl bg-white/20 [background-image:none]" />
          <span className="font-bold">AprovAI</span>
        </div>
        <div className="mx-auto mt-4 max-w-3xl">
          <p className="text-sm opacity-90">Olá, {data.contato.nome ?? "tudo bem"}!</p>
          <h1 className="text-2xl font-extrabold">{data.peca.nome}</h1>
          <p className="text-sm opacity-90">
            {data.peca.tamanho ?? "sem tamanho"} · versão {data.peca.versao_atual} ·{" "}
            {STATUS_LABEL[data.peca.status]}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {data.peca.status === "aguardando_cliente" && (
          <p
            className={cn(
              "rounded-2xl p-3 text-sm",
              modo === "um"
                ? "bg-warning/25 text-warning-foreground"
                : "bg-accent text-accent-foreground",
            )}
          >
            {modo === "um"
              ? "Sua aprovação sozinha já aprova esta peça."
              : "Todos os aprovadores precisam aprovar para a peça seguir."}
          </p>
        )}

        <section className="rounded-3xl border bg-card p-3 shadow-soft">
          {aberta && <BarraAnotacao estado={anotador} className="mb-3" />}
          <MolduraArte
            src={urlImagem}
            alt={`Arte da peça ${data.peca.nome}`}
            alturaMaxima="70vh"
            cursorCruz={aberta && !anotador.desenhando}
            aoClicar={aberta ? (p: { x: number; y: number }) => setPin(p) : undefined}
            vazio={<p className="p-10 text-sm text-muted-foreground">Arte indisponível.</p>}
          >
            {casos.map((c, i) =>
              c.pin_x != null && c.pin_y != null ? (
                <button
                  key={c.id}
                  type="button"
                  title={c.texto}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEmFoco((atual) => (atual === c.id ? null : c.id));
                  }}
                  style={{ left: `${c.pin_x * 100}%`, top: `${c.pin_y * 100}%` }}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-xs font-bold shadow-soft ring-2 transition",
                    c.status_caso === "aprovada"
                      ? "bg-success text-success-foreground ring-success"
                      : "bg-primary text-primary-foreground ring-primary",
                    emFoco === c.id && "scale-125 ring-4 ring-cyan",
                  )}
                >
                  {i + 1}
                </button>
              ) : null,
            )}
            {pin && (
              <span
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                className="absolute size-4 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-cyan ring-2 ring-primary"
              />
            )}
            {strokesEmFoco.length > 0 && <AnotacaoView strokes={strokesEmFoco} />}
            {aberta && <CamadaAnotacao estado={anotador} />}
          </MolduraArte>
          {aberta && (
            <p className="px-2 pt-2 text-xs text-muted-foreground">
              {anotador.desenhando
                ? "Rabisque sobre a arte. O desenho vai junto com a sua marcação."
                : "Toque na arte para marcar exatamente o ponto e escreva o que precisa mudar."}
            </p>
          )}
        </section>

        {/* Marcações */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Marcações
            </h2>
            {casos.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                {aprovadas.length} de {casos.length} aprovadas
              </span>
            )}
          </div>

          {casos.length === 0 && (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma marcação ainda. Se estiver tudo certo, use “Aprovar tudo”.
            </p>
          )}

          {casos.map((c, i) => {
            const selo = SELO_CASO[c.status_caso ?? "aberta"];
            const meu = c.autor_cliente_contato_id === data.contato.id;
            return (
              <article
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setEmFoco((atual) => (atual === c.id ? null : c.id))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    setEmFoco((atual) => (atual === c.id ? null : c.id));
                }}
                className={cn(
                  "cursor-pointer rounded-3xl border-2 p-4 shadow-soft transition",
                  CASO_FUNDO[c.status_caso ?? "aberta"],
                  emFoco === c.id ? "border-primary ring-2 ring-primary/30" : "border-border",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold",
                      c.status_caso === "aprovada"
                        ? "bg-success text-success-foreground"
                        : "gradient-brand text-primary-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">
                        {meu ? "Você" : PAPEL_LABEL[c.autor_papel]}
                      </p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          selo.classe,
                        )}
                      >
                        {selo.rotulo}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatarData(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{c.texto}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={emFoco === c.id ? "default" : "outline"}
                        className={cn(
                          "rounded-xl",
                          emFoco === c.id && "gradient-brand text-primary-foreground",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEmFoco((atual) => (atual === c.id ? null : c.id));
                        }}
                      >
                        <Eye className="mr-1 size-4" />
                        {emFoco === c.id ? "Ocultar na arte" : "Ver na arte"}
                      </Button>

                      {aberta && c.status_caso === "aberta" && meu && c.editavel && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCorrigindo(null);
                              setEditando((atual) => (atual === c.id ? null : c.id));
                              setTextoEdicao(c.texto);
                            }}
                          >
                            <Pencil className="mr-1 size-4" /> Editar
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="rounded-xl text-destructive"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Trash2 className="mr-1 size-4" /> Remover
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent
                              className="rounded-3xl"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remover esta marcação?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  O pedido “{c.texto}” será apagado. Esta ação não pode ser
                                  desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="rounded-2xl">
                                  Cancelar
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  className="rounded-2xl"
                                  onClick={() => removerCaso.mutate(c.id)}
                                >
                                  Remover
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}

                      {aberta && c.status_caso === "revisada" && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            className="rounded-xl bg-success text-success-foreground hover:opacity-90"
                            disabled={decidirCaso.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              decidirCaso.mutate({ id: c.id, decisao: "aprovar" });
                            }}
                          >
                            <CheckCircle2 className="mr-1 size-4" /> Aprovar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditando(null);
                              setCorrigindo((atual) => (atual === c.id ? null : c.id));
                              setTextoCorrecao("");
                            }}
                          >
                            <MessageSquarePlus className="mr-1 size-4" /> Pedir correção
                          </Button>
                        </>
                      )}
                    </div>

                    {aberta && editando === c.id && (
                      <div
                        className="mt-3 space-y-2 rounded-2xl bg-muted/50 p-3"
                        onClick={(e) => e.stopPropagation()}
                        role="presentation"
                      >
                        <Textarea
                          value={textoEdicao}
                          onChange={(e) => setTextoEdicao(e.target.value)}
                          placeholder="Reescreva o que precisa mudar..."
                          className="min-h-20 rounded-xl"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-xl"
                            onClick={() => setEditando(null)}
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            className="gradient-brand rounded-xl text-primary-foreground"
                            disabled={!textoEdicao.trim() || editarCaso.isPending}
                            onClick={() => editarCaso.mutate({ id: c.id, texto: textoEdicao })}
                          >
                            Salvar
                          </Button>
                        </div>
                      </div>
                    )}

                    {aberta && corrigindo === c.id && (
                      <div
                        className="mt-3 space-y-2 rounded-2xl bg-muted/50 p-3"
                        onClick={(e) => e.stopPropagation()}
                        role="presentation"
                      >
                        <Textarea
                          value={textoCorrecao}
                          onChange={(e) => setTextoCorrecao(e.target.value)}
                          placeholder="O que ainda falta nesta marcação?"
                          className="min-h-20 rounded-xl"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-xl"
                            onClick={() => setCorrigindo(null)}
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            className="gradient-brand rounded-xl text-primary-foreground"
                            disabled={!textoCorrecao.trim() || pedirCorrecao.isPending}
                            onClick={() =>
                              pedirCorrecao.mutate({
                                id: c.id,
                                numero: i + 1,
                                texto: textoCorrecao,
                              })
                            }
                          >
                            Enviar pedido
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {aberta && (
            <div className="space-y-2 rounded-3xl border-2 border-dashed border-primary/40 bg-card p-3">
              <p className="text-sm font-semibold">Nova marcação</p>
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder={pin ? "O que mudar neste ponto?" : "Escreva o que precisa mudar..."}
                className="min-h-24 rounded-xl"
              />
              <div className="flex items-center justify-between">
                {pin ? (
                  <button
                    onClick={() => setPin(null)}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    remover ponto marcado
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Toque na arte para marcar o ponto
                  </span>
                )}
                <Button
                  size="sm"
                  className="gradient-brand rounded-xl text-primary-foreground"
                  disabled={!texto.trim() || comentar.isPending}
                  onClick={() =>
                    comentar.mutate({ texto, ehCaso: true, comDesenho: true })
                  }
                >
                  Criar marcação
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Comentário geral */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Comentário geral
          </h2>
          {gerais.map((c) => (
            <article key={c.id} className="rounded-2xl border bg-card p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">
                  {c.autor_cliente_contato_id === data.contato.id
                    ? "Você"
                    : PAPEL_LABEL[c.autor_papel]}
                </p>
                <span className="text-xs text-muted-foreground">{formatarData(c.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.texto}</p>
            </article>
          ))}
          {aberta && (
            <div className="space-y-2 rounded-2xl border bg-card p-3">
              <Textarea
                value={textoGeral}
                onChange={(e) => setTextoGeral(e.target.value)}
                placeholder="Um recado geral para a agência (não vira marcação)..."
                className="min-h-20 rounded-xl"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  disabled={!textoGeral.trim() || comentar.isPending}
                  onClick={() =>
                    comentar.mutate({ texto: textoGeral, ehCaso: false, comDesenho: false })
                  }
                >
                  Enviar comentário
                </Button>
              </div>
            </div>
          )}
        </section>

        {aguardandoDemais ? (
          <div className="rounded-2xl bg-accent p-4 text-center text-sm text-accent-foreground">
            <p className="font-semibold">Recebemos sua resposta.</p>
            <p className="mt-1">
              Aguardando os demais aprovadores
              {data.acesso ? ` — ${data.acesso.decididos} de ${data.acesso.total} responderam.` : "."}
            </p>
          </div>
        ) : (
          !aberta && (
            <p className="rounded-2xl bg-accent p-4 text-center text-sm text-accent-foreground">
              {data.peca.status === "aprovada"
                ? "Esta peça já foi aprovada. Obrigado!"
                : "A agência está trabalhando nesta peça. Você será avisado quando ela voltar."}
            </p>
          )
        )}
      </main>

      {aberta && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-card/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-3xl space-y-2">
            {abertos.length > 0 ? (
              <p className="text-center text-xs font-medium text-warning-foreground">
                Você tem {abertos.length} pedido{abertos.length === 1 ? "" : "s"} de correção (
                {abertos.map((c) => `#${casos.indexOf(c) + 1}`).join(", ")}). Devolva para a agência
                corrigir.
              </p>
            ) : (
              aDecidir.length > 0 && (
                <p className="text-center text-xs font-medium text-warning-foreground">
                  Decida cada marcação que voltou corrigida (
                  {aDecidir.map((c) => `#${casos.indexOf(c) + 1}`).join(", ")}) antes de finalizar.
                </p>
              )
            )}
            <div className="flex gap-3">
              {abertos.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="flex-1 rounded-2xl">
                      <Undo2 className="mr-1 size-4" /> Devolver para correção
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-3xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Enviar para o atendimento?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Suas marcações vão para a agência e ficam bloqueadas para edição depois que
                        forem lidas.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
                      <AlertDialogAction className="rounded-2xl" onClick={() => devolver.mutate()}>
                        Enviar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              {podeAprovarTudo ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="gradient-brand flex-1 rounded-2xl text-primary-foreground hover:opacity-95">
                      <CheckCircle2 className="mr-1 size-4" /> Aprovar tudo
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-3xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Aprovar esta peça?</AlertDialogTitle>
                      <AlertDialogDescription>
                        A aprovação é definitiva e libera a peça para produção.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="rounded-2xl"
                        onClick={() => aprovarTudo.mutate()}
                      >
                        Aprovar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button
                  disabled
                  className="flex-1 rounded-2xl"
                  title={
                    abertos.length > 0
                      ? "Devolva seus pedidos para a agência corrigir."
                      : "Decida cada marcação que voltou corrigida."
                  }
                >
                  <CheckCircle2 className="mr-1 size-4" /> Aprovar tudo
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
