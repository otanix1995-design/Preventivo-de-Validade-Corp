import * as XLSX from 'xlsx';
import { ProdutoSMG, ResumoImportacao, VinculoEan } from '../types';
import {
  calcularPosicaoEstoque,
  cleanEanCode,
  normalizeCodigoSMGO,
  parseCodigoInternoEan,
  parseEmbalagem,
  parseSMGCode
} from './codeParser';
import {
  addDivergencia,
  addResumoImportacao,
  getMetadados,
  getProdutos,
  getVinculosEan,
  reprocessarBases,
  saveMetadados,
  saveProdutos,
  saveVinculosEan
} from './storage';

export type ProgressCallback = (percent: number, statusText: string) => void;

/**
 * Normalizes column header text for flexible matching across Brazilian ERP exports.
 */
export function normalizeHeader(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Helper to safely parse numeric values from Excel cells (supports Brazilian formats "1.250,50" and standard "1250.50").
 */
export function parseNumberSafe(val: any, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'number') return isNaN(val) ? fallback : val;

  let str = String(val).trim();
  // Remove currency signs e.g. R$
  str = str.replace(/R\$\s*/gi, '').replace(/\s/g, '');

  if (str.includes(',') && str.includes('.')) {
    // Determine which is thousand separator
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? fallback : num;
}

/**
 * Helper to format date strings from Excel (supports serial numbers, ISO dates and DD/MM/YYYY).
 */
export function parseDateSafe(val: any): string | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'number') {
    try {
      const date = XLSX.SSF.parse_date_code(val);
      if (date) {
        const d = String(date.d).padStart(2, '0');
        const m = String(date.m).padStart(2, '0');
        const y = date.y;
        return `${d}/${m}/${y}`;
      }
    } catch {
      // ignore
    }
  }
  
  if (val instanceof Date) {
    const d = String(val.getDate()).padStart(2, '0');
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const y = val.getFullYear();
    return `${d}/${m}/${y}`;
  }

  const str = String(val).trim();
  return str || undefined;
}

/**
 * Scans a 2D array of rows to find the most probable header row index.
 */
function findHeaderRowIndex(rows: any[][], keywords: string[]): number {
  let bestIdx = 0;
  let maxScore = -1;

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length === 0) continue;

    let score = 0;
    for (const cell of row) {
      if (!cell) continue;
      const norm = normalizeHeader(cell);
      if (!norm) continue;

      for (const kw of keywords) {
        if (norm === kw || norm.includes(kw)) {
          score += 2;
        }
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestIdx = i;
    }
  }

  return maxScore > 0 ? bestIdx : 0;
}

/**
 * Converts a raw 2D array to an array of objects based on detected header row.
 */
function sheetRowsToObjects(rows: any[][], headerRowIdx: number): Record<string, any>[] {
  if (rows.length <= headerRowIdx) return [];

  const headers = rows[headerRowIdx].map((h, i) => {
    const str = h !== null && h !== undefined ? String(h).trim() : '';
    return str || `COL_${i + 1}`;
  });

  const objects: Record<string, any>[] = [];

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    // Check if the row has any non-empty cell
    const hasData = row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (!hasData) continue;

    const obj: Record<string, any> = {};
    headers.forEach((header, colIdx) => {
      obj[header] = row[colIdx] !== undefined ? row[colIdx] : '';
    });
    objects.push(obj);
  }

  return objects;
}

/**
 * Parses raw file buffer into workbook, with automatic CSV delimiter & encoding detection.
 */
async function parseWorkbookFromFile(file: File): Promise<XLSX.WorkBook> {
  const buffer = await file.arrayBuffer();

  // Try standard XLSX/XLS binary reading first
  try {
    const workbook = XLSX.read(buffer, {
      type: 'array',
      raw: false,
      cellText: true,
      cellDates: true,
    });
    if (workbook && workbook.SheetNames.length > 0) {
      return workbook;
    }
  } catch (err) {
    console.warn('Standard XLSX.read failed, attempting text/CSV fallback...', err);
  }

  // Fallback for CSV or encoded text files
  const decoderUtf8 = new TextDecoder('utf-8');
  let text = decoderUtf8.decode(buffer);

  // If replacement character found, try Windows-1252 (Latin1)
  if (text.includes('\uFFFD')) {
    try {
      const decoderLatin1 = new TextDecoder('iso-8859-1');
      text = decoderLatin1.decode(buffer);
    } catch {
      // keep utf-8
    }
  }

  return XLSX.read(text, { type: 'string', raw: false });
}

/**
 * Imports and updates SMGOI013 operational dataset with live 0-100% progress animation.
 */
