import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatarData } from "@/lib/aprova";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Notificacao {
  id: string;
  titulo: string;
  mensagem: string | null;
  lida: boolean;
  created_at: string;
  peca_id: string | null;
}

export function NotificationBell() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const { data: notificacoes = [] } = useQuery({
    queryKey: ["notificacoes", userId],
    enabled: !!userId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notificacoes")
        .select("id, titulo, mensagem, lida, created_at, peca_id")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(0, 49);
      if (error) throw error;
      return (data ?? []) as Notificacao[];
    },
  });

  const naoLidas = notificacoes.filter((n) => !n.lida).length;

  async function marcarTodasLidas() {
    if (!userId) return;
    await supabase
      .from("notificacoes")
      .update({ lida: true })
      .eq("destinatario_user_id", userId)
      .eq("lida", false);
    void qc.invalidateQueries({ queryKey: ["notificacoes"] });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label="Notificações"
        >
          <Bell className="size-5" />
          {naoLidas > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {naoLidas > 9 ? "9+" : naoLidas}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notificações</p>
          {naoLidas > 0 && (
            <button
              onClick={marcarTodasLidas}
              className="text-xs font-medium text-primary hover:underline"
            >
              Marcar como lidas
            </button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notificacoes.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nada por aqui ainda.
            </p>
          )}
          {notificacoes.map((n) => (
            <div
              key={n.id}
              className={cn("border-b px-4 py-3 last:border-0", !n.lida && "bg-accent/40")}
            >
              <p className="text-sm font-medium">{n.titulo}</p>
              {n.mensagem && <p className="text-xs text-muted-foreground">{n.mensagem}</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">{formatarData(n.created_at)}</p>
            </div>
          ))}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
