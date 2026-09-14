import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface MolduraArteProps {
  /** URL pública/assinada da arte. */
  src: string | null;
  alt: string;
  /** Proporção conhecida da versão (peca_versoes.largura_px / altura_px). */
  largura?: number | null;
  altura?: number | null;
  /** Altura máxima da moldura (padrão 70vh). */
  alturaMaxima?: string;
  /** Clique na arte: recebe coordenadas relativas 0..1 da ARTE. */
  aoClicar?: (ponto: { x: number; y: number }) => void;
  cursorCruz?: boolean;
  vazio?: React.ReactNode;
  className?: string;
  /** Camadas sobrepostas (pins, anotações) — usam absolute inset-0. */
  children?: React.ReactNode;
}

/**
 * Contêiner com a MESMA proporção da arte: a imagem preenche 100% dele, sem
 * barras de letterbox. Assim as camadas `absolute inset-0` e as coordenadas
 * capturadas pelo getBoundingClientRect coincidem pixel a pixel com a arte,
 * em qualquer largura de tela.
 */
export function MolduraArte({
  src,
  alt,
  largura,
  altura,
  alturaMaxima = "70vh",
  aoClicar,
  cursorCruz,
  vazio,
  className,
  children,
}: MolduraArteProps) {
  const proporcaoInicial = largura && altura && largura > 0 && altura > 0 ? largura / altura : null;
  const [proporcao, setProporcao] = useState<number | null>(proporcaoInicial);

  useEffect(() => {
    setProporcao(proporcaoInicial);
  }, [proporcaoInicial, src]);

  const razao = proporcao && Number.isFinite(proporcao) && proporcao > 0 ? proporcao : 1;

  if (!src) {
    return (
      <div
        className={cn(
          "flex min-h-[240px] items-center justify-center rounded-2xl bg-muted",
          className,
        )}
      >
        {vazio}
      </div>
    );
  }

  return (
    <div className={cn("flex w-full justify-center", className)}>
      <div
        role="presentation"
        onClick={(e) => {
          if (!aoClicar) return;
          const box = e.currentTarget.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return;
          aoClicar({
            x: Number(
              Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)).toFixed(4),
            ),
            y: Number(
              Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)).toFixed(4),
            ),
          });
        }}
        style={{
          aspectRatio: `${razao}`,
          width: `min(100%, calc(${alturaMaxima} * ${razao}))`,
          maxHeight: alturaMaxima,
        }}
        className={cn(
          "relative overflow-hidden rounded-2xl bg-muted",
          cursorCruz && "cursor-crosshair",
        )}
      >
        <img
          src={src}
          alt={alt}
          onLoad={(e) => {
            if (proporcaoInicial) return;
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setProporcao(img.naturalWidth / img.naturalHeight);
            }
          }}
          className="absolute inset-0 size-full object-fill"
        />
        {children}
      </div>
    </div>
  );
}
