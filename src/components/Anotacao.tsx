import { useCallback, useState } from "react";
import { Eraser, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Um traço à mão livre, em coordenadas relativas (0..1) à caixa da arte. */
export interface Traco {
  color: string;
  size: number;
  points: [number, number][];
}

export interface AnotacaoJson {
  strokes: Traco[];
}

export const CORES_ANOTACAO: { valor: string; nome: string }[] = [
  { valor: "#e11d48", nome: "Vermelho" },
  { valor: "#f59e0b", nome: "Amarelo" },
  { valor: "#16a34a", nome: "Verde" },
  { valor: "#2563eb", nome: "Azul" },
  { valor: "#7D2AE8", nome: "Roxo" },
  { valor: "#111111", nome: "Preto" },
];

/** Converte com segurança o jsonb salvo no banco em traços renderizáveis. */
export function lerAnotacao(valor: unknown): Traco[] {
  if (!valor || typeof valor !== "object") return [];
  const bruto = (valor as { strokes?: unknown }).strokes;
  if (!Array.isArray(bruto)) return [];
  const traços: Traco[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const t = item as Partial<Traco>;
    if (!Array.isArray(t.points)) continue;
    const pontos = t.points.filter(
      (p): p is [number, number] =>
        Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number",
    );
    if (pontos.length === 0) continue;
    traços.push({
      color: typeof t.color === "string" ? t.color : "#e11d48",
      size: typeof t.size === "number" ? t.size : 3,
      points: pontos,
    });
  }
  return traços;
}

export interface AnotacaoViewProps {
  strokes: Traco[];
  className?: string;
}

/** Desenha os traços por cima da arte, escalando para qualquer tamanho. */
export function AnotacaoView({ strokes, className }: AnotacaoViewProps) {
  if (strokes.length === 0) return null;
  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
    >
      {strokes.map((t, i) => (
        <polyline
          key={i}
          points={t.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")}
          fill="none"
          stroke={t.color}
          strokeWidth={t.size * 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export type Ferramenta = "caneta" | "borracha";

export interface EstadoAnotador {
  strokes: Traco[];
  cor: string;
  setCor: (c: string) => void;
  ferramenta: Ferramenta;
  setFerramenta: (f: Ferramenta) => void;
  desenhando: boolean;
  setDesenhando: (v: boolean) => void;
  desfazer: () => void;
  limpar: () => void;
  aoIniciar: (e: React.PointerEvent<HTMLDivElement>) => void;
  aoMover: (e: React.PointerEvent<HTMLDivElement>) => void;
  aoFinalizar: () => void;
}

function posicao(e: React.PointerEvent<HTMLDivElement>): [number, number] {
  const box = e.currentTarget.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
  const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
  return [Number(x.toFixed(4)), Number(y.toFixed(4))];
}

/** Estado do desenho em edição (não interfere em anotações já salvas). */
export function useAnotador(): EstadoAnotador {
  const [strokes, setStrokes] = useState<Traco[]>([]);
  const [cor, setCor] = useState<string>(CORES_ANOTACAO[0]!.valor);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("caneta");
  const [desenhando, setDesenhando] = useState(false);
  const [ativo, setAtivo] = useState(false);

  const desfazer = useCallback(() => setStrokes((s) => s.slice(0, -1)), []);
  const limpar = useCallback(() => setStrokes([]), []);

  const apagarEm = useCallback(([x, y]: [number, number]) => {
    setStrokes((s) =>
      s.filter(
        (t) => !t.points.some(([px, py]) => Math.hypot(px - x, py - y) < 0.025 + t.size / 400),
      ),
    );
  }, []);

  const aoIniciar = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = posicao(e);
      if (ferramenta === "borracha") {
        apagarEm(p);
        return;
      }
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setAtivo(true);
      setStrokes((s) => [...s, { color: cor, size: 3, points: [p] }]);
    },
    [apagarEm, cor, ferramenta],
  );

  const aoMover = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!ativo || ferramenta === "borracha") return;
      const p = posicao(e);
      setStrokes((s) => {
        if (s.length === 0) return s;
        const ultimo = s[s.length - 1]!;
        return [...s.slice(0, -1), { ...ultimo, points: [...ultimo.points, p] }];
      });
    },
    [ativo, ferramenta],
  );

  const aoFinalizar = useCallback(() => setAtivo(false), []);

  return {
    strokes,
    cor,
    setCor,
    ferramenta,
    setFerramenta,
    desenhando,
    setDesenhando,
    desfazer,
    limpar,
    aoIniciar,
    aoMover,
    aoFinalizar,
  };
}

export interface BarraAnotacaoProps {
  estado: EstadoAnotador;
  className?: string;
}

/** Barra de ferramentas do desenho. */
export function BarraAnotacao({ estado, className }: BarraAnotacaoProps) {
  const { desenhando, setDesenhando, ferramenta, setFerramenta, cor, setCor } = estado;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-2", className)}>
      <Button
        type="button"
        size="sm"
        variant={desenhando ? "default" : "outline"}
        className={cn("rounded-xl", desenhando && "gradient-brand text-primary-foreground")}
        onClick={() => {
          setDesenhando(!desenhando);
          setFerramenta("caneta");
        }}
      >
        <Pencil className="mr-1 size-4" /> {desenhando ? "Desenhando" : "Desenhar"}
      </Button>

      {desenhando && (
        <>
          <div className="flex items-center gap-1">
            {CORES_ANOTACAO.map((c) => (
              <button
                key={c.valor}
                type="button"
                aria-label={c.nome}
                title={c.nome}
                onClick={() => {
                  setCor(c.valor);
                  setFerramenta("caneta");
                }}
                style={{ backgroundColor: c.valor }}
                className={cn(
                  "size-6 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  cor === c.valor && ferramenta === "caneta"
                    ? "scale-110 border-foreground"
                    : "border-transparent",
                )}
              />
            ))}
          </div>

          <Button
            type="button"
            size="sm"
            variant={ferramenta === "borracha" ? "default" : "outline"}
            className="rounded-xl"
            onClick={() => setFerramenta("borracha")}
          >
            <Eraser className="mr-1 size-4" /> Borracha
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            disabled={estado.strokes.length === 0}
            onClick={estado.desfazer}
          >
            <RotateCcw className="mr-1 size-4" /> Desfazer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-xl"
            disabled={estado.strokes.length === 0}
            onClick={estado.limpar}
          >
            <Trash2 className="mr-1 size-4" /> Limpar
          </Button>
        </>
      )}
    </div>
  );
}

export interface CamadaAnotacaoProps {
  estado: EstadoAnotador;
}

/** Camada transparente que captura o desenho sobre a arte. */
export function CamadaAnotacao({ estado }: CamadaAnotacaoProps) {
  if (!estado.desenhando) return <AnotacaoView strokes={estado.strokes} />;
  return (
    <div
      role="presentation"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={estado.aoIniciar}
      onPointerMove={estado.aoMover}
      onPointerUp={estado.aoFinalizar}
      onPointerLeave={estado.aoFinalizar}
      className={cn(
        "absolute inset-0 touch-none",
        estado.ferramenta === "borracha" ? "cursor-cell" : "cursor-crosshair",
      )}
    >
      <AnotacaoView strokes={estado.strokes} />
    </div>
  );
}
