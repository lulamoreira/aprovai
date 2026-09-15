import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Entrada = z.object({
  token: z.string().min(10).max(200),
  versao_id: z.string().uuid().optional(),
});

/**
 * Devolve uma URL assinada (1h) da arte para o cliente anônimo do link mágico.
 * O caminho do arquivo NUNCA vem do cliente: é resolvido no servidor a partir do token.
 */
export const Route = createFileRoute("/api/public/arte-cliente")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let corpo: unknown;
        try {
          corpo = await request.json();
        } catch {
          return Response.json({ erro: "Requisição inválida." }, { status: 400 });
        }

        const analise = Entrada.safeParse(corpo);
        if (!analise.success) {
          return Response.json({ erro: "Dados inválidos." }, { status: 400 });
        }
        const { token, versao_id } = analise.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: acesso, error: erroAcesso } = await supabaseAdmin
          .from("acessos_cliente")
          .select("peca_id, expira_em")
          .eq("token", token)
          .order("criado_em", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (erroAcesso || !acesso) {
          return Response.json({ erro: "Link inválido." }, { status: 404 });
        }
        if (acesso.expira_em && new Date(acesso.expira_em).getTime() < Date.now()) {
          return Response.json({ erro: "Link expirado." }, { status: 410 });
        }

        const { data: peca } = await supabaseAdmin
          .from("pecas")
          .select("id, versao_atual")
          .eq("id", acesso.peca_id)
          .maybeSingle();

        if (!peca) {
          return Response.json({ erro: "Peça não encontrada." }, { status: 404 });
        }

        let consulta = supabaseAdmin
          .from("peca_versoes")
          .select("id, imagem_path")
          .eq("peca_id", peca.id);

        consulta = versao_id
          ? consulta.eq("id", versao_id)
          : consulta.eq("numero", peca.versao_atual);

        const { data: versao } = await consulta.maybeSingle();

        if (!versao?.imagem_path) {
          return Response.json({ erro: "Arte não encontrada." }, { status: 404 });
        }

        const { data: assinada, error: erroAssinatura } = await supabaseAdmin.storage
          .from("peca-imagens")
          .createSignedUrl(versao.imagem_path, 3600);

        if (erroAssinatura || !assinada?.signedUrl) {
          return Response.json({ erro: "Não foi possível abrir a arte." }, { status: 500 });
        }

        return Response.json(
          { url: assinada.signedUrl },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
