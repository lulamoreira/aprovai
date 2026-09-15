import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint TEMPORÁRIO de diagnóstico de e-mail.
 * Protegido pelo mesmo segredo do disparo automático (x-aprovai-secret).
 * Envia um e-mail de teste pelo MESMO caminho do Resend usado pela rota de
 * notificação e devolve o resultado real no corpo, para diagnosticar falhas.
 * Nunca expõe o valor das chaves — apenas se elas existem.
 */

const PADRAO_FROM = "AprovAI <onboarding@resend.dev>";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export const Route = createFileRoute("/api/public/testar-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const segredo = process.env["NOTIFICACAO_EMAIL_SECRET"];
        if (!segredo || request.headers.get("x-aprovai-secret") !== segredo) {
          return new Response("Unauthorized", { status: 401 });
        }

        let para: string | undefined;
        try {
          const corpo = (await request.json()) as { to?: string };
          para = corpo.to?.trim();
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        if (!para || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) {
          return new Response("Bad Request", { status: 400 });
        }

        const lovableApiKey = process.env["LOVABLE_API_KEY"];
        const resendApiKey = process.env["RESEND_API_KEY"];
        const from = process.env["FROM_EMAIL"] ?? PADRAO_FROM;

        let ok = false;
        let status = 0;
        let resendBody = "";

        if (!lovableApiKey || !resendApiKey) {
          resendBody = "Chave(s) ausente(s) no servidor";
        } else {
          try {
            const resposta = await fetch(`${GATEWAY_URL}/emails`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${lovableApiKey}`,
                "X-Connection-Api-Key": resendApiKey,
              },
              body: JSON.stringify({
                from,
                to: [para],
                subject: "Teste AprovAI",
                html: "<p style=\"font-family:sans-serif\">Funcionou! O envio de e-mail do AprovAI está ok.</p>",
              }),
            });
            status = resposta.status;
            resendBody = await resposta.text();
            ok = resposta.ok;
          } catch (erro) {
            resendBody = erro instanceof Error ? erro.message : String(erro);
          }
        }

        const resultado = {
          ok,
          status,
          resendBody,
          from,
          temResendKey: Boolean(resendApiKey),
          temLovableKey: Boolean(lovableApiKey),
        };

        console.log("[testar-email]", JSON.stringify(resultado));

        return new Response(JSON.stringify(resultado, null, 2), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    },
  },
});
