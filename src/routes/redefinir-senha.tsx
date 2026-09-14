import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { LogoAprovAI } from "@/components/LogoAprovAI";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Redefinir senha — AprovAI" },
      { name: "description", content: "Defina uma nova senha para sua conta no AprovAI." },
      { property: "og:title", content: "Redefinir senha — AprovAI" },
      {
        property: "og:description",
        content: "Defina uma nova senha para sua conta no AprovAI.",
      },
    ],
  }),
  component: RedefinirSenha,
});

function RedefinirSenha() {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let ativo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (ativo) setPronto(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (ativo && s) setPronto(true);
    });
    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (senha !== confirmacao) {
      toast.error("As senhas não são iguais.");
      return;
    }
    setEnviando(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      toast.success("Senha atualizada! Bem-vindo de volta.");
      void navigate({ to: "/painel" });
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível redefinir a senha.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-lift">
        <div className="mb-6 flex items-center gap-2">
          <LogoAprovAI tamanho={40} />
          <span className="text-xl font-bold tracking-tight">AprovAI</span>
        </div>
        <h1 className="text-2xl font-bold">Definir nova senha</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pronto
            ? "Escolha uma senha com pelo menos 6 caracteres."
            : "Abra esta página pelo link que enviamos no seu e-mail para redefinir a senha."}
        </p>

        <form onSubmit={enviar} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="senha">Nova senha</Label>
            <Input
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              minLength={6}
              className="rounded-2xl"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmacao">Repita a nova senha</Label>
            <Input
              id="confirmacao"
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              minLength={6}
              className="rounded-2xl"
              required
            />
          </div>
          <Button
            type="submit"
            disabled={enviando || !pronto || senha.length < 6}
            className="gradient-brand w-full rounded-2xl text-primary-foreground hover:opacity-95"
          >
            {enviando ? "Salvando..." : "Salvar nova senha"}
          </Button>
        </form>
      </div>
    </div>
  );
}
