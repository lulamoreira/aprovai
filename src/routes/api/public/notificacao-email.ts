import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint chamado pelo banco (trigger + pg_net) a cada nova notificação.
 * Envia um e-mail via Resend. Falhas de e-mail nunca quebram o fluxo do app:
 * respondemos 200 e apenas registramos no log.
 */

const PADRAO_FROM = "AprovAI <onboarding@resend.dev>";
const PADRAO_APP_URL = "https://aprovai.lovable.app";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string | null;
  peca_id: string | null;
  destinatario_user_id: string | null;
  destinatario_cliente_contato_id: string | null;
}

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function montarHtml(opcoes: {
  titulo: string;
  mensagem: string | null;
  link: string | null;
  pin?: string | null;
}): string {
  const { titulo, mensagem, link, pin } = opcoes;
  const blocoPin = pin
    ? `<tr><td style="padding:8px 32px 0 32px;">
         <div style="background:#F2F0FF;border:1px solid #E1DCFF;border-radius:20px;padding:20px 24px;text-align:center;">
           <p style="margin:0 0 8px 0;font-size:13px;color:#565463;">Seu código de aprovação</p>
           <p style="margin:0;font-size:34px;font-weight:700;letter-spacing:8px;color:#7D2AE8;">${escaparHtml(pin)}</p>
           <p style="margin:10px 0 0 0;font-size:12px;color:#6b6a78;">Use este código para abrir a peça. Não compartilhe com ninguém.</p>
         </div>
       </td></tr>`
    : "";
  const botao = link
    ? `<tr><td style="padding:8px 32px 24px 32px;">
         <a href="${escaparHtml(link)}"
            style="display:inline-block;background:linear-gradient(90deg,#00C4CC,#7D2AE8);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:16px;">
           Abrir e aprovar
         </a>
         <p style="margin:16px 0 0 0;font-size:12px;color:#6b6a78;word-break:break-all;">${escaparHtml(link)}</p>
       </td></tr>`
    : "";

  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#F7F7FB;font-family:Inter,Helvetica,Arial,sans-serif;color:#2D2B38;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:24px;overflow:hidden;">
    <tr>
      <td style="background:linear-gradient(90deg,#00C4CC,#7D2AE8);padding:24px 32px;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.4px;">AprovAI</span>
      </td>
    </tr>
    <tr><td style="padding:32px 32px 8px 32px;">
      <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;color:#2D2B38;">${escaparHtml(titulo)}</h1>
      ${mensagem ? `<p style="margin:0;font-size:15px;line-height:1.6;color:#565463;">${escaparHtml(mensagem)}</p>` : ""}
    </td></tr>
    ${blocoPin}
    ${botao}
    <tr><td style="padding:0 32px 28px 32px;">
      <p style="margin:0;font-size:12px;color:#9a98a6;border-top:1px solid #ECEBF3;padding-top:16px;">
        AprovAI — aprovação de peças
      </p>
    </td></tr>
  </table>
</body></html>`;
}

async function processar(notificacaoId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: notificacao, error } = await supabaseAdmin
    .from("notificacoes")
    .select(
      "id, tipo, titulo, mensagem, peca_id, destinatario_user_id, destinatario_cliente_contato_id",
    )
    .eq("id", notificacaoId)
    .maybeSingle<Notificacao>();

  if (error || !notificacao) {
    console.error("[enviar-email] notificação não encontrada", notificacaoId, error?.message);
    return;
  }

  let email: string | null = null;

  if (notificacao.destinatario_user_id) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", notificacao.destinatario_user_id)
      .maybeSingle();
    email = data?.email ?? null;
  } else if (notificacao.destinatario_cliente_contato_id) {
    const { data } = await supabaseAdmin
      .from("cliente_contatos")
      .select("email")
      .eq("id", notificacao.destinatario_cliente_contato_id)
      .maybeSingle();
    email = data?.email ?? null;
  }

  if (!email) {
    console.warn("[enviar-email] sem e-mail de destinatário para", notificacaoId);
    return;
  }

  const appUrl = (process.env["APP_URL"] ?? PADRAO_APP_URL).replace(/\/+$/, "");
  let link: string | null = null;

  const tiposComAcesso = ["pronta_aprovacao", "edicao_autorizada", "lembrete_aprovacao"];
  if (
    tiposComAcesso.includes(notificacao.tipo) &&
    notificacao.peca_id &&
    notificacao.destinatario_cliente_contato_id
  ) {
    const { data: acesso } = await supabaseAdmin
      .from("acessos_cliente")
      .select("token, criado_em")
      .eq("peca_id", notificacao.peca_id)
      .eq("cliente_contato_id", notificacao.destinatario_cliente_contato_id)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (acesso?.token) link = `${appUrl}/aprovar/${acesso.token}`;
  }

  const lovableApiKey = process.env["LOVABLE_API_KEY"];
  const resendApiKey = process.env["RESEND_API_KEY"];
  if (!lovableApiKey || !resendApiKey) {
    console.error("[enviar-email] credenciais do Resend ausentes");
    return;
  }

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
      subject: notificacao.titulo,
      html: montarHtml({ titulo: notificacao.titulo, mensagem: notificacao.mensagem, link }),
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    console.error(`[enviar-email] falha no envio [${resposta.status}]: ${corpo}`);
    return;
  }

  console.info("[enviar-email] enviado para notificação", notificacaoId);
}

export const Route = createFileRoute("/api/public/notificacao-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const segredo = process.env["NOTIFICACAO_EMAIL_SECRET"];
        if (!segredo || request.headers.get("x-aprovai-secret") !== segredo) {
          return new Response("Unauthorized", { status: 401 });
        }

        let notificacaoId: string | undefined;
        try {
          const corpo = (await request.json()) as { notificacao_id?: string; id?: string };
          notificacaoId = corpo.notificacao_id ?? corpo.id;
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        if (!notificacaoId || !/^[0-9a-f-]{36}$/i.test(notificacaoId)) {
          return new Response("Bad Request", { status: 400 });
        }

        try {
          await processar(notificacaoId);
        } catch (erro) {
          console.error("[enviar-email] erro inesperado", erro);
        }

        return new Response("ok");
      },
    },
  },
});
