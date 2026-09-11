import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buscarTudo } from "@/lib/aprova";
import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administração — Aprova" },
      { name: "description", content: "Clientes, contatos, campanhas e papéis da equipe." },
      { property: "og:title", content: "Administração — Aprova" },
      { property: "og:description", content: "Clientes, contatos, campanhas e papéis da equipe." },
    ],
  }),
  component: Administracao,
});

interface Cliente {
  id: string;
  nome: string;
  empresa: string | null;
}
interface Contato {
  id: string;
  cliente_id: string;
  nome: string;
  email: string;
}
interface Campanha {
  id: string;
  cliente_id: string;
  nome: string;
  descricao: string | null;
}
interface Perfil {
  id: string;
  nome: string | null;
  email: string | null;
}
interface Papel {
  user_id: string;
  role: AppRole;
}

const PAPEIS: AppRole[] = ["admin", "atendimento", "criacao"];

function Administracao() {
  const { temPapel } = useAuth();
  const qc = useQueryClient();

  const [clienteNome, setClienteNome] = useState("");
  const [clienteEmpresa, setClienteEmpresa] = useState("");
  const [contatoCliente, setContatoCliente] = useState("");
  const [contatoNome, setContatoNome] = useState("");
  const [contatoEmail, setContatoEmail] = useState("");
  const [campCliente, setCampCliente] = useState("");
  const [campNome, setCampNome] = useState("");
  const [campDescricao, setCampDescricao] = useState("");

  const { data } = useQuery({
    queryKey: ["admin"],
    queryFn: async () => ({
      clientes: await buscarTudo<Cliente>(() =>
        supabase.from("clientes").select("id, nome, empresa").order("nome").order("id"),
      ),
      contatos: await buscarTudo<Contato>(() =>
        supabase.from("cliente_contatos").select("id, cliente_id, nome, email").order("nome").order("id"),
      ),
      campanhas: await buscarTudo<Campanha>(() =>
        supabase
          .from("campanhas")
          .select("id, cliente_id, nome, descricao")
          .order("created_at", { ascending: false })
          .order("id"),
      ),
      perfis: await buscarTudo<Perfil>(() =>
        supabase.from("profiles").select("id, nome, email").order("nome").order("id"),
      ),
      papeis: await buscarTudo<Papel>(() =>
        supabase.from("user_roles").select("user_id, role").order("user_id"),
      ),
    }),
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ["admin"] });
    void qc.invalidateQueries({ queryKey: ["painel"] });
  }

  const acao = useMutation({
    mutationFn: async (fn: () => Promise<{ error: unknown }>) => {
      const { error } = await fn();
      if (error) throw error instanceof Error ? error : new Error(String(error));
    },
    onSuccess: () => {
      toast.success("Pronto!");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!temPapel("admin")) {
    return (
      <p className="rounded-3xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Esta área é exclusiva de administradores.
      </p>
    );
  }

  async function alternarPapel(userId: string, role: AppRole, ativo: boolean) {
    if (ativo) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", role);
      if (error) return toast.error(error.message);
    }
    recarregar();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Administração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clientes, contatos que recebem o link, campanhas e papéis da equipe.
        </p>
      </header>

      <Tabs defaultValue="clientes">
        <TabsList className="rounded-2xl">
          <TabsTrigger value="clientes" className="rounded-xl">Clientes</TabsTrigger>
          <TabsTrigger value="campanhas" className="rounded-xl">Campanhas</TabsTrigger>
          <TabsTrigger value="equipe" className="rounded-xl">Equipe</TabsTrigger>
        </TabsList>

        <TabsContent value="clientes" className="mt-4 space-y-5">
          <section className="rounded-3xl border bg-card p-5 shadow-soft">
            <h2 className="font-semibold">Novo cliente</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="c-nome">Nome</Label>
                <Input id="c-nome" className="rounded-2xl" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-empresa">Empresa</Label>
                <Input id="c-empresa" className="rounded-2xl" value={clienteEmpresa} onChange={(e) => setClienteEmpresa(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button
                  className="gradient-brand w-full rounded-2xl text-primary-foreground hover:opacity-95"
                  disabled={!clienteNome.trim()}
                  onClick={() =>
                    acao.mutate(async () => {
                      const r = await supabase
                        .from("clientes")
                        .insert({ nome: clienteNome.trim(), empresa: clienteEmpresa.trim() || null });
                      setClienteNome("");
                      setClienteEmpresa("");
                      return r;
                    })
                  }
                >
                  <Plus className="mr-1 size-4" /> Adicionar
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border bg-card p-5 shadow-soft">
            <h2 className="font-semibold">Novo contato do cliente</h2>
            <p className="text-xs text-muted-foreground">Quem recebe o link mágico de aprovação.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select value={contatoCliente} onValueChange={setContatoCliente}>
                  <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {(data?.clientes ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-nome">Nome</Label>
                <Input id="ct-nome" className="rounded-2xl" value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-email">E-mail</Label>
                <Input id="ct-email" type="email" className="rounded-2xl" value={contatoEmail} onChange={(e) => setContatoEmail(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  className="w-full rounded-2xl"
                  disabled={!contatoCliente || !contatoNome.trim() || !contatoEmail.trim()}
                  onClick={() =>
                    acao.mutate(async () => {
                      const r = await supabase.from("cliente_contatos").insert({
                        cliente_id: contatoCliente,
                        nome: contatoNome.trim(),
                        email: contatoEmail.trim(),
                      });
                      setContatoNome("");
                      setContatoEmail("");
                      return r;
                    })
                  }
                >
                  <Plus className="mr-1 size-4" /> Adicionar
                </Button>
              </div>
            </div>
          </section>

          <div className="space-y-3">
            {(data?.clientes ?? []).map((c) => (
              <div key={c.id} className="rounded-3xl border bg-card p-4 shadow-soft">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">
                    {c.nome} {c.empresa && <span className="text-muted-foreground">· {c.empresa}</span>}
                  </p>
                </div>
                <ul className="mt-2 space-y-1">
                  {(data?.contatos ?? [])
                    .filter((ct) => ct.cliente_id === c.id)
                    .map((ct) => (
                      <li key={ct.id} className="flex items-center justify-between text-sm">
                        <span>
                          {ct.nome} <span className="text-muted-foreground">· {ct.email}</span>
                        </span>
                        <button
                          aria-label={`Remover ${ct.nome}`}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            acao.mutate(() =>
                              supabase.from("cliente_contatos").delete().eq("id", ct.id),
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="campanhas" className="mt-4 space-y-5">
          <section className="rounded-3xl border bg-card p-5 shadow-soft">
            <h2 className="font-semibold">Nova campanha</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select value={campCliente} onValueChange={setCampCliente}>
                  <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {(data?.clientes ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cp-nome">Nome</Label>
                <Input id="cp-nome" className="rounded-2xl" value={campNome} onChange={(e) => setCampNome(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cp-desc">Descrição</Label>
                <Input id="cp-desc" className="rounded-2xl" value={campDescricao} onChange={(e) => setCampDescricao(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button
                  className="gradient-brand w-full rounded-2xl text-primary-foreground hover:opacity-95"
                  disabled={!campCliente || !campNome.trim()}
                  onClick={() =>
                    acao.mutate(async () => {
                      const r = await supabase.from("campanhas").insert({
                        cliente_id: campCliente,
                        nome: campNome.trim(),
                        descricao: campDescricao.trim() || null,
                      });
                      setCampNome("");
                      setCampDescricao("");
                      return r;
                    })
                  }
                >
                  <Plus className="mr-1 size-4" /> Criar
                </Button>
              </div>
            </div>
          </section>

          <div className="space-y-2">
            {(data?.campanhas ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-2xl border bg-card px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {(data?.clientes ?? []).find((cl) => cl.id === c.cliente_id)?.nome}
                  </p>
                </div>
                <button
                  aria-label={`Arquivar ${c.nome}`}
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    acao.mutate(() =>
                      supabase.from("campanhas").update({ arquivada: true }).eq("id", c.id),
                    )
                  }
                >
                  Arquivar
                </button>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="equipe" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Peça para a pessoa criar a conta na tela de entrada; depois marque os papéis dela aqui.
          </p>
          {(data?.perfis ?? []).map((p) => (
            <div key={p.id} className="rounded-3xl border bg-card p-4 shadow-soft">
              <p className="font-semibold">{p.nome ?? p.email}</p>
              <p className="text-xs text-muted-foreground">{p.email}</p>
              <div className="mt-3 flex flex-wrap gap-4">
                {PAPEIS.map((role) => {
                  const ativo = (data?.papeis ?? []).some(
                    (r) => r.user_id === p.id && r.role === role,
                  );
                  return (
                    <label key={role} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={ativo}
                        onCheckedChange={(v) => void alternarPapel(p.id, role, v === true)}
                      />
                      {role}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
