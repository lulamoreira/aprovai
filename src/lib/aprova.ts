import { supabase } from "@/integrations/supabase/client";

export type PieceStatus =
  | "criacao_ajustando"
  | "aguardando_atendimento"
  | "aguardando_cliente"
  | "retorno_atendimento"
  | "aprovada"
  | "arquivada";

export const STATUS_LABEL: Record<PieceStatus, string> = {
  criacao_ajustando: "Criação ajustando",
  aguardando_atendimento: "Aguardando atendimento",
  aguardando_cliente: "Aguardando cliente",
  retorno_atendimento: "Retorno ao atendimento",
  aprovada: "Aprovada",
  arquivada: "Arquivada",
};

export const STATUS_ORDEM: PieceStatus[] = [
  "criacao_ajustando",
  "aguardando_atendimento",
  "aguardando_cliente",
  "retorno_atendimento",
  "aprovada",
];

export const STATUS_CLASSE: Record<PieceStatus, string> = {
  criacao_ajustando: "bg-accent text-accent-foreground",
  aguardando_atendimento: "bg-warning/25 text-warning-foreground",
  aguardando_cliente: "bg-cyan/25 text-cyan-foreground",
  retorno_atendimento: "bg-info/25 text-info-foreground",
  aprovada: "bg-success/25 text-success-foreground",
  arquivada: "bg-muted text-muted-foreground",
};

export const PAPEL_LABEL: Record<string, string> = {
  criacao: "Criação",
  atendimento: "Atendimento",
  cliente: "Cliente",
};

export const EVENTO_LABEL: Record<string, string> = {
  subiu_versao: "subiu uma nova versão",
  enviou: "enviou a peça",
  viu: "visualizou",
  comentou: "comentou",
  autorizou_edicao: "autorizou a edição do cliente",
  revogou_autorizacao: "revogou a autorização",
  aprovou: "aprovou a peça",
  devolveu: "devolveu com comentários",
};

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

const cacheUrls = new Map<string, string>();

export async function urlAssinada(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const emCache = cacheUrls.get(path);
  if (emCache) return emCache;
  const { data, error } = await supabase.storage
    .from("peca-imagens")
    .createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  cacheUrls.set(path, data.signedUrl);
  return data.signedUrl;
}

const PAGINA = 500;

/** Busca todas as linhas em páginas — nunca confia no limite implícito. */
export async function buscarTudo<T>(
  construir: () => ReturnType<typeof supabase.from> extends never ? never : any,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await construir().range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    const lote = (data ?? []) as T[];
    linhas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return linhas;
}