export async function processarSMGOI013(
  file: File,
  onProgress?: ProgressCallback
): Promise<ResumoImportacao> {
  onProgress?.(5, 'Lendo arquivo da planilha...');
  await new Promise((r) => setTimeout(r, 100));

  const workbook = await parseWorkbookFromFile(file);

  onProgress?.(20, 'Localizando aba de dados...');
  await new Promise((r) => setTimeout(r, 80));

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Nenhuma planilha encontrada no arquivo.');
  }

  // Prioritize "Page1" if it exists, or sheet with most rows
  let bestSheetName = workbook.SheetNames[0];
  let maxRows = 0;
  let best2DRows: any[][] = [];

  const page1Sheet = workbook.Sheets['Page1'];
  if (page1Sheet) {
    const raw2D: any[][] = XLSX.utils.sheet_to_json(page1Sheet, { header: 1, defval: '' });
    if (raw2D.length > 0) {
      bestSheetName = 'Page1';
      maxRows = raw2D.length;
      best2DRows = raw2D;
    }
  }

  if (maxRows === 0) {
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;
      const raw2D: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (raw2D.length > maxRows) {
        maxRows = raw2D.length;
        bestSheetName = sheetName;
        best2DRows = raw2D;
      }
    }
  }

  if (best2DRows.length === 0) {
    throw new Error('A planilha selecionada está vazia ou sem linhas legíveis.');
  }

  onProgress?.(35, 'Identificando cabeçalhos e colunas da SMGOI013...');
  await new Promise((r) => setTimeout(r, 80));

  const smgKeywords = [
    'CODIGO', 'COD', 'MERCADORIA', 'DESCRICAO', 'DESC', 'EMBALAGEM', 'EMB',
    'ESTOQUE', 'SALDO', 'VENDAS', 'PRECO', 'ENTRADA', 'IDADE', 'COMPRADOR', 'SETOR'
  ];

  const headerRowIdx = findHeaderRowIndex(best2DRows, smgKeywords);
  const rawRows = sheetRowsToObjects(best2DRows, headerRowIdx);

  if (rawRows.length === 0) {
    throw new Error('Nenhum registro de produto encontrado abaixo da linha de cabeçalho.');
  }

  // Build header mapping
  const sample = rawRows[0];
  const headerMap: Record<string, string> = {};

  for (const key of Object.keys(sample)) {
    const norm = normalizeHeader(key);

    // Match Código
    if (
      /^(CODIGO|COD|CODMERCADORIA|MERCADORIA|CODIGOMERCADORIA|CODINTERNO|CODIGOINTERNO|ITEM|PLU|REFERENCIA|REF)$/.test(norm) ||
      norm.startsWith('CODIGO') ||
      norm.startsWith('CODMERC')
    ) {
      if (!headerMap['codigo']) headerMap['codigo'] = key;
    }
    // Match Descrição
    else if (
      /^(DESCRICAO|DESCRICAOMERCADORIA|DESC|PRODUTO|NOME|DESCRICAODOPRODUTO|ITEMDESC|DENOMINACAO)$/.test(norm) ||
      norm.includes('DESCRICAO') ||
      norm.includes('MERCADORIA')
    ) {
      if (!headerMap['descricao']) headerMap['descricao'] = key;
    }
    // Match Embalagem
    else if (/^(EMBALAGEM|EMB|TIPOEMB|UNIDADE|UNID|UN|APRESENTACAO)$/.test(norm) || norm.includes('EMBALAGEM')) {
      if (!headerMap['embalagem']) headerMap['embalagem'] = key;
    }
    // Match Estoque Emb1 (Loja / Disponível / Geral)
    else if (
      /^(ESTOQUEEMB1|ESTOQUE1|ESTOQUELOJA|ESTOQUEDISPONIVEL|SALDOLOJA|ESTOQUEAREAVENDA|ESTOQUEGONDOLA|ESTOQUEFISICO|SALDO)$/.test(norm) ||
      (norm.includes('ESTOQUE') && norm.includes('1')) ||
      (norm.includes('ESTOQUE') && norm.includes('LOJA'))
    ) {
      if (!headerMap['estoque_emb1']) headerMap['estoque_emb1'] = key;
    }
    // Match Estoque Emb9 (Depósito / Reserva)
    else if (
      /^(ESTOQUEEMB9|ESTOQUE9|ESTOQUEDEPOSITO|SALDODEPOSITO|ESTOQUERESERVA|ESTOQUEALMOXARIFADO)$/.test(norm) ||
      (norm.includes('ESTOQUE') && norm.includes('9')) ||
      (norm.includes('ESTOQUE') && norm.includes('DEP'))
    ) {
      if (!headerMap['estoque_emb9']) headerMap['estoque_emb9'] = key;
    }
    // Match Estoque Total (caso venha apenas uma coluna)
    else if (/^(ESTOQUETOTAL|SALDOTOTAL|SALDOATUAL|QTDTOTAL|TOTALESTOQUE|ESTOQUEGERAL|ESTOQUE)$/.test(norm)) {
      if (!headerMap['estoque_total_direto']) headerMap['estoque_total_direto'] = key;
    }
    // Match Vendas Qtde 30d
    else if (
      /^(VENDASQTDE|VENDAS30D|QTDEVENDAS|VENDA30DIAS|VENDAS|QTDEVENDIDA|SAIDA30D|CONSUMO30D|GIRO30D)$/.test(norm) ||
      norm.includes('VENDASQTDE') ||
      (norm.includes('VENDA') && norm.includes('30'))
    ) {
      if (!headerMap['vendas_qtde']) headerMap['vendas_qtde'] = key;
    }
    // Match Vendas Preço
    else if (/^(VENDASPRECO|PRECO|PRECOVENDA|VALOR|PRVENDA|VALORVENDA|PRUNITARIO)$/.test(norm) || norm.includes('PRECO')) {
      if (!headerMap['vendas_preco']) headerMap['vendas_preco'] = key;
    }
    // Match Data Última Entrada
    else if (
      /^(DATAULTIMAENTRADA|ULTIMAENTRADA|DTENTRADA|DTULTIMACOMPRA|DATAENTRADA|ULTIMACOMPRA)$/.test(norm) ||
      (norm.includes('DATA') && norm.includes('ENTRADA')) ||
      (norm.includes('ULTIMA') && norm.includes('ENTRADA'))
    ) {
      if (!headerMap['data_ultima_entrada']) headerMap['data_ultima_entrada'] = key;
    }
    // Match Qtde Última Entrada
    else if (
      /^(QUANTIDADEULTIMAENTRADA|QTDEULTIMAENTRADA|QTDEENTRADA|ULTIMACOMPRAQTDE|QTDULTIMAENTRADA)$/.test(norm) ||
      (norm.includes('QTDE') && norm.includes('ENTRADA')) ||
      (norm.includes('QTD') && norm.includes('ENTRADA'))
    ) {
      if (!headerMap['qtde_ultima_entrada']) headerMap['qtde_ultima_entrada'] = key;
    }
    // Match Dias sem Venda
    else if (/^(DIASSEMVENDA|DIASSVENDA|DIASSEMGIRO|DIASPARADO|DIASSGIRO)$/.test(norm) || norm.includes('DIASSEMVENDA') || norm.includes('SEMVENDA')) {
      if (!headerMap['dias_sem_venda']) headerMap['dias_sem_venda'] = key;
    }
    // Match Idade
    else if (/^(IDADE|IDADEMERCADORIA|IDADEESTOQUE|DIASESTOQUE)$/.test(norm) || norm.includes('IDADE')) {
      if (!headerMap['idade']) headerMap['idade'] = key;
    }
    // Match Qtde Ideal
    else if (/^(QUANTIDADEIDEAL|QTDEIDEAL|ESTOQUEIDEAL|QTDIDEAL|ESTOQUEMINIMO)$/.test(norm) || norm.includes('IDEAL')) {
      if (!headerMap['qtde_ideal']) headerMap['qtde_ideal'] = key;
    }
    // Match Comprador Filial
    else if (/^(COMPRADORFILIAL|COMPRADOR|COMPRFILIAL)$/.test(norm) || (norm.includes('COMPRADOR') && norm.includes('FILIAL'))) {
      if (!headerMap['comprador_filial']) headerMap['comprador_filial'] = key;
    }
    // Match Comprador Matriz
    else if (/^(COMPRADORMATRIZ|COMPRMATRIZ)$/.test(norm) || (norm.includes('COMPRADOR') && norm.includes('MATRIZ'))) {
      if (!headerMap['comprador_matriz']) headerMap['comprador_matriz'] = key;
    }
    // Match Setor Físico
    else if (/^(SETORFISICO|SETOR|SECAO|DEPARTAMENTO|CATEGORIA)$/.test(norm) || norm.includes('SETORFISICO')) {
      if (!headerMap['setor_fisico']) headerMap['setor_fisico'] = key;
    }
    // Match Setor Balanço
    else if (/^(SETORBALANCO|BALANCO|GRUPO)$/.test(norm) || norm.includes('SETORBALANCO')) {
      if (!headerMap['setor_balanco']) headerMap['setor_balanco'] = key;
    }
    // Match Pedidos Pendentes
    else if (/^(PEDIDOSPENDENTES|PEDIDOS|PEDIDOPENDENTE|EMPEDIDO|QTDEPEDIDA)$/.test(norm) || norm.includes('PEDIDO')) {
      if (!headerMap['pedidos_pendentes']) headerMap['pedidos_pendentes'] = key;
    }
  }

  // Fallbacks if not recognized
  if (!headerMap['codigo']) {
    const codKey = Object.keys(sample).find((k) => normalizeHeader(k).includes('COD'));
    if (codKey) headerMap['codigo'] = codKey;
    else {
      headerMap['codigo'] = Object.keys(sample)[0];
    }
  }

  if (!headerMap['descricao']) {
    const descKey = Object.keys(sample).find((k) => normalizeHeader(k).includes('DESC') || normalizeHeader(k).includes('MERC') || normalizeHeader(k).includes('PROD'));
    if (descKey) headerMap['descricao'] = descKey;
    else if (Object.keys(sample).length > 1) {
      headerMap['descricao'] = Object.keys(sample)[1];
    }
  }

  const existingProdutos = getProdutos();
  const existingMap = new Map<string, ProdutoSMG>();
  existingProdutos.forEach((p) => existingMap.set(p.codigo_interno, p));

  const existingVinculos = getVinculosEan();
  const eanMap = new Map<string, Set<string>>();
  existingVinculos.forEach((v) => {
    if (v.status_vinculo === 'VINCULADO') {
      if (!eanMap.has(v.codigo_interno)) eanMap.set(v.codigo_interno, new Set());
      eanMap.get(v.codigo_interno)!.add(v.ean);
    }
  });

  let total_lidos = 0;
  let total_atualizados = 0;
  let total_novos = 0;
  let total_erros = 0;
  let total_ignorados = 0;
  const errosDetalhes: string[] = [];

  const timestamp = new Date().toLocaleString('pt-BR');
  const updatedProdutos: ProdutoSMG[] = [];
  const processedKeys = new Set<string>();

  const totalRowsCount = rawRows.length;
  const chunkSize = Math.max(1, Math.floor(totalRowsCount / 20));

  for (let idx = 0; idx < totalRowsCount; idx++) {
    const row = rawRows[idx];
    total_lidos++;

    if (idx % chunkSize === 0 || idx === totalRowsCount - 1) {
      const progress = Math.min(90, Math.floor(40 + (idx / totalRowsCount) * 50));
      onProgress?.(progress, `Processando item ${idx + 1} de ${totalRowsCount}...`);
      // Yield to event loop for smooth UI animation
      await new Promise((r) => setTimeout(r, 0));
    }

    const rawCodigo = row[headerMap['codigo']];
    if (rawCodigo === null || rawCodigo === undefined || String(rawCodigo).trim() === '') {
      total_ignorados++;
      continue;
    }

    const parsedCode = parseSMGCode(rawCodigo);
    if (!parsedCode.is_valid || !parsedCode.codigo_interno) {
      total_erros++;
      const erroMsg = `Linha ${total_lidos}: Código inválido "${rawCodigo}"`;
      errosDetalhes.push(erroMsg);
      addDivergencia({
        tipo: 'CODIGO_INVALIDO',
        origem: 'SMGOI013',
        identificador: String(rawCodigo),
        descricao_problema: 'Formato do código não pôde ser interpretado.',
        detalhes: erroMsg,
      });
      continue;
    }

    const codigoInterno = parsedCode.codigo_interno;
    if (processedKeys.has(codigoInterno)) {
      total_ignorados++;
      continue;
    }
    processedKeys.add(codigoInterno);

    const rawDesc = headerMap['descricao'] ? String(row[headerMap['descricao']] || '').trim() : 'PRODUTO S/ DESCRICAO';
    const rawEmb = headerMap['embalagem'] ? String(row[headerMap['embalagem']] || '').trim() : 'UN';
    const embData = parseEmbalagem(rawEmb);

    let estEmb1 = headerMap['estoque_emb1'] ? parseNumberSafe(row[headerMap['estoque_emb1']]) : 0;
    let estEmb9 = headerMap['estoque_emb9'] ? parseNumberSafe(row[headerMap['estoque_emb9']]) : 0;
    
    // If only total stock column exists
    if (!headerMap['estoque_emb1'] && !headerMap['estoque_emb9'] && headerMap['estoque_total_direto']) {
      estEmb1 = parseNumberSafe(row[headerMap['estoque_total_direto']]);
      estEmb9 = 0;
    }

    const posEstoque = calcularPosicaoEstoque(estEmb1, estEmb9, rawEmb, embData.fator);
    const estTotal = posEstoque.estoqueTotal;
    const vendasQtde = headerMap['vendas_qtde'] ? parseNumberSafe(row[headerMap['vendas_qtde']]) : 0;
    const vendasPreco = headerMap['vendas_preco'] ? parseNumberSafe(row[headerMap['vendas_preco']]) : undefined;

    const dataEntrada = headerMap['data_ultima_entrada'] ? parseDateSafe(row[headerMap['data_ultima_entrada']]) : undefined;
    const qtdeEntrada = headerMap['qtde_ultima_entrada'] ? parseNumberSafe(row[headerMap['qtde_ultima_entrada']]) : undefined;
    const diasSemVenda = headerMap['dias_sem_venda'] ? Math.max(0, parseNumberSafe(row[headerMap['dias_sem_venda']])) : 0;
    const idade = headerMap['idade'] ? Math.max(0, parseNumberSafe(row[headerMap['idade']])) : 0;
    const qtdeIdeal = headerMap['qtde_ideal'] ? parseNumberSafe(row[headerMap['qtde_ideal']]) : undefined;

    const compradorFilial = headerMap['comprador_filial'] ? String(row[headerMap['comprador_filial']] || '').trim() : undefined;
    const compradorMatriz = headerMap['comprador_matriz'] ? String(row[headerMap['comprador_matriz']] || '').trim() : undefined;
    const setorFisico = headerMap['setor_fisico'] ? String(row[headerMap['setor_fisico']] || '').trim() : undefined;
    const setorBalanco = headerMap['setor_balanco'] ? String(row[headerMap['setor_balanco']] || '').trim() : undefined;
    const pedidosPendentes = headerMap['pedidos_pendentes'] ? String(row[headerMap['pedidos_pendentes']] || '').trim() : undefined;

    // Check for negative stock
    if (estEmb1 < 0 || estEmb9 < 0) {
      addDivergencia({
        tipo: 'ESTOQUE_NEGATIVO',
        origem: 'SMGOI013',
        identificador: parsedCode.codigo_exibicao,
        descricao_problema: `Estoque negativo detectado: Emb1=${estEmb1}, Emb9=${estEmb9}`,
        detalhes: rawDesc,
      });
    }

    // Preserve existing linked EANs
    const existingProd = existingMap.get(codigoInterno);
    const existingEans = existingProd?.eans || [];
    const vinculadosEans = eanMap.get(codigoInterno) ? Array.from(eanMap.get(codigoInterno)!) : [];
    const allEans = Array.from(new Set([...existingEans, ...vinculadosEans]));

    const produtoAtualizado: ProdutoSMG = {
      id: codigoInterno,
      codigo_original: parsedCode.codigo_original,
      codigo_interno: parsedCode.codigo_interno,
      digito: parsedCode.digito,
      codigo_exibicao: parsedCode.codigo_exibicao,
      chave_normalizada: parsedCode.chave_normalizada,
      descricao: rawDesc || 'MERCADORIA SEM DESCRICAO',
      embalagem: rawEmb,
      fator_embalagem: embData.fator,
      unidade_medida: embData.tipo,
      estoque_emb1: estEmb1,
      estoque_emb9: estEmb9,
      estoque_total: estTotal,
      vendas_qtde_30d: Math.max(0, vendasQtde),
      vendas_preco: vendasPreco,
      data_ultima_entrada: dataEntrada,
      qtde_ultima_entrada: qtdeEntrada,
      dias_sem_venda: diasSemVenda,
      idade,
      qtde_ideal: qtdeIdeal,
      comprador_filial: compradorFilial,
      comprador_matriz: compradorMatriz,
      setor_fisico: setorFisico,
      setor_balanco: setorBalanco,
      pedidos_pendentes: pedidosPendentes,
      eans: allEans,
      atualizado_em: timestamp,
      is_demo: false,
    };

    if (existingProd) {
      total_atualizados++;
    } else {
      total_novos++;
    }

    updatedProdutos.push(produtoAtualizado);
  }

  if (updatedProdutos.length === 0) {
    throw new Error('Falha na importação: Nenhum produto válido foi identificado na planilha SMGOI013.');
  }

  onProgress?.(93, 'Gravando banco de dados local com segurança...');
  await new Promise((r) => setTimeout(r, 100));

  await saveProdutos(updatedProdutos);

  const resumo: ResumoImportacao = {
    id: `imp-smg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    tipo: 'SMGOI013',
    data_hora: timestamp,
    total_lidos,
    total_atualizados,
    total_novos,
    total_erros,
    total_ignorados,
    nome_arquivo: file.name,
    detalhes_erros: errosDetalhes.slice(0, 10),
  };

  await addResumoImportacao(resumo);

  onProgress?.(100, 'Importação finalizada com sucesso!');
  await new Promise((r) => setTimeout(r, 200));

  return resumo;
}

/**
 * Accurately identifies header columns in the VÍNCULOS EAN spreadsheet.
 * Strictly separates EAN (CÓDIGO DE BARRAS / EAN) from CÓDIGO INTERNO.
 * NEVER allows a barcode column to be interpreted as Código Interno.
 */
export function identifyVinculosHeaders(
  sample: Record<string, any>,
  allRows?: Record<string, any>[]
): {
  eanKey: string;
  codigoInternoKey: string;
  digitoKey?: string;
  descricaoKey?: string;
} {
  const keys = Object.keys(sample);
  let eanKey: string | undefined;
  let codigoInternoKey: string | undefined;
  let digitoKey: string | undefined;
  let descricaoKey: string | undefined;

  // 1. Identify EAN Column first (keywords: EAN, BARRA, BARRAS, GTIN, BARCODE, CODBAR, DUN)
  for (const key of keys) {
    const norm = normalizeHeader(key);
    if (
      norm.includes('EAN') ||
      norm.includes('BARRA') ||
      norm.includes('BARRAS') ||
      norm.includes('GTIN') ||
      norm.includes('BARCODE') ||
      norm.includes('CODBAR') ||
      norm.includes('DUN')
    ) {
      eanKey = key;
      break;
    }
  }

  // 2. Identify Dígito Column explicitly (DIGITO, DIG, DV, DIGVERIF)
  for (const key of keys) {
    if (key === eanKey) continue;
    const norm = normalizeHeader(key);
    if (
      /^(DIGITO|DIG|DV|DIGITOVERIFICADOR|DIGITOCOMPLEMENTAR|DIGITOS|DIGMERC|DIGPROD|DVMERC)$/.test(norm) ||
      norm.startsWith('DIG') ||
      norm.includes('DIGITO') ||
      norm === 'DV'
    ) {
      digitoKey = key;
      break;
    }
  }

  // 3. Identify Código Interno Column:
  // Must NOT be the EAN key or Dígito key, and must NOT contain any barcode keywords!
  // Priority 3.1: Explicit mentions of INTERNO, SMG, CODMERC, CODPROD, CODITEM
  for (const key of keys) {
    if (key === eanKey || key === digitoKey) continue;
    const norm = normalizeHeader(key);
    if (norm.includes('EAN') || norm.includes('BARRA') || norm.includes('GTIN') || norm.includes('BARCODE') || norm.includes('CODBAR')) {
      continue;
    }
    if (
      norm.includes('INTERNO') ||
      norm.includes('SMG') ||
      norm.includes('CODMERC') ||
      norm.includes('CODPROD') ||
      norm.includes('CODITEM') ||
      norm === 'CODMERCADORIA' ||
      norm === 'CODIGOMERCADORIA'
    ) {
      codigoInternoKey = key;
      break;
    }
  }

  // Priority 3.2: General CODIGO / COD / MERCADORIA / ITEM / PLU / REFERENCIA
  if (!codigoInternoKey) {
    for (const key of keys) {
      if (key === eanKey || key === digitoKey) continue;
      const norm = normalizeHeader(key);
      if (norm.includes('EAN') || norm.includes('BARRA') || norm.includes('GTIN') || norm.includes('BARCODE') || norm.includes('CODBAR')) continue;
      if (norm.startsWith('DIG') || norm === 'DV') continue;
      // Skip pure description columns (unless prefixed with COD)
      if ((norm.startsWith('DESC') || norm === 'DESCRICAO' || norm === 'NOME' || norm === 'DENOMINACAO') && !norm.includes('COD')) continue;

      if (
        /^(CODIGO|COD|CODMERCADORIA|CODIGOMERCADORIA|CODPRODUTO|CODIGOPRODUTO|ITEM|PLU|REFERENCIA|REF|MERCADORIA)$/.test(norm) ||
        norm.startsWith('CODIGO') ||
        norm.startsWith('COD') ||
        norm.startsWith('CODMERC') ||
        norm.startsWith('CODPROD') ||
        norm.startsWith('ITEM') ||
        norm === 'MERCADORIA'
      ) {
        codigoInternoKey = key;
        break;
      }
    }
  }

  // 4. Identify Descrição Column
  for (const key of keys) {
    if (key === eanKey || key === codigoInternoKey || key === digitoKey) continue;
    const norm = normalizeHeader(key);
    if (
      /^(DESCRICAO|DESC|PRODUTO|NOME|DENOMINACAO|DESCRICAODOPRODUTO|DESCRICAOMERCADORIA|ITEMDESC|MERCADORIA)$/.test(norm) ||
      norm.includes('DESCRICAO') ||
      norm.includes('DESC') ||
      norm.includes('NOME') ||
      norm.includes('DENOM') ||
      norm.includes('PRODUTO')
    ) {
      descricaoKey = key;
      break;
    }
  }

  // 5. Data-driven Fallback Heuristics (if column names were unstandardized or missing)
  if ((!eanKey || !codigoInternoKey) && allRows && allRows.length > 0) {
    const rowsToInspect = allRows.slice(0, Math.min(10, allRows.length));

    for (const key of keys) {
      if (key === digitoKey) continue;
      const samples = rowsToInspect.map((r) => String(r[key] || '').trim()).filter(Boolean);
      if (samples.length === 0) continue;

      // Check if values look like EANs (8 to 14 digits)
      const eanLikeCount = samples.filter((s) => {
        const clean = s.replace(/\D/g, '');
        return clean.length >= 8 && clean.length <= 14;
      }).length;

      if (!eanKey && eanLikeCount >= Math.ceil(samples.length * 0.6)) {
        eanKey = key;
        continue;
      }

      // Check if values look like Código Interno (1 to 9 digits, possible hyphen)
      const codeLikeCount = samples.filter((s) => {
        const clean = s.split('-')[0].replace(/\D/g, '');
        return clean.length >= 1 && clean.length <= 9;
      }).length;

      if (!codigoInternoKey && key !== eanKey && codeLikeCount >= Math.ceil(samples.length * 0.6)) {
        codigoInternoKey = key;
      }
    }
  }

  // Final fallback assignments if still missing
  if (!eanKey && keys.length >= 2) {
    // If first column is code, second is likely EAN
    eanKey = keys.find((k) => k !== codigoInternoKey) || keys[1];
  }

  if (!codigoInternoKey && keys.length >= 1) {
    codigoInternoKey = keys.find((k) => k !== eanKey) || keys[0];
  }

  return { eanKey: eanKey || keys[0], codigoInternoKey: codigoInternoKey || keys[0], digitoKey, descricaoKey };
}

/**
 * Imports and updates VÍNCULOS EAN spreadsheet with live 0-100% progress animation.
 * Re-processes vínculos and associates EANs exclusively via Código Interno with SMGOI013 products.
 */
export async function processarVinculosEAN(
  file: File,
  onProgress?: ProgressCallback
): Promise<ResumoImportacao> {
  onProgress?.(5, 'Lendo arquivo de Vínculos EAN...');
  await new Promise((r) => setTimeout(r, 100));

  const workbook = await parseWorkbookFromFile(file);

  onProgress?.(20, 'Localizando tabela de vínculos...');
  await new Promise((r) => setTimeout(r, 80));

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Nenhuma planilha encontrada no arquivo.');
  }

  let bestSheetName = workbook.SheetNames[0];
  let maxRows = 0;
  let best2DRows: any[][] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const raw2D: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (raw2D.length > maxRows) {
      maxRows = raw2D.length;
      bestSheetName = sheetName;
      best2DRows = raw2D;
    }
  }

  if (best2DRows.length === 0) {
    throw new Error('A planilha selecionada está vazia.');
  }

  onProgress?.(35, 'Identificando colunas de EAN e Código Interno...');
  await new Promise((r) => setTimeout(r, 80));

  const eanKeywords = ['CODIGO', 'INTERNO', 'DIGITO', 'EAN', 'BARRAS', 'GTIN', 'BARCODE', 'PRODUTO', 'DESCRICAO'];
  const headerRowIdx = findHeaderRowIndex(best2DRows, eanKeywords);
  const rawRows = sheetRowsToObjects(best2DRows, headerRowIdx);

  if (rawRows.length === 0) {
    throw new Error('Nenhum registro de vínculo encontrado abaixo do cabeçalho.');
  }

  const sample = rawRows[0];
  const { eanKey, codigoInternoKey, digitoKey, descricaoKey } = identifyVinculosHeaders(sample, rawRows);

  // Load existing SMGOI013 products as the authoritative source
  const produtos = getProdutos();
  const produtosPorCodigoInterno = new Map<string, ProdutoSMG>();
  const produtosPorChaveCompleta = new Map<string, ProdutoSMG>();
  const produtosPorCodigoOriginal = new Map<string, ProdutoSMG>();
  const produtosPorCodigoExibicao = new Map<string, ProdutoSMG>();
  
  // Clean products' EAN array so that reimporting vínculos repopulates them accurately
  produtos.forEach((p) => {
    p.eans = [];
    const norm = normalizeCodigoSMGO(p.codigo_original || p.codigo_exibicao || p.codigo_interno, p.digito);
    p.codigo_original = p.codigo_original || norm.codigoOriginal;
    p.codigo_interno = norm.codigoInterno;
    p.digito = norm.digito;
    p.codigo_exibicao = norm.codigoExibicao;
    p.chave_normalizada = norm.chaveNormalizada;

    produtosPorCodigoInterno.set(norm.codigoInterno, p);
    if (norm.chaveNormalizada) {
      produtosPorChaveCompleta.set(norm.chaveNormalizada, p);
    }
    if (p.codigo_original) {
      produtosPorCodigoOriginal.set(p.codigo_original.trim(), p);
    }
    if (norm.codigoExibicao) {
      produtosPorCodigoExibicao.set(norm.codigoExibicao, p);
    }
  });

  const vinculosSalvos: VinculoEan[] = [];
  const eanVistos = new Set<string>();

  let total_lidos = 0;
  let total_atualizados = 0;
  let total_novos = 0;
  let total_erros = 0;
  let total_ignorados = 0;
  const errosDetalhes: string[] = [];
  const timestamp = new Date().toISOString();
  const timestampDisplay = new Date().toLocaleString('pt-BR');

  const totalRowsCount = rawRows.length;
  const chunkSize = Math.max(1, Math.floor(totalRowsCount / 25));

  for (let idx = 0; idx < totalRowsCount; idx++) {
    const row = rawRows[idx];
    total_lidos++;

    if (idx % chunkSize === 0 || idx === totalRowsCount - 1) {
      const progress = Math.min(92, Math.floor(35 + (idx / totalRowsCount) * 55));
      onProgress?.(progress, `Cruzando vínculo ${idx + 1} de ${totalRowsCount}...`);
      await new Promise((r) => setTimeout(r, 0));
    }

    const rawCodigo = row[codigoInternoKey];
    const rawEan = row[eanKey];
    const rawDigito = digitoKey ? row[digitoKey] : undefined;
    const rawDesc = descricaoKey ? row[descricaoKey] : undefined;

    if (rawCodigo === null || rawCodigo === undefined || String(rawCodigo).trim() === '' ||
        rawEan === null || rawEan === undefined || String(rawEan).trim() === '') {
      total_ignorados++;
      continue;
    }

    const normVinc = normalizeCodigoSMGO(rawCodigo, rawDigito);
    const codigoInterno = normVinc.codigoInterno;
    const ean = cleanEanCode(rawEan);

    if (!normVinc.isValid || !codigoInterno) {
      total_erros++;
      const msg = `Linha ${total_lidos}: Código Interno inválido "${rawCodigo}"`;
      errosDetalhes.push(msg);
      addDivergencia({
        tipo: 'CODIGO_INVALIDO',
        origem: 'VINCULOS_EAN',
        identificador: `Código ${rawCodigo}`,
        descricao_problema: `Código Interno inválido na planilha: "${rawCodigo}"`,
        detalhes: msg,
      });
      continue;
    }

    if (!ean || ean.length < 5) {
      total_erros++;
      const msg = `Linha ${total_lidos}: EAN inválido "${rawEan}"`;
      errosDetalhes.push(msg);
      addDivergencia({
        tipo: 'CODIGO_INVALIDO',
        origem: 'VINCULOS_EAN',
        identificador: `Código ${codigoInterno}`,
        descricao_problema: `EAN inválido na planilha: "${rawEan}"`,
        detalhes: msg,
      });
      continue;
    }

    // Regra de Vinculação:
    // Chave principal: Código Interno.
    // Dígito: validação adicional quando disponível.
    let produto: ProdutoSMG | undefined;
    if (normVinc.chaveNormalizada && produtosPorChaveCompleta.has(normVinc.chaveNormalizada)) {
      produto = produtosPorChaveCompleta.get(normVinc.chaveNormalizada);
    } else if (codigoInterno && produtosPorCodigoInterno.has(codigoInterno)) {
      produto = produtosPorCodigoInterno.get(codigoInterno);
    } else if (rawCodigo && produtosPorCodigoOriginal.has(String(rawCodigo).trim())) {
      produto = produtosPorCodigoOriginal.get(String(rawCodigo).trim());
    } else if (normVinc.codigoExibicao && produtosPorCodigoExibicao.has(normVinc.codigoExibicao)) {
      produto = produtosPorCodigoExibicao.get(normVinc.codigoExibicao);
    } else if (codigoInterno) {
      produto = produtos.find((p) => p.codigo_interno === codigoInterno);
    }

    let digito = normVinc.digito;
    let status_vinculo: VinculoEan['status_vinculo'] = 'VINCULADO';

    if (eanVistos.has(ean)) {
      status_vinculo = 'DUPLICADO';
      addDivergencia({
        tipo: 'EAN_DUPLICADO',
        origem: 'VINCULOS_EAN',
        identificador: `EAN ${ean}`,
        descricao_problema: `EAN ${ean} repetido na planilha de vínculos (Código Interno ${codigoInterno}).`,
      });
    }
    eanVistos.add(ean);

    if (produtos.length === 0) {
      // Base SMGOI013 not loaded yet: wait for base
      status_vinculo = 'AGUARDANDO_BASE';
    } else if (!produto) {
      status_vinculo = 'CODIGO_NAO_ENCONTRADO';
      addDivergencia({
        tipo: 'CODIGO_NAO_ENCONTRADO',
        origem: 'VINCULOS_EAN',
        identificador: `Código Interno ${codigoInterno}${digito ? '-' + digito : ''} (EAN: ${ean})`,
        descricao_problema: `Código Interno ${codigoInterno} não foi localizado no cadastro da SMGOI013.`,
        detalhes: rawDesc ? `Descrição informada na planilha: ${String(rawDesc).trim()}` : undefined,
      });
    } else {
      // Product found in SMGOI013!
      if (!digito && produto.digito) {
        digito = produto.digito;
      }
      if (!produto.eans.includes(ean)) {
        produto.eans.push(ean);
        total_novos++;
      } else {
        total_atualizados++;
      }
    }

    vinculosSalvos.push({
      id: `vinc-${Date.now()}-${vinculosSalvos.length}`,
      codigo_interno: codigoInterno,
      digito: digito || '',
      ean,
      descricao: (rawDesc && String(rawDesc).trim()) || produto?.descricao || '',
      status_vinculo,
      criado_em: timestamp,
    });
  }

  onProgress?.(95, 'Finalizando vínculos e atualizando catálogo de produtos...');
  await new Promise((r) => setTimeout(r, 100));

  await saveVinculosEan(vinculosSalvos);

  const resumo: ResumoImportacao = {
    id: `imp-ean-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    tipo: 'VINCULOS_EAN',
    data_hora: timestampDisplay,
    total_lidos,
    total_atualizados,
    total_novos,
    total_erros,
    total_ignorados,
    nome_arquivo: file.name,
    detalhes_erros: errosDetalhes.slice(0, 10),
  };

  await addResumoImportacao(resumo);

  onProgress?.(100, 'Vínculos EAN importados com sucesso!');
  await new Promise((r) => setTimeout(r, 200));

  return resumo;
}
