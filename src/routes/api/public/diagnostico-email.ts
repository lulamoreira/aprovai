import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint TEMPORÁRIO de diagnóstico do disparo de e-mail.
 * Protegido pelo mesmo segredo (x-aprovai-secret == NOTIFICACAO_EMAIL_SECRET).
 * Lista as últimas notificações e reprocessa a mais recente destinada a um
 * contato de cliente, devolvendo o resultado real do Resend.
 * Nunca expõe o valor das chaves.
 */

const PADRAO_FROM = "AprovAI <onboarding@resend.dev>";
const PADRAO_APP_URL = "https://aprovai.lovable.app";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const TIPOS_COM_ACESSO = ["pronta_aprovacao", "edicao_autorizada", "lembrete_aprovacao"];

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string | null;
  peca_id: string | null;
  destinatario_user_id: string | null;
  destinatario_cliente_contato_id: string | null;
  created_at: string;
}

interface Processada {
  notificacaoId: string;
  tipo: string;
  emailDestino: string | null;
  temToken: boolean;
  link: string | null;
  resendStatus: number;
  resendBody: string;
}

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const Route = createFileRoute("/api/public/diagnostico-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const segredo = process.env["NOTIFICACAO_EMAIL_SECRET"];
        if (!segredo || request.headers.get("x-aprovai-secret") !== segredo) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: ultimas, error: erroUltimas } = await supabaseAdmin
          .from("notificacoes")
          .select(
            "id, tipo, titulo, mensagem, peca_id, destinatario_user_id, destinatario_cliente_contato_id, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(5)
          .returns<Notificacao[]>();

        let processada: Processada | null = null;

        const { data: alvo } = await supabaseAdmin
          .from("notificacoes")
          .select(
            "id, tipo, titulo, mensagem, peca_id, destinatario_user_id, destinatario_cliente_contato_id, created_at",
          )
          .in("tipo", TIPOS_COM_ACESSO)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<Notificacao>();

        if (alvo) {
          let email: string | null = null;
          if (alvo.destinatario_cliente_contato_id) {
            const { data } = await supabaseAdmin
              .from("cliente_contatos")
              .select("email")
              .eq("id", alvo.destinatario_cliente_contato_id)
              .maybeSingle();
            email = data?.email ?? null;
          } else if (alvo.destinatario_user_id) {
            const { data } = await supabaseAdmin
              .from("profiles")
              .select("email")
              .eq("id", alvo.destinatario_user_id)
              .maybeSingle();
            email = data?.email ?? null;
          }

          const appUrl = (process.env["APP_URL"] ?? PADRAO_APP_URL).replace(/\/+$/, "");
          let link: string | null = null;
          if (alvo.peca_id && alvo.destinatario_cliente_contato_id) {
            const { data: acesso } = await supabaseAdmin
              .from("acessos_cliente")
              .select("token, criado_em")
              .eq("peca_id", alvo.peca_id)
              .eq("cliente_contato_id", alvo.destinatario_cliente_contato_id)
              .order("criado_em", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (acesso?.token) link = `${appUrl}/aprovar/${acesso.token}`;
          }

          const lovableApiKey = process.env["LOVABLE_API_KEY"];
          const resendApiKey = process.env["RESEND_API_KEY"];

          let resendStatus = 0;
          let resendBody = "";

          if (!email) {
            resendBody = "Sem e-mail de destinatário";
          } else if (!lovableApiKey || !resendApiKey) {
            resendBody = "Chave(s) ausente(s) no servidor";
          } else {
            try {
              const html = `<p style="font-family:sans-serif">${escaparHtml(alvo.titulo)}</p>${
                link ? `<p><a href="${escaparHtml(link)}">Abrir e aprovar</a></p>` : ""
              }`;
              const resposta = await fetch(`${GATEWAY_URL}/emails`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${lovableApiKey}`,
                  "X-Connection-Api-Key": resendApiKey,
                },
                body: JSON.stringify({
                  from: process.env["FROM_EMAIL"] ?? PADRAO_FROM,
                  to: [email],
                  subject: alvo.titulo,
                  html,
                }),
              });
              resendStatus = resposta.status;
              resendBody = await resposta.text();
            } catch (erro) {
              resendBody = erro instanceof Error ? erro.message : String(erro);
            }
          }

          processada = {
            notificacaoId: alvo.id,
            tipo: alvo.tipo,
            emailDestino: email,
            temToken: Boolean(link),
            link,
            resendStatus,
            resendBody,
          };
        }

        const resultado = {
          erroUltimas: erroUltimas?.message ?? null,
          ultimas: (ultimas ?? []).map((n) => ({
            id: n.id,
            tipo: n.tipo,
            titulo: n.titulo,
            destinatario_user_id: n.destinatario_user_id,
            destinatario_cliente_contato_id: n.destinatario_cliente_contato_id,
            peca_id: n.peca_id,
            created_at: n.created_at,
          })),
          processada,
        };

        console.log("[diagnostico-email]", JSON.stringify(resultado));

        return new Response(JSON.stringify(resultado, null, 2), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    },
  },
});
