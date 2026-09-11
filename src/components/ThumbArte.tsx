import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { urlAssinada } from "@/lib/aprova";
import { cn } from "@/lib/utils";

export interface ThumbArteProps {
  path: string | null | undefined;
  alt: string;
  className?: string;
}

export function ThumbArte({ path, alt, className }: ThumbArteProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    void urlAssinada(path).then((u) => {
      if (ativo) setUrl(u);
    });
    return () => {
      ativo = false;
    };
  }, [path]);

  if (!url) {
    return (
      <div
        className={cn(
          "flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-muted",
          className,
        )}
      >
        <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={cn("aspect-[4/3] w-full rounded-xl object-cover", className)}
    />
  );
}
