import { defineTool } from "@lovable.dev/mcp-js";
import { naoAutenticado, erro, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "minhas_pendencias",
  title: "Minhas pendências",
  description:
    "Mostra as notificações não lidas do usuário e as peças que estão aguardando uma ação dele agora.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);

    const { data: papeis, error: erroPapeis } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", ctx.getUserId() ?? "");
    if (erroPapeis) return erro(erroPapeis.message);

    const lista = (papeis ?? []).map((p) => p.role as string);
    const statusPendentes: string[] = [];
    if (lista.includes("criacao") || lista.includes("admin"))
      statusPendentes.push("criacao_ajustando");
    if (lista.includes("atendimento") || lista.includes("admin"))
      statusPendentes.push("aguardando_atendimento", "retorno_atendimento");

    const [pecas, notificacoes] = await Promise.all([
      statusPendentes.length
        ? supabase
            .from("pecas")
            .select("id, nome, status, versao_atual, campanhas(nome, clientes(nome))")
            .in("status", statusPendentes)
            .order("updated_at", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase
        .from("notificacoes")
        .select("id, tipo, titulo, mensagem, peca_id, created_at")
        .eq("lida", false)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    return ok({
      papeis: lista,
      aguardando_voce: pecas.data ?? [],
      notificacoes_nao_lidas: notificacoes.data ?? [],
    });
  },
});
