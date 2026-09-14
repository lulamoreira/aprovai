import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Lock, MessagesSquare } from "lucide-react";
import { LogoAprovAI } from "@/components/LogoAprovAI";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AprovAI — aprovação de peças de campanha sem ruído" },
      {
        name: "description",
        content:
          "Criação, atendimento e cliente aprovando peças em um fluxo só: cada peça fica com um responsável por vez e tudo fica registrado.",
      },
      { property: "og:title", content: "AprovAI — aprovação de peças de campanha" },
      {
        property: "og:description",
        content:
          "Fluxo de aprovação de peças com trava por etapa, comentários com pin e histórico.",
      },
    ],
  }),
  component: Inicio,
});

const destaques = [
  {
    icone: Lock,
    titulo: "Um dono por vez",
    texto:
      "A peça fica na mão de um papel só. Depois que o próximo vê, ninguém reescreve o passado.",
  },
  {
    icone: MessagesSquare,
    titulo: "Comentários no ponto",
    texto:
      "Clique na arte e marque exatamente onde precisa mudar. Cada versão guarda sua conversa.",
  },
  {
    icone: CheckCircle2,
    titulo: "Cliente sem senha",
    texto: "O cliente recebe um link exclusivo, avalia no celular e aprova ou devolve com pedidos.",
  },
];

function Inicio() {
  const { session, carregando } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <LogoAprovAI tamanho={36} />
          <span className="text-lg font-bold tracking-tight">AprovAI</span>
        </div>
        <Button asChild variant="ghost" className="rounded-2xl">
          <Link to={session && !carregando ? "/painel" : "/auth"}>
            {session && !carregando ? "Abrir painel" : "Entrar"}
          </Link>
        </Button>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="py-14 text-center md:py-20">
          <span className="inline-flex rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
            Retail marketing
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            A aprovação de peças que <span className="text-gradient-brand">não se perde</span> no
            grupo de mensagens
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
            Criação, atendimento e cliente no mesmo bastão. Cada envio trava o que já foi dito e
            deixa o histórico inteiro à vista.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button
              asChild
              size="lg"
              className="gradient-brand rounded-2xl px-6 text-primary-foreground shadow-soft hover:opacity-95"
            >
              <Link to={session && !carregando ? "/painel" : "/auth"}>
                Começar agora <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {destaques.map((d) => (
            <article key={d.titulo} className="rounded-3xl border bg-card p-6 shadow-soft">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-accent">
                <d.icone className="size-5 text-accent-foreground" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">{d.titulo}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{d.texto}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
