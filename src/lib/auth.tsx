import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "atendimento" | "criacao";
export type PapelAtor = "criacao" | "atendimento" | "cliente";

interface AuthState {
  session: Session | null;
  userId: string | null;
  nome: string | null;
  roles: AppRole[];
  papel: PapelAtor | null;
  carregando: boolean;
  temPapel: (...r: AppRole[]) => boolean;
  recarregar: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [nome, setNome] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregarPerfil(userId: string) {
    // garante o perfil (e promove o primeiro usuário a administrador)
    await supabase.rpc("ensure_profile", { _nome: "" });
    const [{ data: perfil }, { data: papeis }] = await Promise.all([
      supabase.from("profiles").select("nome").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    setNome(perfil?.nome ?? null);
    setRoles(((papeis ?? []) as { role: AppRole }[]).map((p) => p.role));
  }

  useEffect(() => {
    let ativo = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!ativo) return;
      setSession(s);
      if (!s) {
        setRoles([]);
        setNome(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      setSession(data.session);
      setCarregando(false);
    });

    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    void carregarPerfil(uid);
  }, [session?.user.id]);

  const value = useMemo<AuthState>(() => {
    const papel: PapelAtor | null = roles.includes("criacao")
      ? "criacao"
      : roles.includes("atendimento") || roles.includes("admin")
        ? "atendimento"
        : null;
    return {
      session,
      userId: session?.user.id ?? null,
      nome,
      roles,
      papel,
      carregando,
      temPapel: (...r: AppRole[]) => r.some((x) => roles.includes(x)),
      recarregar: async () => {
        if (session?.user.id) await carregarPerfil(session.user.id);
      },
    };
  }, [session, roles, nome, carregando]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
