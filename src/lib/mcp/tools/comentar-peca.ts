import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { naoAutenticado, erro, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "comentar_peca",
  title: "Comentar em uma peça",
  description:
    "Adiciona um comentário interno na versão atual da peça. Opcionalmente marca o comentário como visível para o cliente.",
  inputSchema: {
    peca_id: z.string().describe("Identificador da peça."),
    texto: z.string().describe("Conteúdo do comentário."),
    visivel_para_cliente: z
      .boolean()
      .optional()
      .describe("Quando verdadeiro, o cliente também verá este comentário."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ peca_id, texto, visivel_para_cliente }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    if (!texto.trim()) return erro("O comentário não pode ficar vazio.");

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("comentar_interno", {
      p_peca_id: peca_id,
      p_texto: texto.trim(),
      p_visivel_cliente: visivel_para_cliente ?? false,
    });
    if (error) return erro(error.message);
    return ok({ comentario_id: data });
  },
});
