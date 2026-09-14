import { cn } from "@/lib/utils";

export type TamanhoLogo = "sm" | "md" | "lg" | number;

export interface LogoAprovAIProps extends React.ComponentProps<"span"> {
  /** Tamanho do quadrado: sm (32px), md (36px), lg (40px) ou um número em px. */
  tamanho?: TamanhoLogo;
}

const TAMANHOS: Record<Exclude<TamanhoLogo, number>, number> = {
  sm: 32,
  md: 36,
  lg: 40,
};

/** Logo da marca: quadrado com gradiente e a letra "A" cursiva. */
export function LogoAprovAI({ tamanho = "md", className, ...props }: LogoAprovAIProps) {
  const lado = typeof tamanho === "number" ? tamanho : TAMANHOS[tamanho];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "gradient-brand inline-flex shrink-0 items-center justify-center rounded-2xl text-primary-foreground",
        className,
      )}
      style={{ width: lado, height: lado }}
      {...props}
    >
      <span
        style={{
          fontFamily: '"Dancing Script", cursive',
          fontWeight: 700,
          fontSize: Math.round(lado * 0.65),
          lineHeight: 1,
          // leve ajuste ótico da letra cursiva dentro do quadrado
          transform: `translateY(${Math.round(lado * 0.05)}px)`,
        }}
      >
        A
      </span>
    </span>
  );
}

export default LogoAprovAI;
