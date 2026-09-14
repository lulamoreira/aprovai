import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogoAprovAI } from "@/components/LogoAprovAI";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function destinoSeguro(valor: unknown): string {
  return typeof valor === "string" && valor.startsWith("/") && !valor.startsWith("//")
    ? valor
    : "/painel";
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s["next"] === "string" ? { next: s["next"] } : {},
  head: () => ({
    meta: [
      { title: "Entrar no AprovAI" },
      { name: "description", content: "Acesso da equipe interna ao AprovAI." },
      { property: "og:title", content: "Entrar no AprovAI" },
      { property: "og:description", content: "Acesso da equipe interna ao AprovAI." },
    ],
  }),
  component: Autenticacao,
});

function Autenticacao() {
  const [modo, setModo] = useState<"entrar" | "criar" | "recuperar">("entrar");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const destino = destinoSeguro(next);

  useEffect(() => {
    if (session) window.location.replace(destino);
  }, [session, destino]);

  async function entrarComGoogle() {
    setEnviando(true);
    try {
      const retorno =
        window.location.origin + "/auth?next=" + encodeURIComponent(destino);
      const resultado = await lovable.auth.signInWithOAuth("google", { redirect_uri: retorno });
      if (resultado.error) throw new Error("Não foi possível entrar com o Google.");
      if (resultado.redirected) return;
      window.location.replace(destino);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível entrar com o Google.");
    } finally {
      setEnviando(false);
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      if (modo === "recuperar") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/redefinir-senha",
        });
        if (error) throw error;
        toast.success("Enviamos um link de redefinição para o seu e-mail.");
        setModo("entrar");
      } else if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        window.location.replace(destino);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: { emailRedirectTo: window.location.origin + destino, data: { nome } },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Conta criada! Confirme o e-mail que enviamos para entrar.");
          setModo("entrar");
        }
      }
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível continuar.");
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
        <h1 className="text-2xl font-bold">
          {modo === "entrar"
            ? "Entrar na sua conta"
            : modo === "criar"
              ? "Criar acesso interno"
              : "Recuperar senha"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {modo === "entrar"
            ? "Acesso da equipe de criação e atendimento."
            : modo === "criar"
              ? "Depois do cadastro, um administrador define seu papel."
              : "Informe seu e-mail e enviaremos um link para criar uma nova senha."}
        </p>

        {modo !== "recuperar" && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={entrarComGoogle}
              disabled={enviando}
              className="mt-6 w-full gap-2 rounded-2xl"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.86c2.26-2.08 3.58-5.15 3.58-8.85Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
                />
              </svg>
              Entrar com Google
            </Button>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">ou</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={enviar} className="mt-6 space-y-4">
          {modo === "criar" && (
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Seu nome"
                className="rounded-2xl"
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@agencia.com"
              className="rounded-2xl"
              required
            />
          </div>
          {modo !== "recuperar" && (
            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
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
          )}
          <Button
            type="submit"
            disabled={enviando}
            className="gradient-brand w-full rounded-2xl text-primary-foreground hover:opacity-95"
          >
            {enviando
              ? "Aguarde..."
              : modo === "entrar"
                ? "Entrar"
                : modo === "criar"
                  ? "Criar conta"
                  : "Enviar link de redefinição"}
          </Button>
        </form>

        {modo === "entrar" && (
          <button
            onClick={() => setModo("recuperar")}
            className="mt-5 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Esqueci minha senha
          </button>
        )}
        <button
          onClick={() => setModo(modo === "criar" ? "entrar" : modo === "entrar" ? "criar" : "entrar")}
          className="mt-2 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {modo === "entrar" ? "Não tenho acesso ainda" : "Já tenho conta"}
        </button>
      </div>
    </div>
  );
}
