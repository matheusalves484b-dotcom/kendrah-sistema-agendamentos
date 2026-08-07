// Gerador de PDF minimalista (A4 paisagem, fonte Helvetica/WinAnsi).
// Suficiente para relatórios tabulares em pt-BR sem dependências externas.

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 32;

type Cell = { text: string; x: number; bold?: boolean; size?: number };
type Line = Cell[];

const latin1 = (value: string) => {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
};

const escapeText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export interface PdfTable {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
  columnWidths: number[];
}

const truncate = (text: string, width: number, size: number) => {
  const maxChars = Math.max(1, Math.floor(width / (size * 0.5)));
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
};

export function buildTablePdf({ title, subtitle, headers, rows, columnWidths }: PdfTable): Uint8Array {
  const usable = PAGE_WIDTH - MARGIN * 2;
  const totalWeight = columnWidths.reduce((sum, w) => sum + w, 0);
  const widths = columnWidths.map((w) => (w / totalWeight) * usable);
  const offsets: number[] = [];
  widths.reduce((acc, w, i) => {
    offsets[i] = MARGIN + acc;
    return acc + w;
  }, 0);

  const bodySize = 9;
  const rowHeight = 16;
  const rowsPerPage = Math.floor((PAGE_HEIGHT - MARGIN * 2 - 70) / rowHeight);

  const pages: Line[][] = [];
  for (let i = 0; i < Math.max(1, Math.ceil(rows.length / rowsPerPage)); i++) {
    const chunk = rows.slice(i * rowsPerPage, (i + 1) * rowsPerPage);
    const lines: Line[] = [];
    lines.push([{ text: title, x: MARGIN, bold: true, size: 16 }]);
    if (subtitle) lines.push([{ text: subtitle, x: MARGIN, size: 10 }]);
    lines.push(
      headers.map((h, c) => ({
        text: truncate(h, widths[c], bodySize),
        x: offsets[c],
        bold: true,
        size: bodySize,
      })),
    );
    for (const row of chunk) {
      lines.push(
        row.map((value, c) => ({
          text: truncate(value ?? "", widths[c], bodySize),
          x: offsets[c],
          size: bodySize,
        })),
      );
    }
    pages.push(lines);
  }

  const contents = pages.map((lines) => {
    let y = PAGE_HEIGHT - MARGIN - 12;
    let stream = "";
    lines.forEach((line, index) => {
      if (index > 0) y -= index === 1 ? 22 : rowHeight;
      for (const cell of line) {
        const font = cell.bold ? "/F2" : "/F1";
        stream += `BT ${font} ${cell.size ?? bodySize} Tf 1 0 0 1 ${cell.x.toFixed(2)} ${y.toFixed(2)} Tm (${escapeText(cell.text)}) Tj ET\n`;
      }
    });
    return stream;
  });

  // Montagem do arquivo PDF
  const objects: string[] = [];
  const pageCount = contents.length;
  const kids = Array.from({ length: pageCount }, (_, i) => `${4 + i * 2} 0 R`).join(" ");

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] =
    "<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> " +
    "/F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> >> >>";

  contents.forEach((stream, i) => {
    const pageObj = 4 + i * 2;
    const contentObj = pageObj + 1;
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources 3 0 R /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${latin1(stream).length} >>\nstream\n${stream}endstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsetsTable: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsetsTable[i] = latin1(pdf).length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = latin1(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsetsTable[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return latin1(pdf);
}
