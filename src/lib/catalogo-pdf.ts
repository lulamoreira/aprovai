import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { buscarTudo, formatarData, PAPEL_LABEL, STATUS_LABEL, type PieceStatus } from "@/lib/aprova";

export interface PecaCatalogo {
  id: string;
  nome: string;
  tamanho: string | null;
  status: PieceStatus;
  versao_atual: number;
  thumb_url: string | null;
}

interface ComentarioCatalogo {
  autor_papel: string;
  texto: string;
  pin_x: number | null;
  pin_y: number | null;
  created_at: string;
  versao_id: string | null;
}

interface VersaoCatalogo {
  id: string;
  numero: number;
}

const LADO_MAX = 360;

/** Carrega a arte pela URL pública, reduz num canvas e devolve um JPEG comprimido. */
async function miniaturaComprimida(
  path: string | null,
): Promise<{ dataUrl: string; largura: number; altura: number } | null> {
  if (!path) return null;
  try {
    const { data } = supabase.storage.from("peca-imagens").getPublicUrl(path);
    if (!data?.publicUrl) return null;

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("falha ao carregar imagem"));
      el.src = data.publicUrl;
    });

    const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const largura = Math.max(1, Math.round(img.naturalWidth * escala));
    const altura = Math.max(1, Math.round(img.naturalHeight * escala));

    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(img, 0, 0, largura, altura);

    return { dataUrl: canvas.toDataURL("image/jpeg", 0.7), largura, altura };
  } catch {
    return null;
  }
}

function dataArquivo(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "catalogo"
  );
}

export interface OpcoesCatalogo {
  pecas: PecaCatalogo[];
  /** Marca/cliente exibida no cabeçalho. */
  cliente?: string | null;
  /** Campanha ou "Seleção de peças". */
  contexto: string;
}

export async function gerarCatalogoMudancas({
  pecas,
  cliente,
  contexto,
}: OpcoesCatalogo): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const larguraPag = doc.internal.pageSize.getWidth();
  const alturaPag = doc.internal.pageSize.getHeight();
  const margem = 40;
  const larguraUtil = larguraPag - margem * 2;
  let y = margem;

  function novaPaginaSeNecessario(espaco: number) {
    if (y + espaco > alturaPag - margem) {
      doc.addPage();
      y = margem;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Catálogo de mudanças", margem, y + 6);
  y += 26;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  if (cliente) {
    doc.text(`Cliente: ${cliente}`, margem, y);
    y += 15;
  }
  doc.text(`Campanha: ${contexto}`, margem, y);
  y += 15;
  doc.text(`Gerado em: ${formatarData(new Date().toISOString())}`, margem, y);
  y += 10;
  doc.setDrawColor(200);
  doc.line(margem, y, larguraPag - margem, y);
  y += 18;

  for (const peca of pecas) {
    const [comentarios, versoes, thumb] = await Promise.all([
      buscarTudo<ComentarioCatalogo>(() =>
        supabase
          .from("comentarios")
          .select("autor_papel, texto, pin_x, pin_y, created_at, versao_id")
          .eq("peca_id", peca.id)
          .order("created_at", { ascending: true })
          .order("id"),
      ),
      buscarTudo<VersaoCatalogo>(() =>
        supabase.from("peca_versoes").select("id, numero").eq("peca_id", peca.id).order("numero"),
      ),
      miniaturaComprimida(peca.thumb_url),
    ]);

    const numeroPorVersao = new Map(versoes.map((v) => [v.id, v.numero]));

    novaPaginaSeNecessario(120);

    const alturaThumb = 80;
    const larguraThumb = thumb ? Math.max(1, (thumb.largura / thumb.altura) * alturaThumb) : 100;
    const topo = y;

    if (thumb) {
      try {
        doc.addImage(thumb.dataUrl, "JPEG", margem, topo, larguraThumb, alturaThumb);
      } catch {
        /* imagem inválida: segue sem miniatura */
      }
    } else {
      doc.setDrawColor(220);
      doc.rect(margem, topo, larguraThumb, alturaThumb);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text("sem arte", margem + 10, topo + alturaThumb / 2);
      doc.setTextColor(0);
    }

    const xTexto = margem + larguraThumb + 14;
    let yTexto = topo + 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(peca.nome, xTexto, yTexto, { maxWidth: larguraPag - margem - xTexto });
    yTexto += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Tamanho: ${peca.tamanho ?? "não informado"}`, xTexto, yTexto);
    yTexto += 13;
    doc.text(`Status: ${STATUS_LABEL[peca.status]}`, xTexto, yTexto);
    yTexto += 13;
    doc.text(`Versão atual: v${peca.versao_atual}`, xTexto, yTexto);

    y = Math.max(topo + alturaThumb, yTexto) + 16;

    novaPaginaSeNecessario(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Mudanças pedidas:", margem, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    if (comentarios.length === 0) {
      doc.text("Sem mudanças registradas.", margem + 10, y);
      y += 16;
    } else {
      const grupos = new Map<number, ComentarioCatalogo[]>();
      for (const c of comentarios) {
        const num = (c.versao_id && numeroPorVersao.get(c.versao_id)) || 0;
        const lista = grupos.get(num) ?? [];
        lista.push(c);
        grupos.set(num, lista);
      }
      for (const num of [...grupos.keys()].sort((a, b) => a - b)) {
        novaPaginaSeNecessario(24);
        doc.setFont("helvetica", "bold");
        doc.text(num ? `v${num}` : "Sem versão", margem + 10, y);
        doc.setFont("helvetica", "normal");
        y += 13;
        for (const c of grupos.get(num) ?? []) {
          const papel = PAPEL_LABEL[c.autor_papel] ?? c.autor_papel;
          const pin = c.pin_x != null && c.pin_y != null ? " (ponto marcado)" : "";
          const linhas = doc.splitTextToSize(
            `• ${papel} · ${formatarData(c.created_at)}${pin}: ${c.texto}`,
            larguraUtil - 20,
          ) as string[];
          novaPaginaSeNecessario(linhas.length * 12 + 4);
          doc.text(linhas, margem + 20, y);
          y += linhas.length * 12 + 4;
        }
        y += 4;
      }
    }

    y += 8;
    novaPaginaSeNecessario(12);
    doc.setDrawColor(230);
    doc.line(margem, y, larguraPag - margem, y);
    y += 16;
  }

  doc.save(`catalogo-mudancas-${slug(contexto || cliente || "pecas")}-${dataArquivo()}.pdf`);
}
