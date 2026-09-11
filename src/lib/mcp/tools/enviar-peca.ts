import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { naoAutenticado, erro, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "enviar_peca",
  title: "Enviar peça para a próxima etapa",
  description:
    "Passa o bastão da peça para a próxima etapa do fluxo (Criação para Atendimento, Atendimento para Cliente, ou de volta para Correção). Trava os comentários enviados.",
  inputSchema: { peca_id: z.string().describe("Identificador da peça a enviar.") },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ peca_id }, ctx) => {
    if (!ctx.isAuthenticated()) return naoAutenticado();
    const supabase = supabaseForUser(ctx);
    const { error } = await supabase.rpc("enviar_peca", { p_peca_id: peca_id });
    if (error) return erro(error.message);

    const { data } = await supabase
      .from("pecas")
      .select("id, nome, status, versao_atual")
      .eq("id", peca_id)
      .maybeSingle();
    return ok({ enviada: true, peca: data });
  },
});
