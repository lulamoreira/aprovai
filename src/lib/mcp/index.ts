import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listarPecas from "./tools/listar-pecas";
import detalharPeca from "./tools/detalhar-peca";
import comentarPeca from "./tools/comentar-peca";
import enviarPeca from "./tools/enviar-peca";
import minhasPendencias from "./tools/minhas-pendencias";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "aproveai-assistant",
  title: "AprovAI Assistant",
  version: "0.1.0",
  instructions:
    "Ferramentas do AprovAI, sistema de aprovação de peças de campanha. Use `minhas_pendencias` para ver o que aguarda o usuário, `listar_pecas` e `detalhar_peca` para consultar peças, `comentar_peca` para registrar um comentário interno e `enviar_peca` para passar a peça à próxima etapa do fluxo (ação irreversível: confirme com o usuário antes).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [minhasPendencias, listarPecas, detalharPeca, comentarPeca, enviarPeca],
});
