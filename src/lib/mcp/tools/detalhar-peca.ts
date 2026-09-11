import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { naoAutenticado, erro, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "detalhar_peca",
  title: "Detalhar peça",
  description:
    "Retorna os dados de uma peça: status, versões, comentários da versão atual e a linha do tempo de auditoria.",
  inputSchema: { peca_id: z.string().describe("Identificador da peça.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ peca_id }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);

    const { data: peca, error: erroPeca } = await supabase
      .from("pecas")
      .select(
        "id, nome, tamanho, tipo, status, versao_atual, created_at, updated_at, campanhas(nome, clientes(nome))",
      )
      .eq("id", peca_id)
      .maybeSingle();
    if (erroPeca) return erro(erroPeca.message);
    if (!peca) return erro("Peça não encontrada ou sem acesso.");

    const [versoes, comentarios, eventos] = await Promise.all([
      supabase
        .from("peca_versoes")
        .select("id, numero, observacao, created_at")
        .eq("peca_id", peca_id)
        .order("numero", { ascending: false }),
      supabase
        .from("comentarios")
        .select("id, autor_papel, texto, visivel_para_cliente, editavel, pin_x, pin_y, created_at")
        .eq("peca_id", peca_id)
        .order("created_at", { ascending: true }),
      supabase
        .from("eventos")
        .select("tipo, ator_nome, ator_papel, detalhe, created_at")
        .eq("peca_id", peca_id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    return ok({
      peca,
      versoes: versoes.data ?? [],
      comentarios: comentarios.data ?? [],
      linha_do_tempo: eventos.data ?? [],
    });
  },
});
