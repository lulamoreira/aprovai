import type { ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, ListChecks, LogOut, Settings, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { nome, roles, temPapel } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const rota = useRouterState({ select: (s) => s.location.pathname });

  async function sair() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  const itens = [
    { to: "/painel", rotulo: "Painel", icone: LayoutDashboard, visivel: true },
    {
      to: "/pecas",
      rotulo: "Peças",
      icone: ListChecks,
      visivel: temPapel("criacao", "atendimento", "admin"),
    },
    { to: "/admin", rotulo: "Administração", icone: Settings, visivel: temPapel("admin") },
  ].filter((i) => i.visivel);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar px-4 py-6 md:flex">
        <Link to="/painel" className="mb-8 flex items-center gap-2 px-2">
          <span className="gradient-brand flex size-9 items-center justify-center rounded-2xl">
            <Sparkles className="size-5 text-primary-foreground" />
          </span>
          <span className="text-lg font-bold tracking-tight">Aprova</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {itens.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                rota.startsWith(item.to) && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <item.icone className="size-4" />
              {item.rotulo}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-accent/50 p-3">
          <p className="truncate text-sm font-semibold">{nome ?? "Você"}</p>
          <p className="text-xs text-muted-foreground">
            {roles.length ? roles.join(" · ") : "sem papel definido"}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-card/80 px-4 backdrop-blur md:px-8">
          <Link to="/painel" className="flex items-center gap-2 md:hidden">
            <span className="gradient-brand flex size-8 items-center justify-center rounded-xl">
              <Sparkles className="size-4 text-primary-foreground" />
            </span>
            <span className="font-bold">Aprova</span>
          </Link>
          <div className="hidden md:block" />
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={sair}
              aria-label="Sair"
            >
              <LogOut className="size-5" />
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
