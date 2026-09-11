import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { naoAutenticado, erro, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "listar_pecas",
  title: "Listar peças",
  description:
    "Lista peças de aprovação visíveis para o usuário, com cliente, campanha, status e versão atual. Filtra por status ou por nome da campanha.",
  inputSchema: {
    status: z
      .enum([
        "criacao_ajustando",
        "aguardando_atendimento",
        "aguardando_cliente",
        "retorno_atendimento",
        "aprovada",
        "arquivada",
      ])
      .optional()
      .describe("Filtra pelo status atual da peça."),
    campanha: z.string().optional().describe("Texto contido no nome da campanha."),
    limite: z.number().int().optional().describe("Máximo de peças a retornar (padrão 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, campanha, limite }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);
    const max = Math.min(Math.max(limite ?? 50, 1), 200);

    let consulta = supabase
      .from("pecas")
      .select(
        "id, nome, tamanho, status, versao_atual, updated_at, campanhas!inner(id, nome, clientes!inner(nome, empresa))",
      )
      .order("updated_at", { ascending: false })
      .limit(max);

    if (status) consulta = consulta.eq("status", status);
    if (campanha) consulta = consulta.ilike("campanhas.nome", `%${campanha}%`);

    const { data, error } = await consulta;
    if (error) return erro(error.message);
    return ok(data ?? []);
  },
});
