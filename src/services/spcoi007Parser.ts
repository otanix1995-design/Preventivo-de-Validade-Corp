import * as XLSX from 'xlsx';
import { FornecedorSPCOI007, Industria, ProdutoSMG, ResumoImportacaoSPCOI007 } from '../types';
import { parseSMGCode } from './codeParser';
import { normalizeHeader } from './excelParser';

export type SpcoiProgressCallback = (percent: number, statusText: string) => void;

/**
 * Normaliza um CNPJ garantindo exatamente 14 dígitos numéricos com zeros à esquerda preservados.
 */
export function normalizarCnpj(valor: any): string {
  if (valor === null || valor === undefined) return '';
  let str = String(valor).trim();
  // Remove formatação existente e caracteres não numéricos
  str = str.replace(/\D/g, '');
  if (!str) return '';
  // Se possuir menos de 14 dígitos, preenche com zeros à esquerda
  if (str.length < 14) {
    str = str.padStart(14, '0');
  }
  return str.slice(0, 14);
}

/**
 * Formata um CNPJ normalizado de 14 dígitos para a máscara padrão: XX.XXX.XXX/XXXX-XX
 */
export function formatarCnpj(cnpj: string): string {
  const norm = normalizarCnpj(cnpj);
  if (norm.length !== 14) return cnpj || '';
  return norm.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Gera um arquivo modelo .XLSX da planilha SPCOI007 para testes ou conferência operacional.
 */
export function gerarExemploPlanilhaSPCOI007(): void {
  const cabecalhos = ['CNPJ', 'RAZÃO SOCIAL', 'CÓDIGO', 'DESCRIÇÃO'];
  const linhasExemplo = [
    ['00.000.000/0001-91', 'AMBEV S/A', '11285-151', 'RF.CERV.BRAHMA CHOPP 350ML'],
    ['01.123.456/0001-88', 'DANONE LTDA', '11285-151', 'RF.IOG.DANONE 5X ZERO MORANGO'],
    ['01.123.456/0001-88', 'DANONE LTDA', '46135-156', 'RF.MARG.QUALY C/SAL 500G'],
    ['02.987.654/0001-22', 'NESTLE BRASIL LTDA', '76916-185', 'CHOCOLATE NESTLE CLASSIC 90G'],
    ['03.555.444/0001-33', 'BRF S.A.', '88901-001', 'FRANGO INTEIRO CONGELADO SADIA'],
  ];

  const ws = XLSX.utils.aoa_to_sheet([cabecalhos, ...linhasExemplo]);
  ws['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 16 }, { wch: 38 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SPCOI007');
  XLSX.writeFile(wb, 'MODELO_SPCOI007_FORNECEDORES.xlsx');
}

export interface ResultadoParseSPCOI007 {
  fornecedores: FornecedorSPCOI007[];
  industrias: Industria[];
  resumo: ResumoImportacaoSPCOI007;
  produtosComMultiplosCnpjs: Map<string, string[]>; // codigo_interno -> [cnpjs]
  produtosSemCorrespondencia: FornecedorSPCOI007[];
}

/**
 * Processa a planilha SPCOI007 de forma segura e não destrutiva.
 */
export async function processarArquivoSPCOI007(
  file: File,
  produtosSMG: ProdutoSMG[],
  industriasExistentes: Industria[] = [],
  onProgress?: SpcoiProgressCallback
): Promise<ResultadoParseSPCOI007> {
  onProgress?.(5, 'Lendo arquivo SPCOI007...');
  await new Promise((r) => setTimeout(r, 60));

  const buffer = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, {
      type: 'array',
      raw: false,
      cellText: true,
      cellDates: true,
    });
  } catch (err: any) {
    throw new Error(`Erro ao ler arquivo da SPCOI007: ${err.message || 'Formato incompatível'}`);
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('A planilha SPCOI007 selecionada não possui abas de dados.');
  }

  onProgress?.(20, 'Localizando dados de fornecedores...');
  await new Promise((r) => setTimeout(r, 60));

  let sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  const raw2D: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (raw2D.length === 0) {
    throw new Error('A planilha SPCOI007 está vazia.');
  }

  onProgress?.(35, 'Identificando cabeçalhos da SPCOI007...');
  await new Promise((r) => setTimeout(r, 60));

  // Encontrar linha de cabeçalho
  let headerRowIdx = -1;
  const keywords = ['CNPJ', 'FORNECEDOR', 'RAZAO', 'CODIGO', 'DESCRICAO'];

  for (let r = 0; r < Math.min(raw2D.length, 25); r++) {
    const row = raw2D[r];
    if (!Array.isArray(row)) continue;
    let score = 0;
    for (const cell of row) {
      const norm = normalizeHeader(cell);
      if (norm.includes('CNPJ') || norm.includes('CGC')) score += 3;
      if (norm.includes('RAZAO') || norm.includes('FORNECEDOR')) score += 2;
      if (norm.includes('CODIGO') || norm.includes('COD')) score += 2;
      if (norm.includes('DESCRICAO') || norm.includes('DESC')) score += 2;
    }
    if (score >= 4) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx === -1) {
    headerRowIdx = 0; // Fallback
  }

  const headers = raw2D[headerRowIdx].map((h, i) => String(h || '').trim() || `COL_${i + 1}`);
  const headerMap: Record<string, number> = {};

  headers.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    if (/^(CNPJ|CGC|CPFCNPJ|CNPJFORNECEDOR|DOCFORNECEDOR)$/.test(norm) || norm.includes('CNPJ') || norm.includes('CGC')) {
      if (headerMap['cnpj'] === undefined) headerMap['cnpj'] = idx;
    } else if (
      /^(RAZAOSOCIAL|RAZAO|FORNECEDOR|NOMEFORNECEDOR|NOMERAZAO|EMPRESA)$/.test(norm) ||
      norm.includes('RAZAO') ||
      norm.includes('FORNECEDOR')
    ) {
      if (headerMap['razao_social'] === undefined) headerMap['razao_social'] = idx;
    } else if (
      /^(CODIGO|COD|CODMERCADORIA|CODPRODUTO|ITEM|CODINTERNO|MERCADORIA)$/.test(norm) ||
      norm.startsWith('COD')
    ) {
      if (headerMap['codigo'] === undefined) headerMap['codigo'] = idx;
    } else if (
      /^(DESCRICAO|DESC|PRODUTO|NOMEMERCADORIA|DESCRICAOPRODUTO)$/.test(norm) ||
      norm.includes('DESCRICAO') ||
      norm.includes('MERCADORIA')
    ) {
      if (headerMap['descricao'] === undefined) headerMap['descricao'] = idx;
    }
  });

  if (headerMap['cnpj'] === undefined || headerMap['codigo'] === undefined) {
    throw new Error(
      'Estrutura incompatível: Não foi possível identificar as colunas obrigatórias de CNPJ e Código do Produto na SPCOI007.'
    );
  }

  // Mapa de produtos existentes na filial (SMGOI013)
  const produtosMap = new Map<string, ProdutoSMG>();
  produtosSMG.forEach((p) => {
    produtosMap.set(p.codigo_interno, p);
    if (p.codigo_exibicao) produtosMap.set(p.codigo_exibicao, p);
  });

  // Mapa de indústrias existentes para preservar nome comercial e status
  const industriasExistentesMap = new Map<string, Industria>();
  industriasExistentes.forEach((ind) => {
    industriasExistentesMap.set(ind.cnpj, ind);
  });

  const fornecedores: FornecedorSPCOI007[] = [];
  const industriasMap = new Map<string, Industria>();
  const produtosPorCodigoInterno = new Map<string, Set<string>>(); // codigo_interno -> Set de CNPJs
  const produtosSemCorrespondencia: FornecedorSPCOI007[] = [];
  const chavesProcessadas = new Set<string>();

  const dataHoraAtual = new Date().toLocaleString('pt-BR');
  const isoAtual = new Date().toISOString();

  let totalLidos = 0;
  const totalLinhas = raw2D.length - (headerRowIdx + 1);

  for (let r = headerRowIdx + 1; r < raw2D.length; r++) {
    const row = raw2D[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    const rawCnpj = row[headerMap['cnpj']];
    const rawCodigo = row[headerMap['codigo']];
    const rawRazao = headerMap['razao_social'] !== undefined ? row[headerMap['razao_social']] : '';
    const rawDesc = headerMap['descricao'] !== undefined ? row[headerMap['descricao']] : '';

    if (!rawCnpj && !rawCodigo) continue;
    totalLidos++;

    if (totalLidos % 200 === 0) {
      const pct = Math.min(90, Math.floor(35 + (totalLidos / Math.max(1, totalLinhas)) * 55));
      onProgress?.(pct, `Processando fornecedor ${totalLidos} de ${totalLinhas}...`);
      await new Promise((res) => setTimeout(res, 0));
    }

    const cnpjNorm = normalizarCnpj(rawCnpj);
    if (!cnpjNorm || cnpjNorm.length !== 14 || /^0{14}$/.test(cnpjNorm)) {
      continue; // Ignora CNPJ totalmente inválido ou vazio
    }

    const parsedCode = parseSMGCode(rawCodigo);
    if (!parsedCode.is_valid || !parsedCode.codigo_interno) {
      continue; // Código inválido
    }

    const codigoInterno = parsedCode.codigo_interno;
    const chaveUnica = `${cnpjNorm}_${codigoInterno}`;
    if (chavesProcessadas.has(chaveUnica)) continue;
    chavesProcessadas.add(chaveUnica);

    const razaoSocial = String(rawRazao || '').trim().toUpperCase() || 'RAZÃO SOCIAL NÃO INFORMADA';
    const descricaoSpcoi = String(rawDesc || '').trim().toUpperCase();

    const itemFornecedor: FornecedorSPCOI007 = {
      id: chaveUnica,
      cnpj: cnpjNorm,
      cnpj_formatado: formatarCnpj(cnpjNorm),
      razao_social: razaoSocial,
      codigo_interno: codigoInterno,
      digito: parsedCode.digito,
      codigo_exibicao: parsedCode.codigo_exibicao,
      descricao_spcoi: descricaoSpcoi,
      criado_em: dataHoraAtual,
    };

    fornecedores.push(itemFornecedor);

    // Mapear relacionamento de CNPJs por produto
    if (!produtosPorCodigoInterno.has(codigoInterno)) {
      produtosPorCodigoInterno.set(codigoInterno, new Set());
    }
    produtosPorCodigoInterno.get(codigoInterno)!.add(cnpjNorm);

    // Verificar correspondência na filial
    const existeNaFilial = produtosMap.has(codigoInterno);
    if (!existeNaFilial) {
      produtosSemCorrespondencia.push(itemFornecedor);
    }

    // Registrar ou atualizar Indústria
    if (!industriasMap.has(cnpjNorm)) {
      const existente = industriasExistentesMap.get(cnpjNorm);
      industriasMap.set(cnpjNorm, {
        cnpj: cnpjNorm,
        cnpj_formatado: formatarCnpj(cnpjNorm),
        razao_social: razaoSocial,
        nome_exibicao: existente?.nome_exibicao || razaoSocial,
        ativo: existente?.ativo !== undefined ? existente.ativo : true,
        total_produtos_loja: 0,
        promotores_responsaveis: existente?.promotores_responsaveis || [],
        criado_em: existente?.criado_em || isoAtual,
        atualizado_em: isoAtual,
      });
    }

    // Se o produto existe na loja, incrementa contador de produtos vinculados à indústria
    if (existeNaFilial) {
      const ind = industriasMap.get(cnpjNorm)!;
      ind.total_produtos_loja = (ind.total_produtos_loja || 0) + 1;
    }
  }

  // Identificar produtos com múltiplos CNPJs
  const produtosComMultiplosCnpjs = new Map<string, string[]>();
  produtosPorCodigoInterno.forEach((cnpjsSet, cod) => {
    if (cnpjsSet.size > 1) {
      produtosComMultiplosCnpjs.set(cod, Array.from(cnpjsSet));
    }
  });

  // Calcular métricas
  const totalEncontradosSmg = Array.from(produtosPorCodigoInterno.keys()).filter((cod) =>
    produtosMap.has(cod)
  ).length;

  const resumo: ResumoImportacaoSPCOI007 = {
    id: `spcoi-${Date.now()}`,
    data_hora: dataHoraAtual,
    total_lidos: totalLidos,
    total_encontrados_smg: totalEncontradosSmg,
    total_sem_correspondencia: produtosSemCorrespondencia.length,
    total_multiplos_cnpjs: produtosComMultiplosCnpjs.size,
    total_industrias: industriasMap.size,
    nome_arquivo: file.name,
  };

  onProgress?.(100, 'Importação da SPCOI007 concluída!');

  return {
    fornecedores,
    industrias: Array.from(industriasMap.values()),
    resumo,
    produtosComMultiplosCnpjs,
    produtosSemCorrespondencia,
  };
}
