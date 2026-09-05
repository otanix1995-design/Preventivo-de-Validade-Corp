/**
 * Utility to extract text lines or structured rows from PDF documents (e.g. Relatório de Vencimentos).
 */
import * as pdfjsLib from 'pdfjs-dist';

// Configure worker safely for Vite/ESM
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
}

export interface ExtractedPdfLine {
  text: string;
  items: string[];
  pageNumber: number;
}

/**
 * Extracts raw text items grouped into rows/lines from a PDF file buffer.
 */
export async function extractLinesFromPdf(fileBuffer: ArrayBuffer): Promise<ExtractedPdfLine[]> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(fileBuffer),
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const allLines: ExtractedPdfLine[] = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items as Array<{ str: string; transform: number[] }>;

    // Group items by Y coordinate (within 4px tolerance)
    const linesByY: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];

    for (const it of items) {
      const text = it.str;
      if (!text || text.trim() === '') continue;
      const x = it.transform[4];
      const y = Math.round(it.transform[5]);

      let existingLine = linesByY.find((l) => Math.abs(l.y - y) <= 4);
      if (!existingLine) {
        existingLine = { y, items: [] };
        linesByY.push(existingLine);
      }
      existingLine.items.push({ x, text });
    }

    // Sort lines from top to bottom (Y descending)
    linesByY.sort((a, b) => b.y - a.y);

    for (const l of linesByY) {
      // Sort items left to right (X ascending)
      l.items.sort((a, b) => a.x - b.x);
      const rowTokens = l.items.map((i) => i.text.trim()).filter(Boolean);
      const rowText = rowTokens.join(' ');
      if (rowText.trim()) {
        allLines.push({
          text: rowText,
          items: rowTokens,
          pageNumber: pageNum,
        });
      }
    }
  }

  return allLines;
}

/**
 * Converts a PDF buffer into a 2D array of rows [headerRow, ...dataRows]
 * so that standard spreadsheet parsing pipelines can process it.
 */
export async function pdfToTableRows(fileBuffer: ArrayBuffer): Promise<any[][]> {
  const lines = await extractLinesFromPdf(fileBuffer);
  if (lines.length === 0) return [];

  const headers = [
    'CÓDIGO',
    'DIG',
    'DESCRIÇÃO',
    'EMBALAGEM',
    'COMPRADOR',
    'QUANTIDADE',
    'ESTOQUE_LOJA',
    'DATA VENCIMENTO',
    'PREÇO TRABALHADO',
  ];

  const resultRows: any[][] = [headers];

  // Regex patterns
  const dateRegex = /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/;
  const codeWithDigRegex = /\b(\d{4,8})[-/](\d{1,3})\b/;
  const codeAloneRegex = /\b(\d{4,8})\b/;
  const priceRegex = /R?\$?\s*(\d+[,\.]\d{2})\b/;
  const packagingRegex = /\b(CXA?|CX|FD|PCT|UN|KG|LT|L|GF|SC|BL|CJ|PAR|BD)\s*(\d+.*)?\b/i;

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;

    // Ignore known report banner headers and footers
    if (
      text.toUpperCase().includes('PREVENTIVO SETOR') ||
      text.toUpperCase().includes('PÁGINA ') ||
      text.toUpperCase().includes('PAGINA ') ||
      text.toUpperCase().includes('LIDER ')
    ) {
      continue;
    }

    // Check if line contains a date
    const dateMatch = text.match(dateRegex);
    if (!dateMatch) continue;

    const dataVcto = dateMatch[1];

    // Check for code
    let codigo = '';
    let digito = '';

    const codeDigMatch = text.match(codeWithDigRegex);
    if (codeDigMatch) {
      codigo = codeDigMatch[1];
      digito = codeDigMatch[2];
    } else {
      const codeMatch = text.match(codeAloneRegex);
      if (codeMatch) {
        codigo = codeMatch[1];
        // Check next token for digito
        const tokens = line.items;
        const codeIdx = tokens.findIndex((t) => t.includes(codigo));
        if (codeIdx !== -1 && codeIdx + 1 < tokens.length) {
          const nextTok = tokens[codeIdx + 1];
          if (/^\d{1,3}$/.test(nextTok)) {
            digito = nextTok;
          }
        }
      }
    }

    if (!codigo) continue;

    // Extract price if present
    let preco: string = '';
    const priceMatches = text.match(new RegExp(priceRegex.source, 'g'));
    if (priceMatches && priceMatches.length > 0) {
      const lastPrice = priceMatches[priceMatches.length - 1];
      const pClean = lastPrice.replace(/[R$\s]/g, '');
      preco = pClean;
    }

    // Extract packaging if present
    let embalagem = '';
    const pkgMatch = text.match(packagingRegex);
    if (pkgMatch) {
      embalagem = pkgMatch[0];
    }

    // Extract quantity (QTD VENCENDO / CADASTRADA) vs ESTOQUE
    let quantidade: number | string = '';
    let estoqueLoja: string = '';

    // If tokens has words like "caixa", "unidade", "unidades", "kg" -> store stock description
    const estoqueMatch = text.match(/(\d+\s*(?:caixas?|unidades?|cx|un|kg|g)(?:\s*\+\s*\d+\s*(?:caixas?|unidades?|cx|un|kg|g))?)/i);
    if (estoqueMatch) {
      estoqueLoja = estoqueMatch[0];
    }

    // Find numeric quantity for expiring items
    // Tokens that are numbers and not the code, not the dig, not the date, not the price
    const numTokens = line.items.filter((tok) => {
      const clean = tok.replace(/[^\d,\.]/g, '');
      if (!clean) return false;
      if (tok.includes(codigo)) return false;
      if (digito && tok === digito) return false;
      if (tok.includes(dataVcto)) return false;
      if (preco && tok.includes(preco)) return false;
      const parsed = parseFloat(clean.replace(',', '.'));
      return !isNaN(parsed) && parsed > 0;
    });

    if (numTokens.length > 0) {
      // Pick the first clean quantity number
      const qVal = parseFloat(numTokens[0].replace(',', '.'));
      if (!isNaN(qVal)) {
        quantidade = qVal;
      }
    }

    // Extract description: remove code, dig, date, price, etc.
    let desc = text;
    if (codigo) desc = desc.replace(codigo, '');
    if (digito) desc = desc.replace(new RegExp(`\\b${digito}\\b`), '');
    if (dataVcto) desc = desc.replace(dataVcto, '');
    if (preco) desc = desc.replace(preco, '').replace(/[R$]/g, '');
    if (embalagem) desc = desc.replace(embalagem, '');
    if (estoqueLoja) desc = desc.replace(estoqueLoja, '');
    desc = desc.replace(/\s+/g, ' ').trim();

    resultRows.push([
      codigo,
      digito,
      desc || 'PRODUTO',
      embalagem,
      '', // comprador
      quantidade || 1,
      estoqueLoja,
      dataVcto,
      preco,
    ]);
  }

  return resultRows;
}
