import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogoAprovAI } from "@/components/LogoAprovAI";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
          {modo === "entrar" ? "Entrar na sua conta" : "Criar acesso interno"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {modo === "entrar"
            ? "Acesso da equipe de criação e atendimento."
            : "Depois do cadastro, um administrador define seu papel."}
        </p>

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
          <Button
            type="submit"
            disabled={enviando}
            className="gradient-brand w-full rounded-2xl text-primary-foreground hover:opacity-95"
          >
            {enviando ? "Aguarde..." : modo === "entrar" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <button
          onClick={() => setModo(modo === "entrar" ? "criar" : "entrar")}
          className="mt-5 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {modo === "entrar" ? "Não tenho acesso ainda" : "Já tenho conta"}
        </button>
      </div>
    </div>
  );
}
