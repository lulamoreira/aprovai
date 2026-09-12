import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Info, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buscarTudo } from "@/lib/aprova";
import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administração — Aprova" },
      { name: "description", content: "Clientes, aprovadores, campanhas e papéis da equipe." },
      { property: "og:title", content: "Administração — Aprova" },
      {
        property: "og:description",
        content: "Clientes, aprovadores, campanhas e papéis da equipe.",
      },
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

type Acao = () => PromiseLike<{ error: unknown }>;

function Administracao() {
  const { temPapel } = useAuth();
  const qc = useQueryClient();

  const [novoCliente, setNovoCliente] = useState("");
  const [criandoCliente, setCriandoCliente] = useState(false);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");

  const { data } = useQuery({
    queryKey: ["admin"],
    queryFn: async () => ({
      clientes: await buscarTudo<Cliente>(() =>
        supabase.from("clientes").select("id, nome, empresa").order("nome").order("id"),
      ),
      contatos: await buscarTudo<Contato>(() =>
        supabase
          .from("cliente_contatos")
          .select("id, cliente_id, nome, email")
          .order("nome")
          .order("id"),
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
    mutationFn: async (fn: Acao) => {
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
    const { error } = ativo
      ? await supabase.from("user_roles").insert({ user_id: userId, role })
      : await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) {
      toast.error(error.message);
      return;
    }
    recarregar();
  }

  const clientes = data?.clientes ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Administração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Organize suas marcas, quem aprova e as campanhas.
        </p>
      </header>

      <Tabs defaultValue="clientes">
        <TabsList className="rounded-2xl">
          <TabsTrigger value="clientes" className="rounded-xl">
            Clientes
          </TabsTrigger>
          <TabsTrigger value="equipe" className="rounded-xl">
            Equipe
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clientes" className="mt-4 space-y-5">
          <div className="flex items-start gap-3 rounded-3xl border border-primary/20 bg-primary/5 p-4">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Cliente é a marca</span> (ex: Lindt).
              Dentro dela ficam os <span className="font-medium text-foreground">aprovadores</span>,
              que recebem o link, e as <span className="font-medium text-foreground">campanhas</span>{" "}
              (ex: Natal). As peças ficam dentro de cada campanha.
            </p>
          </div>

          {criandoCliente ? (
            <section className="rounded-3xl border bg-card p-5 shadow-soft">
              <Label htmlFor="novo-cliente">Nome do cliente (marca)</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                A marca/empresa que aprova as peças.
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <Input
                  id="novo-cliente"
                  autoFocus
                  className="rounded-2xl"
                  placeholder="Ex: Lindt, Nestlé, O Boticário"
                  value={novoCliente}
                  onChange={(e) => setNovoCliente(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
                    disabled={!novoCliente.trim() || acao.isPending}
                    onClick={() =>
                      acao.mutate(async () => {
                        const r = await supabase
                          .from("clientes")
                          .insert({ nome: novoCliente.trim() });
                        setNovoCliente("");
                        setCriandoCliente(false);
                        return r;
                      })
                    }
                  >
                    <Check className="mr-1 size-4" /> Salvar
                  </Button>
                  <Button
                    variant="ghost"
                    className="rounded-2xl"
                    onClick={() => {
                      setNovoCliente("");
                      setCriandoCliente(false);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <Button
              className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
              onClick={() => setCriandoCliente(true)}
            >
              <Plus className="mr-1 size-4" /> Novo cliente
            </Button>
          )}

          {clientes.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-10 text-center">
              <Users className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-semibold">Nenhum cliente ainda</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Comece cadastrando a primeira marca. Depois você adiciona os aprovadores e as
                campanhas dela.
              </p>
              <Button
                className="gradient-brand mt-4 rounded-2xl text-primary-foreground hover:opacity-95"
                onClick={() => setCriandoCliente(true)}
              >
                <Plus className="mr-1 size-4" /> Novo cliente
              </Button>
            </div>
          ) : (
            <Accordion type="multiple" className="space-y-3">
              {clientes.map((c) => (
                <AccordionItem
                  key={c.id}
                  value={c.id}
                  className="rounded-3xl border bg-card px-4 shadow-soft"
                >
                  <div className="flex items-center gap-2">
                    {renomeando === c.id ? (
                      <div className="flex flex-1 items-center gap-2 py-3">
                        <Input
                          autoFocus
                          className="rounded-2xl"
                          value={nomeEditado}
                          onChange={(e) => setNomeEditado(e.target.value)}
                          aria-label={`Novo nome de ${c.nome}`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="rounded-xl"
                          aria-label="Salvar nome"
                          disabled={!nomeEditado.trim()}
                          onClick={() =>
                            acao.mutate(async () => {
                              const r = await supabase
                                .from("clientes")
                                .update({ nome: nomeEditado.trim() })
                                .eq("id", c.id);
                              setRenomeando(null);
                              return r;
                            })
                          }
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="rounded-xl"
                          aria-label="Cancelar"
                          onClick={() => setRenomeando(null)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <AccordionTrigger className="flex-1 py-4 hover:no-underline">
                          <span className="text-left font-semibold">{c.nome}</span>
                        </AccordionTrigger>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="rounded-xl"
                          aria-label={`Renomear ${c.nome}`}
                          onClick={() => {
                            setRenomeando(c.id);
                            setNomeEditado(c.nome);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="rounded-xl text-muted-foreground hover:text-destructive"
                              aria-label={`Excluir ${c.nome}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="rounded-3xl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir “{c.nome}”?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Isso apaga também os aprovadores, as campanhas e todas as peças
                                deste cliente. Esta ação é irreversível.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                className="rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() =>
                                  acao.mutate(() =>
                                    supabase.from("clientes").delete().eq("id", c.id),
                                  )
                                }
                              >
                                Excluir definitivamente
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>

                  <AccordionContent className="space-y-5 pb-5">
                    <SecaoAprovadores
                      cliente={c}
                      contatos={(data?.contatos ?? []).filter((ct) => ct.cliente_id === c.id)}
                      acao={acao.mutate}
                    />
                    <SecaoCampanhas
                      cliente={c}
                      campanhas={(data?.campanhas ?? []).filter((cp) => cp.cliente_id === c.id)}
                      acao={acao.mutate}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
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

function SecaoAprovadores({
  cliente,
  contatos,
  acao,
}: {
  cliente: Cliente;
  contatos: Contato[];
  acao: (fn: Acao) => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const valido = nome.trim().length > 0 && /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <section className="rounded-2xl bg-muted/40 p-4">
      <h3 className="text-sm font-semibold">Aprovadores</h3>
      <p className="text-xs text-muted-foreground">Quem recebe o link mágico de aprovação.</p>

      <ul className="mt-3 space-y-1">
        {contatos.length === 0 && (
          <li className="text-sm text-muted-foreground">Nenhum aprovador cadastrado ainda.</li>
        )}
        {contatos.map((ct) => (
          <li key={ct.id} className="flex items-center justify-between text-sm">
            <span>
              {ct.nome} <span className="text-muted-foreground">· {ct.email}</span>
            </span>
            <button
              aria-label={`Remover ${ct.nome}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => acao(() => supabase.from("cliente_contatos").delete().eq("id", ct.id))}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          className="rounded-2xl bg-background"
          placeholder="Nome"
          aria-label={`Nome do aprovador de ${cliente.nome}`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <Input
          type="email"
          className="rounded-2xl bg-background"
          placeholder="E-mail"
          aria-label={`E-mail do aprovador de ${cliente.nome}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button
          variant="outline"
          className="rounded-2xl"
          disabled={!valido}
          onClick={() =>
            acao(async () => {
              const r = await supabase.from("cliente_contatos").insert({
                cliente_id: cliente.id,
                nome: nome.trim(),
                email: email.trim(),
              });
              setNome("");
              setEmail("");
              return r;
            })
          }
        >
          <Plus className="mr-1 size-4" /> Adicionar
        </Button>
      </div>
    </section>
  );
}

function SecaoCampanhas({
  cliente,
  campanhas,
  acao,
}: {
  cliente: Cliente;
  campanhas: Campanha[];
  acao: (fn: Acao) => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  return (
    <section className="rounded-2xl bg-muted/40 p-4">
      <h3 className="text-sm font-semibold">Campanhas</h3>
      <p className="text-xs text-muted-foreground">As peças ficam dentro de cada campanha.</p>

      <ul className="mt-3 space-y-1">
        {campanhas.length === 0 && (
          <li className="text-sm text-muted-foreground">Nenhuma campanha ainda.</li>
        )}
        {campanhas.map((cp) => (
          <li
            key={cp.id}
            className="flex items-center justify-between rounded-xl bg-background px-3 py-2"
          >
            <Link
              to="/campanhas/$campanhaId"
              params={{ campanhaId: cp.id }}
              className="text-sm font-medium hover:text-primary"
            >
              {cp.nome}
              {cp.descricao && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {cp.descricao}
                </span>
              )}
            </Link>
            <button
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={() =>
                acao(() => supabase.from("campanhas").update({ arquivada: true }).eq("id", cp.id))
              }
            >
              Arquivar
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          className="rounded-2xl bg-background"
          placeholder="Nome da campanha (ex: Natal)"
          aria-label={`Nome da campanha de ${cliente.nome}`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <Input
          className="rounded-2xl bg-background"
          placeholder="Descrição (opcional)"
          aria-label={`Descrição da campanha de ${cliente.nome}`}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
        <Button
          className="gradient-brand rounded-2xl text-primary-foreground hover:opacity-95"
          disabled={!nome.trim()}
          onClick={() =>
            acao(async () => {
              const r = await supabase.from("campanhas").insert({
                cliente_id: cliente.id,
                nome: nome.trim(),
                descricao: descricao.trim() || null,
              });
              setNome("");
              setDescricao("");
              return r;
            })
          }
        >
          <Plus className="mr-1 size-4" /> Criar
        </Button>
      </div>
    </section>
  );
}
