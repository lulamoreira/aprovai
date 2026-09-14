import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Undo2 } from "lucide-react";
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
  comentarios: {
    id: string;
    versao_id: string | null;
    autor_papel: "criacao" | "atendimento" | "cliente";
    texto: string;
    pin_x: number | null;
    pin_y: number | null;
    anotacao_json: unknown;
    editavel: boolean;
    edicao_autorizada: boolean;
    created_at: string;
  }[];
  eventos: { tipo: string; ator_nome: string | null; created_at: string }[];
}

function TelaCliente() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [urlImagem, setUrlImagem] = useState<string | null>(null);
  const [marcacaoVisivel, setMarcacaoVisivel] = useState<string | null>(null);
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

  useEffect(() => {
    if (!versaoAtual?.imagem_path) {
      setUrlImagem(null);
      return;
    }
    const { data: publica } = supabase.storage
      .from("peca-imagens")
      .getPublicUrl(versaoAtual.imagem_path);
    setUrlImagem(publica?.publicUrl ?? null);
  }, [versaoAtual?.imagem_path]);

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ["cliente", token] });
  }

  const comentar = useMutation({
    mutationFn: async () => {
      const { error: erro } = await supabase.rpc("cliente_comentar", {
        p_token: token,
        p_texto: texto.trim(),
        ...(pin ? { p_pin_x: pin.x, p_pin_y: pin.y } : {}),
        ...(anotador.strokes.length > 0
          ? { p_anotacao_json: anotacaoParaJson(anotador.strokes) }
          : {}),
      });
      if (erro) throw erro;
    },
    onSuccess: () => {
      setTexto("");
      setPin(null);
      anotador.limpar();
      anotador.setDesenhando(false);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aprovar = useMutation({
    mutationFn: async () => {
      const { error: erro } = await supabase.rpc("cliente_aprovar", { p_token: token });
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
      toast.success("Enviado para a agência com seus comentários.");
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

  const aberta = data.peca.status === "aguardando_cliente";
  const pins = data.comentarios.filter(
    (c) => c.versao_id === versaoAtual?.id && c.pin_x != null && c.pin_y != null,
  );

  return (
    <div className="min-h-screen bg-background pb-28">
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
        <section className="rounded-3xl border bg-card p-3 shadow-soft">
          {aberta && <BarraAnotacao estado={anotador} className="mb-3" />}
          <div
            className={cn(
              "relative flex min-h-[240px] items-center justify-center overflow-hidden rounded-2xl bg-muted",
              aberta && !anotador.desenhando && "cursor-crosshair",
            )}
            onClick={(e) => {
              if (!aberta) return;
              const box = e.currentTarget.getBoundingClientRect();
              setPin({
                x: Number(((e.clientX - box.left) / box.width).toFixed(4)),
                y: Number(((e.clientY - box.top) / box.height).toFixed(4)),
              });
            }}
          >
            {urlImagem ? (
              <img
                src={urlImagem}
                alt={`Arte da peça ${data.peca.nome}`}
                className="w-full object-contain"
              />
            ) : (
              <p className="p-10 text-sm text-muted-foreground">Arte indisponível.</p>
            )}
            {pins.map((c, i) => (
              <span
                key={c.id}
                title={c.texto}
                style={{ left: `${(c.pin_x ?? 0) * 100}%`, top: `${(c.pin_y ?? 0) * 100}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground"
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
            {marcacaoVisivel && (
              <AnotacaoView
                strokes={lerAnotacao(
                  data.comentarios.find((c) => c.id === marcacaoVisivel)?.anotacao_json,
                )}
              />
            )}
            {aberta && <CamadaAnotacao estado={anotador} />}
          </div>
          {aberta && (
            <p className="px-2 pt-2 text-xs text-muted-foreground">
              {anotador.desenhando
                ? "Rabisque sobre a arte. O desenho vai junto com o seu comentário."
                : "Toque na arte para marcar exatamente o ponto do seu comentário."}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Conversa
          </h2>
          {data.comentarios.length === 0 && (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhum comentário ainda.
            </p>
          )}
          {data.comentarios.map((c) => (
            <article key={c.id} className="rounded-2xl border bg-card p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{PAPEL_LABEL[c.autor_papel]}</p>
                <span className="text-xs text-muted-foreground">{formatarData(c.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.texto}</p>
              {c.edicao_autorizada && c.editavel && (
                <p className="mt-1 text-xs text-warning-foreground">
                  A agência liberou você para editar este pedido.
                </p>
              )}
              {lerAnotacao(c.anotacao_json).length > 0 && (
                <button
                  type="button"
                  onClick={() => setMarcacaoVisivel((atual) => (atual === c.id ? null : c.id))}
                  className="mt-2 inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/25"
                >
                  {marcacaoVisivel === c.id ? "ocultar marcação" : "ver marcação"}
                </button>
              )}
            </article>
          ))}

          {aberta && (
            <div className="space-y-2 rounded-2xl border bg-card p-3">
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder={pin ? "O que mudar neste ponto?" : "Escreva um comentário..."}
                className="min-h-24 rounded-xl"
              />
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
                  className="rounded-xl"
                  variant="outline"
                  disabled={!texto.trim() || comentar.isPending}
                  onClick={() => comentar.mutate()}
                >
                  Adicionar comentário
                </Button>
              </div>
            </div>
          )}
        </section>

        {!aberta && (
          <p className="rounded-2xl bg-accent p-4 text-center text-sm text-accent-foreground">
            {data.peca.status === "aprovada"
              ? "Esta peça já foi aprovada. Obrigado!"
              : "A agência está trabalhando nesta peça. Você será avisado quando ela voltar."}
          </p>
        )}
      </main>

      {aberta && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-card/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-3xl gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="flex-1 rounded-2xl">
                  <Undo2 className="mr-1 size-4" /> Devolver com comentários
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-3xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Devolver para ajustes?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Seus comentários vão para a agência e ficam bloqueados para edição depois que
                    forem lidos.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
                  <AlertDialogAction className="rounded-2xl" onClick={() => devolver.mutate()}>
                    Devolver
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="gradient-brand flex-1 rounded-2xl text-primary-foreground hover:opacity-95">
                  <CheckCircle2 className="mr-1 size-4" /> Aprovar peça
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
                  <AlertDialogAction className="rounded-2xl" onClick={() => aprovar.mutate()}>
                    Aprovar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
    </div>
  );
}
