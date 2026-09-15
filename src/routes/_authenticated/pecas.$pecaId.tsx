import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Copy,
  Eye,
  History,
  Lock,
  MessageCircle,
  MessageSquare,
  Pencil,
  Send,
  ShieldCheck,
  Undo2,
  Unlock,
  Upload,
  Users,
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

export const Route = createFileRoute("/_authenticated/pecas/$pecaId")({
  head: () => ({
    meta: [
      { title: "Peça em aprovação — AprovAI" },
      { name: "description", content: "Arte, comentários com marcação e histórico da peça." },
      { property: "og:title", content: "Peça em aprovação — AprovAI" },
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
  /** Modo da rodada atual de aprovação do cliente: 'um' ou 'todos'. */
  modo_aprovacao: string | null;
}
interface Versao {
  id: string;
  numero: number;
  imagem_path: string | null;
  observacao: string | null;
  created_at: string;
  largura_px: number | null;
  altura_px: number | null;
}
type StatusCaso = "aberta" | "feita" | "revisada" | "aprovada";

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
  anotacao_json: unknown;
  visivel_para_cliente: boolean;
  editavel: boolean;
  edicao_autorizada: boolean;
  locked_em: string | null;
  created_at: string;
  /** Marcação do cliente que vira um caso com status próprio. */
  eh_caso: boolean | null;
  status_caso: string | null;
  feito_em: string | null;
  revisado_em: string | null;
}

const SELO_CASO: Record<StatusCaso, { rotulo: string; classe: string }> = {
  aberta: { rotulo: "Aberta", classe: "bg-warning/25 text-warning-foreground" },
  feita: { rotulo: "Ajuste feito", classe: "bg-info/25 text-info-foreground" },
  revisada: { rotulo: "Revisada", classe: "bg-cyan/25 text-cyan-foreground" },
  aprovada: { rotulo: "Aprovada", classe: "bg-success/25 text-success-foreground" },
};

const CASO_FUNDO: Record<StatusCaso, string> = {
  aberta: "bg-warning/15",
  feita: "bg-info/15",
  revisada: "bg-cyan/15",
  aprovada: "bg-success/15",
};
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
interface Acesso {
  id: string;
  token: string;
  expira_em: string;
  criado_em: string;
  cliente_contato_id: string;
  handoff_id: string | null;
  decisao: string | null;
  decidido_em: string | null;
  cliente_contatos: { nome: string; email: string } | null;
}
interface Cobranca {
  id: string;
  cliente_contato_id: string | null;
  cobrado_por: string | null;
  criado_em: string;
  nome_cobrador?: string | null;
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
  const [modoEnvio, setModoEnvio] = useState<"todos" | "um">("todos");
  const [marcacaoVisivel, setMarcacaoVisivel] = useState<string | null>(null);
  const anotador = useAnotador();

  const { data, isLoading } = useQuery({
    queryKey: ["peca", pecaId],
    queryFn: async () => {
      await supabase.rpc("marcar_visto", { p_peca_id: pecaId });
      const { data: peca, error } = await supabase
        .from("pecas")
        .select("id, campanha_id, nome, tamanho, status, versao_atual, modo_aprovacao")
        .eq("id", pecaId)
        .maybeSingle();
      if (error) throw error;
      const versoes = await buscarTudo<Versao>(() =>
        supabase
          .from("peca_versoes")
          .select("id, numero, imagem_path, observacao, created_at, largura_px, altura_px")
          .eq("peca_id", pecaId)
          .order("numero", { ascending: true })
          .order("id"),
      );
      const comentarios = await buscarTudo<Comentario>(() =>
        supabase
          .from("comentarios")
          .select(
            "id, versao_id, handoff_id, autor_user_id, autor_papel, texto, texto_original, pin_x, pin_y, anotacao_json, visivel_para_cliente, editavel, edicao_autorizada, locked_em, created_at, eh_caso, status_caso, feito_em, revisado_em",
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
  /** Marcações do cliente nesta versão, cada uma com decisão própria. */
  const casos = comentariosVersao.filter((c) => c.eh_caso);
  const casosAbertos = casos.filter((c) => c.status_caso === "aberta");
  /** Marcações que ainda não receberam o "Revisado ✓" do atendimento. */
  const casosNaoRevisados = casos.filter((c) => c.status_caso !== "revisada");
  const ultimoHandoff = (data?.handoffs ?? []).find((h) => !h.recolhido_em) ?? null;
  const podeRecolher =
    !!ultimoHandoff &&
    !ultimoHandoff.visto_em &&
    (ultimoHandoff.enviado_por === userId || temPapel("admin"));
  const handoffCliente = (data?.handoffs ?? []).find(
    (h) => h.de_papel === "cliente" && !h.recolhido_em,
  );

  const { data: aprovadores = [], isLoading: carregandoAprovadores } = useQuery({
    queryKey: ["aprovadores-peca", peca?.campanha_id],
    enabled: !!peca?.campanha_id,
    queryFn: async () => {
      const { data: campanha, error } = await supabase
        .from("campanhas")
        .select("cliente_id")
        .eq("id", peca!.campanha_id)
        .maybeSingle();
      if (error) throw error;
      if (!campanha?.cliente_id) return [];
      return buscarTudo<{ id: string; nome: string; email: string }>(() =>
        supabase
          .from("cliente_contatos")
          .select("id, nome, email")
          .eq("cliente_id", campanha.cliente_id)
          .order("nome", { ascending: true })
          .order("id"),
      );
    },
  });

  const status = peca?.status;
  const souCriacao = temPapel("criacao", "admin");
  const souAtendimento = temPapel("atendimento", "admin");
  const podeComentar =
    (souCriacao && status === "criacao_ajustando") ||
    (souAtendimento && (status === "aguardando_atendimento" || status === "retorno_atendimento"));

  const { data: acessos = [], isLoading: carregandoAcessos } = useQuery({
    queryKey: ["acessos-cliente", pecaId],
    enabled: status === "aguardando_cliente" && souAtendimento,
    queryFn: async () => {
      return buscarTudo<Acesso>(() =>
        supabase
          .from("acessos_cliente")
          .select(
            "id, token, expira_em, criado_em, cliente_contato_id, handoff_id, decisao, decidido_em, cliente_contatos(nome, email)",
          )
          .eq("peca_id", pecaId)
          .order("criado_em", { ascending: false })
          .order("id"),
      );
    },
  });

  const acessosPorAprovador = new Map<string, Acesso>();
  for (const a of acessos) {
    const existente = acessosPorAprovador.get(a.cliente_contato_id);
    if (!existente || new Date(a.criado_em) > new Date(existente.criado_em)) {
      acessosPorAprovador.set(a.cliente_contato_id, a);
    }
  }
  const acessosRecentes = Array.from(acessosPorAprovador.values()).sort(
    (a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime(),
  );

  const { data: cobrancas = [] } = useQuery({
    queryKey: ["cobrancas", pecaId],
    enabled: status === "aguardando_cliente" && souAtendimento,
    queryFn: async () => {
      const linhas = await buscarTudo<Cobranca>(() =>
        supabase
          .from("cobrancas")
          .select("id, cliente_contato_id, cobrado_por, criado_em")
          .eq("peca_id", pecaId)
          .order("criado_em", { ascending: false })
          .order("id"),
      );
      const ids = Array.from(
        new Set(linhas.map((c) => c.cobrado_por).filter((v): v is string => !!v)),
      );
      if (ids.length === 0) return linhas;
      const { data: perfis } = await supabase
        .from("profiles")
        .select("id, nome, email")
        .in("id", ids);
      const mapa = new Map((perfis ?? []).map((p) => [p.id, p.nome ?? p.email ?? "Equipe"]));
      return linhas.map((c) => ({
        ...c,
        nome_cobrador: c.cobrado_por ? (mapa.get(c.cobrado_por) ?? null) : null,
      }));
    },
  });

  /** Cobranças de um aprovador, da mais recente para a mais antiga. */
  function cobrancasDe(contatoId: string): Cobranca[] {
    return cobrancas.filter((c) => c.cliente_contato_id === contatoId);
  }

  /** Rodada atual = handoff do acesso mais recente; cai para os acessos recentes se for antigo. */
  const handoffRodada = acessosRecentes[0]?.handoff_id ?? null;
  const rodada = handoffRodada
    ? acessos
        .filter((a) => a.handoff_id === handoffRodada)
        .sort((a, b) =>
          (a.cliente_contatos?.nome ?? "").localeCompare(b.cliente_contatos?.nome ?? "", "pt-BR"),
        )
    : acessosRecentes;
  const modoAprovacao = peca?.modo_aprovacao === "um" ? "um" : "todos";
  const totalRodada = rodada.length;
  const aprovadosRodada = rodada.filter((a) => a.decisao === "aprovado").length;

  function linkAprovacao(token: string) {
    return `${window.location.origin}/aprovar/${token}`;
  }

  async function copiarLink(token: string) {
    try {
      await navigator.clipboard.writeText(linkAprovacao(token));
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  }

  function compartilharWhatsApp(token: string) {
    const link = linkAprovacao(token);
    const texto = `Olá! Você recebeu a peça "${peca?.nome ?? ""}" para aprovação. Acesse o link: ${link}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(texto)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function formatarValidade(iso: string): string {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(iso));
  }

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ["peca", pecaId] });
    void qc.invalidateQueries({ queryKey: ["pecas"] });
    void qc.invalidateQueries({ queryKey: ["painel"] });
    void qc.invalidateQueries({ queryKey: ["acessos-cliente", pecaId] });
  }

  const comentar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("comentar_interno", {
        p_peca_id: pecaId,
        p_texto: texto.trim(),
        p_visivel_cliente: visivelCliente,
        ...(pin ? { p_pin_x: pin.x, p_pin_y: pin.y } : {}),
        ...(anotador.strokes.length > 0
          ? { p_anotacao_json: anotacaoParaJson(anotador.strokes) }
          : {}),
      });
      if (error) throw error;
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

  const enviar = useMutation({
    mutationFn: async (opcoes?: { contatoIds?: string[]; modo?: "todos" | "um" }) => {
      const contatoIds = opcoes?.contatoIds;
      const { error } = await supabase.rpc("enviar_peca", {
        p_peca_id: pecaId,
        ...(contatoIds && contatoIds.length > 0 ? { p_contato_ids: contatoIds } : {}),
        ...(opcoes?.modo ? { p_modo_aprovacao: opcoes.modo } : {}),
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

  const cobrar = useMutation({
    mutationFn: async (clienteContatoId: string) => {
      const { error } = await supabase.rpc("cobrar_aprovador", {
        p_peca_id: pecaId,
        p_cliente_contato_id: clienteContatoId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lembrete enviado");
      void qc.invalidateQueries({ queryKey: ["cobrancas", pecaId] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível enviar o lembrete."),
  });

  const marcarFeito = useMutation({
    mutationFn: async (entrada: { id: string; feito: boolean }) => {
      const { error } = await supabase.rpc("criacao_marcar_feito", {
        p_comentario_id: entrada.id,
        p_feito: entrada.feito,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidar(),
    onError: (e: Error) => toast.error(e.message),
  });

  const revisarCaso = useMutation({
    mutationFn: async (entrada: { id: string; ok: boolean }) => {
      const { error } = await supabase.rpc("atendimento_revisar_caso", {
        p_comentario_id: entrada.id,
        p_ok: entrada.ok,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidar(),
    onError: (e: Error) => toast.error(e.message),
  });

  const devolverCriacao = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("devolver_para_criacao", { p_peca_id: pecaId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Peça devolvida para a Criação.");
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
  /** Com correções ainda abertas, o atendimento devolve para a criação em vez de enviar. */
  const devolveParaCriacao =
    status === "aguardando_atendimento" && souAtendimento && casosAbertos.length > 0;
  const semArte = status === "criacao_ajustando" && peca.versao_atual < 1;
  const travadoPelaCriacao =
    status === "criacao_ajustando" && (semArte || casosAbertos.length > 0);
  /** Atendimento só envia ao cliente com TODAS as marcações revisadas. */
  const faltaRevisar =
    status === "aguardando_atendimento" &&
    souAtendimento &&
    casosAbertos.length === 0 &&
    casosNaoRevisados.length > 0;
  const podeEnviar =
    (status === "criacao_ajustando" && souCriacao) ||
    ((status === "aguardando_atendimento" || status === "retorno_atendimento") && souAtendimento);
  const envioParaCliente = status === "aguardando_atendimento" && !devolveParaCriacao;
  const motivoTravaCriacao = semArte
    ? "Suba uma arte antes de enviar."
    : "Marque todas as correções como feitas para enviar.";

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

          {devolveParaCriacao && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95">
                  <Undo2 className="mr-1 size-4" /> Voltar para a Criação
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-3xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Devolver para a Criação?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {casosAbertos.length} correç
                    {casosAbertos.length === 1 ? "ão continua" : "ões continuam"} em aberto. A peça
                    volta para a Criação ajustar.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="rounded-2xl"
                    onClick={() => devolverCriacao.mutate()}
                  >
                    Devolver
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {rotuloEnvio && podeEnviar && envioParaCliente && (
            <div className="flex flex-col items-end gap-1">
              <Button
                disabled={faltaRevisar}
                title={
                  faltaRevisar ? "Revise todas as marcações antes de enviar ao cliente." : undefined
                }
                className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
                onClick={() => {
                  setContatosSelecionados(aprovadores.map((a) => a.id));
                  setModalContatos(true);
                }}
              >
                <Send className="mr-1 size-4" /> {rotuloEnvio}
              </Button>
              {faltaRevisar && (
                <p className="max-w-64 text-right text-xs font-medium text-warning-foreground">
                  Revise todas as marcações (marque “Revisado ✓”) antes de enviar ao cliente.
                </p>
              )}
            </div>
          )}

          {rotuloEnvio && podeEnviar && !envioParaCliente && !devolveParaCriacao && (
            <div className="flex flex-col items-end gap-1">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    disabled={travadoPelaCriacao}
                    title={travadoPelaCriacao ? motivoTravaCriacao : undefined}
                    className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
                  >
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
                    <AlertDialogAction
                      className="rounded-2xl"
                      onClick={() => enviar.mutate(undefined)}
                    >
                      Enviar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {travadoPelaCriacao && (
                <p className="max-w-64 text-right text-xs font-medium text-warning-foreground">
                  {motivoTravaCriacao}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {status === "aguardando_cliente" && souAtendimento && (
        <section className="rounded-3xl border bg-card p-4 shadow-soft">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <MessageCircle className="size-5 text-primary" /> Link de aprovação do cliente
          </h2>

          {carregandoAcessos ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-14 rounded-2xl" />
            </div>
          ) : acessosRecentes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum link gerado ainda. Envie a peça para o cliente para criar os links.
            </p>
          ) : (
            <ul className="space-y-2">
              {acessosRecentes.map((a) => {
                const contato = a.cliente_contatos;
                return (
                  <li
                    key={a.id}
                    className="flex flex-col gap-3 rounded-2xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {contato?.nome ?? "Aprovador"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {contato?.email ?? "—"} · válido até {formatarValidade(a.expira_em)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => void copiarLink(a.token)}
                      >
                        <Copy className="mr-1 size-4" /> Copiar link
                      </Button>
                      <Button
                        size="sm"
                        className="gradient-brand rounded-xl text-primary-foreground hover:opacity-95"
                        onClick={() => compartilharWhatsApp(a.token)}
                      >
                        <MessageCircle className="mr-1 size-4" /> WhatsApp
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {status === "aguardando_cliente" && souAtendimento && rodada.length > 0 && (
        <section className="rounded-3xl border bg-card p-4 shadow-soft">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Users className="size-5 text-primary" /> Aprovações
            </h2>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                modoAprovacao === "um"
                  ? "bg-warning/25 text-warning-foreground"
                  : "bg-accent text-accent-foreground",
              )}
            >
              {modoAprovacao === "um" ? "⚠️ Basta um aprovar" : "Todos precisam aprovar"}
            </span>
            {modoAprovacao === "todos" && (
              <span className="text-xs font-medium text-muted-foreground">
                {aprovadosRodada} de {totalRodada} aprovaram
              </span>
            )}
          </div>

          <ul className="space-y-2">
            {rodada.map((a) => {
              const contato = a.cliente_contatos;
              const situacao =
                a.decisao === "aprovado"
                  ? `aprovou em ${formatarData(a.decidido_em)}`
                  : a.decisao === "devolvido"
                    ? `devolveu em ${formatarData(a.decidido_em)}`
                    : "pendente";
              const lembretes = cobrancasDe(a.cliente_contato_id);
              const ultimoLembrete = lembretes[0];
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 rounded-2xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{contato?.nome ?? "Aprovador"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {contato?.email ?? "—"}
                    </p>
                    {ultimoLembrete && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Cobrado por {ultimoLembrete.nome_cobrador ?? "Equipe"} em{" "}
                        {formatarData(ultimoLembrete.criado_em)}
                        {lembretes.length > 1 ? ` · ${lembretes.length} lembretes` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
                        a.decisao === "aprovado"
                          ? "bg-success/25 text-success-foreground"
                          : a.decisao === "devolvido"
                            ? "bg-info/25 text-info-foreground"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {a.decisao === "aprovado" && <CheckCircle2 className="size-3.5" />}
                      {situacao}
                    </span>
                    {!a.decisao && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={cobrar.isPending}
                        onClick={() => cobrar.mutate(a.cliente_contato_id)}
                      >
                        <Bell className="mr-1 size-4" /> Cobrar
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

          {podeComentar && <BarraAnotacao estado={anotador} className="mb-3" />}

          <MolduraArte
            src={urlImagem}
            alt={`Arte da peça ${peca.nome}`}
            largura={versaoAtiva?.largura_px ?? null}
            altura={versaoAtiva?.altura_px ?? null}
            alturaMaxima="70vh"
            cursorCruz={podeComentar && !anotador.desenhando}
            aoClicar={podeComentar ? (p: { x: number; y: number }) => setPin(p) : undefined}
            vazio={<p className="p-10 text-sm text-muted-foreground">Sem arte nesta versão.</p>}
          >
            {marcacaoVisivel && (
              <AnotacaoView
                strokes={lerAnotacao(
                  comentariosVersao.find((c) => c.id === marcacaoVisivel)?.anotacao_json,
                )}
              />
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

            {podeComentar && <CamadaAnotacao estado={anotador} />}
          </MolduraArte>
          {podeComentar && (
            <p className="mt-2 text-xs text-muted-foreground">
              {anotador.desenhando
                ? "Rabisque sobre a arte. O desenho entra no próximo comentário."
                : "Clique na arte para marcar um ponto antes de comentar."}
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
              {comentariosVersao.map((c, i) => {
                const selo = c.eh_caso
                  ? (SELO_CASO[(c.status_caso as StatusCaso) ?? "aberta"] ?? SELO_CASO.aberta)
                  : null;
                return (
                  <article
                    key={c.id}
                    className={cn(
                      "rounded-2xl border p-3",
                      c.eh_caso
                        ? CASO_FUNDO[(c.status_caso as StatusCaso) ?? "aberta"]
                        : "bg-muted/40",
                      c.eh_caso && "border-2 border-primary/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {c.pin_x != null && (
                          <span className="mr-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                            {pins.findIndex((p) => p.id === c.id) + 1}
                          </span>
                        )}
                        {PAPEL_LABEL[c.autor_papel]}
                        {selo && (
                          <span
                            className={cn(
                              "ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              selo.classe,
                            )}
                          >
                            {selo.rotulo}
                          </span>
                        )}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {formatarData(c.created_at)}
                      </span>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap rounded-xl border border-border bg-card p-3 text-sm font-medium text-card-foreground shadow-soft">
                      {c.texto}
                    </div>
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
                          <Lock className="size-3" /> Visto em {formatarData(c.locked_em)} —
                          bloqueado
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
                      {lerAnotacao(c.anotacao_json).length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setMarcacaoVisivel((atual) => (atual === c.id ? null : c.id))
                          }
                          className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary hover:bg-primary/25"
                        >
                          <Pencil className="size-3" />{" "}
                          {marcacaoVisivel === c.id ? "ocultar marcação" : "ver marcação"}
                        </button>
                      )}
                    </div>

                    {c.eh_caso && souCriacao && status === "criacao_ajustando" && (
                      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl bg-muted/50 p-2">
                        <Checkbox
                          checked={c.status_caso !== "aberta"}
                          disabled={marcarFeito.isPending}
                          onCheckedChange={(v) =>
                            marcarFeito.mutate({ id: c.id, feito: v === true })
                          }
                        />
                        <span className="text-xs font-medium">
                          Já corrigi
                          {c.feito_em ? ` · marcado em ${formatarData(c.feito_em)}` : ""}
                        </span>
                      </label>
                    )}

                    {c.eh_caso && souAtendimento && status === "aguardando_atendimento" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="rounded-xl bg-success text-success-foreground hover:opacity-90"
                          disabled={revisarCaso.isPending || c.status_caso === "revisada"}
                          onClick={() => revisarCaso.mutate({ id: c.id, ok: true })}
                        >
                          <CheckCircle2 className="mr-1 size-4" /> Revisado ✓
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl"
                          disabled={revisarCaso.isPending || c.status_caso === "aberta"}
                          onClick={() => revisarCaso.mutate({ id: c.id, ok: false })}
                        >
                          <Undo2 className="mr-1 size-4" /> Não feito
                        </Button>
                        {c.revisado_em && (
                          <span className="text-[11px] text-muted-foreground">
                            revisado em {formatarData(c.revisado_em)}
                          </span>
                        )}
                      </div>
                    )}

                    <span className="sr-only">{i}</span>
                  </article>
                );
              })}

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
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        size="sm"
                        className="gradient-brand rounded-xl text-primary-foreground hover:opacity-95"
                        disabled={!texto.trim() || comentar.isPending}
                        title={!texto.trim() ? "Escreva algo primeiro." : undefined}
                        onClick={() => comentar.mutate()}
                      >
                        Comentar
                      </Button>
                      {!texto.trim() && (
                        <p className="text-xs font-medium text-muted-foreground">
                          Escreva algo primeiro.
                        </p>
                      )}
                    </div>
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
          <DialogFooter className="sm:flex-col sm:items-end sm:gap-1">
            <Button
              disabled={!motivo.trim() || autorizar.isPending}
              title={!motivo.trim() ? "Escreva o motivo primeiro." : undefined}
              onClick={() => autorizar.mutate()}
              className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
            >
              Liberar edição
            </Button>
            {!motivo.trim() && (
              <p className="text-xs font-medium text-muted-foreground">
                Escreva o motivo primeiro para liberar a edição.
              </p>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modalContatos} onOpenChange={setModalContatos}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Enviar para quais aprovadores?</DialogTitle>
            <DialogDescription>
              Cada aprovador marcado recebe um link mágico exclusivo desta peça.
            </DialogDescription>
          </DialogHeader>

          {carregandoAprovadores ? (
            <Skeleton className="h-20 rounded-2xl" />
          ) : aprovadores.length === 0 ? (
            <p className="rounded-2xl bg-warning/20 p-4 text-sm text-warning-foreground">
              Cadastre ao menos um aprovador para este cliente na Administração antes de enviar.
            </p>
          ) : (
            <div className="space-y-2">
              {aprovadores.map((a) => {
                const marcado = contatosSelecionados.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-3 rounded-2xl border bg-background p-3"
                  >
                    <Checkbox
                      checked={marcado}
                      onCheckedChange={(v) =>
                        setContatosSelecionados((atual) =>
                          v === true ? [...atual, a.id] : atual.filter((id) => id !== a.id),
                        )
                      }
                    />
                    <span>
                      <span className="block text-sm font-semibold">{a.nome}</span>
                      <span className="block text-xs text-muted-foreground">{a.email}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <fieldset className="space-y-2 rounded-2xl border bg-background p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Como esta peça será aprovada
            </legend>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="modo-aprovacao"
                value="todos"
                checked={modoEnvio === "todos"}
                onChange={() => setModoEnvio("todos")}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="block text-sm font-semibold">Todos precisam aprovar</span>
                <span className="block text-xs text-muted-foreground">
                  A peça só vira aprovada quando todos os aprovadores responderem.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="modo-aprovacao"
                value="um"
                checked={modoEnvio === "um"}
                onChange={() => setModoEnvio("um")}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="block text-sm font-semibold">Basta um aprovar</span>
                <span className="block text-xs text-muted-foreground">
                  A primeira resposta decide o destino da peça.
                </span>
              </span>
            </label>
            {modoEnvio === "um" && (
              <p className="rounded-xl bg-warning/25 p-3 text-xs font-medium text-warning-foreground">
                ⚠️ Basta UMA pessoa aprovar para a peça seguir aprovada. As demais não precisam
                confirmar.
              </p>
            )}
          </fieldset>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-2xl"
              onClick={() => setModalContatos(false)}
            >
              Cancelar
            </Button>
            <div className="flex flex-col items-end gap-1">
              <Button
                disabled={contatosSelecionados.length === 0 || enviar.isPending}
                title={
                  contatosSelecionados.length === 0
                    ? "Selecione ao menos um aprovador."
                    : undefined
                }
                onClick={() => enviar.mutate({ contatoIds: contatosSelecionados, modo: modoEnvio })}
                className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
              >
                <Send className="mr-1 size-4" /> Enviar para o cliente
              </Button>
              {contatosSelecionados.length === 0 && (
                <p className="text-xs font-medium text-warning-foreground">
                  Marque ao menos um aprovador para enviar.
                </p>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
