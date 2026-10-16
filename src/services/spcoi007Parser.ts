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
 * Contempla a estrutura real com 8 colunas (Page1).
 */
export function gerarExemploPlanilhaSPCOI007(): void {
  const cabecalhos = [
    'Fornecedor',
    'Razão Social',
    'Divisão',
    'Código',
    'Descrição',
    'Sta.',
    'Embalagem',
    'Comprador',
  ];
  const linhasExemplo = [
    ['00.003.607/0001-25', 'COFRUTAGEM ARARAQUARA COM DE FRUTAS LTDA', 'FLV', '00002488-110', 'HF.LARANJA PERA', 'AT', 'CX', 'COMPRADOR 01'],
    ['00.000.000/0001-91', 'AMBEV S/A', 'BEBIDAS', '00011285-151', 'RF.CERV.BRAHMA CHOPP 350ML', 'AT', 'UN', 'COMPRADOR 02'],
    ['01.123.456/0001-88', 'DANONE LTDA', 'LATICINIOS', '00011285-151', 'RF.IOG.DANONE 5X ZERO MORANGO', 'AT', 'UN', 'COMPRADOR 02'],
    ['01.123.456/0001-88', 'DANONE LTDA', 'LATICINIOS', '00046135-156', 'RF.MARG.QUALY C/SAL 500G', 'AT', 'UN', 'COMPRADOR 02'],
    ['02.987.654/0001-22', 'NESTLE BRASIL LTDA', 'MERCEARIA', '00076916-185', 'CHOCOLATE NESTLE CLASSIC 90G', 'AT', 'UN', 'COMPRADOR 03'],
    ['03.555.444/0001-33', 'BRF S.A.', 'CARNES', '00088901-001', 'FRANGO INTEIRO CONGELADO SADIA', 'AT', 'KG', 'COMPRADOR 04'],
  ];

  const ws = XLSX.utils.aoa_to_sheet([cabecalhos, ...linhasExemplo]);
  ws['!cols'] = [
    { wch: 22 }, // Fornecedor
    { wch: 38 }, // Razão Social
    { wch: 12 }, // Divisão
    { wch: 18 }, // Código
    { wch: 38 }, // Descrição
    { wch: 8 },  // Sta.
    { wch: 12 }, // Embalagem
    { wch: 18 }, // Comprador
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Page1');
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

  for (let r = 0; r < Math.min(raw2D.length, 25); r++) {
    const row = raw2D[r];
    if (!Array.isArray(row)) continue;
    let score = 0;
    for (const cell of row) {
      const norm = normalizeHeader(cell);
      if (
        norm === 'FORNECEDOR' ||
        norm === 'CNPJ' ||
        norm === 'CNPJFORNECEDOR' ||
        norm === 'FORNECEDORCNPJ' ||
        norm.includes('CNPJ') ||
        norm.includes('CGC')
      ) {
        score += 3;
      }
      if (
        norm === 'RAZAOSOCIAL' ||
        norm === 'RAZAO' ||
        norm.includes('RAZAO') ||
        norm === 'DIVISAO' ||
        norm === 'COMPRADOR'
      ) {
        score += 2;
      }
      if (
        norm === 'CODIGO' ||
        norm === 'CODIGODOPRODUTO' ||
        norm === 'CODIGOINTERNO' ||
        norm === 'CODMERCADORIA' ||
        norm.startsWith('COD')
      ) {
        score += 2;
      }
      if (norm.includes('DESCRICAO') || norm.includes('DESC')) {
        score += 2;
      }
    }
    if (score >= 4) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx === -1) {
    headerRowIdx = 0; // Fallback para a primeira linha
  }

  const headers = raw2D[headerRowIdx].map((h, i) => String(h || '').trim() || `COL_${i + 1}`);
  const headerMap: Record<string, number> = {};

  headers.forEach((h, idx) => {
    const norm = normalizeHeader(h);

    // 1. CNPJ / Fornecedor (Obrigatório)
    // Cabeçalhos reconhecidos: Fornecedor, CNPJ, CNPJ Fornecedor, CGC, CPF/CNPJ, Doc Fornecedor
    if (
      norm === 'FORNECEDOR' ||
      norm === 'CNPJ' ||
      norm === 'CNPJFORNECEDOR' ||
      norm === 'FORNECEDORCNPJ' ||
      norm === 'CGC' ||
      norm === 'CPFCNPJ' ||
      norm === 'DOCFORNECEDOR' ||
      norm.includes('CNPJ') ||
      norm.includes('CGC')
    ) {
      if (headerMap['cnpj'] === undefined) headerMap['cnpj'] = idx;
    }
    // 2. Código do Produto (Obrigatório)
    // Cabeçalhos reconhecidos: Código, Codigo, Código do Produto, Código Interno, Cod. Mercadoria, Cod Produto, Item, Mercadoria
    else if (
      norm === 'CODIGO' ||
      norm === 'CODIGODOPRODUTO' ||
      norm === 'CODIGOINTERNO' ||
      norm === 'CODMERCADORIA' ||
      norm === 'CODPRODUTO' ||
      norm === 'COD' ||
      norm === 'ITEM' ||
      norm === 'MERCADORIA' ||
      norm.startsWith('COD')
    ) {
      if (headerMap['codigo'] === undefined) headerMap['codigo'] = idx;
    }
    // 3. Razão Social (Razão Social, Razao, Nome Fornecedor, Nome Razao, Empresa, Nome Fantasia)
    // ATENÇÃO: 'FORNECEDOR' isolado é o CNPJ, portanto não deve ser associado à Razão Social
    else if (
      norm === 'RAZAOSOCIAL' ||
      norm === 'RAZAO' ||
      norm === 'NOMEFORNECEDOR' ||
      norm === 'NOMERAZAO' ||
      norm === 'EMPRESA' ||
      norm === 'NOMEFANTASIA' ||
      norm.includes('RAZAO')
    ) {
      if (headerMap['razao_social'] === undefined) headerMap['razao_social'] = idx;
    }
    // 4. Descrição (Descrição, Descricao, Descrição do Produto, Desc, Produto)
    else if (
      norm === 'DESCRICAO' ||
      norm === 'DESCRICAODOPRODUTO' ||
      norm === 'DESCRICAOMERCADORIA' ||
      norm === 'DESC' ||
      norm === 'PRODUTO' ||
      norm.includes('DESCRICAO')
    ) {
      if (headerMap['descricao'] === undefined) headerMap['descricao'] = idx;
    }
    // 5. Divisão
    else if (norm === 'DIVISAO' || norm === 'DIV') {
      if (headerMap['divisao'] === undefined) headerMap['divisao'] = idx;
    }
    // 6. Sta. (Status)
    else if (norm === 'STA' || norm === 'STATUS' || norm === 'SITUACAO') {
      if (headerMap['status_sta'] === undefined) headerMap['status_sta'] = idx;
    }
    // 7. Embalagem
    else if (norm === 'EMBALAGEM' || norm === 'EMB') {
      if (headerMap['embalagem'] === undefined) headerMap['embalagem'] = idx;
    }
    // 8. Comprador
    else if (norm === 'COMPRADOR') {
      if (headerMap['comprador'] === undefined) headerMap['comprador'] = idx;
    }
  });

  // Validação estrita das colunas obrigatórias
  if (headerMap['cnpj'] === undefined || headerMap['codigo'] === undefined) {
    throw new Error(
      'Estrutura incompatível! Não foi possível identificar as colunas obrigatórias de CNPJ e Código do Produto na SPCOI007.'
    );
  }

  // Lista amigável de colunas identificadas
  const colunasIdentificadas: string[] = [];
  if (headerMap['cnpj'] !== undefined) colunasIdentificadas.push(`CNPJ / Fornecedor ("${headers[headerMap['cnpj']]}")`);
  if (headerMap['razao_social'] !== undefined) colunasIdentificadas.push(`Razão Social ("${headers[headerMap['razao_social']]}")`);
  if (headerMap['divisao'] !== undefined) colunasIdentificadas.push(`Divisão ("${headers[headerMap['divisao']]}")`);
  if (headerMap['codigo'] !== undefined) colunasIdentificadas.push(`Código ("${headers[headerMap['codigo']]}")`);
  if (headerMap['descricao'] !== undefined) colunasIdentificadas.push(`Descrição ("${headers[headerMap['descricao']]}")`);
  if (headerMap['status_sta'] !== undefined) colunasIdentificadas.push(`Sta. ("${headers[headerMap['status_sta']]}")`);
  if (headerMap['embalagem'] !== undefined) colunasIdentificadas.push(`Embalagem ("${headers[headerMap['embalagem']]}")`);
  if (headerMap['comprador'] !== undefined) colunasIdentificadas.push(`Comprador ("${headers[headerMap['comprador']]}")`);

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
  let totalValidos = 0;
  let totalInvalidos = 0;
  const detalhesInvalidos: Array<{ linha: number; motivo: string; dado?: string }> = [];
  const totalLinhas = raw2D.length - (headerRowIdx + 1);

  for (let r = headerRowIdx + 1; r < raw2D.length; r++) {
    const row = raw2D[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    const rawCnpj = headerMap['cnpj'] !== undefined ? row[headerMap['cnpj']] : '';
    const rawCodigo = headerMap['codigo'] !== undefined ? row[headerMap['codigo']] : '';
    const rawRazao = headerMap['razao_social'] !== undefined ? row[headerMap['razao_social']] : '';
    const rawDesc = headerMap['descricao'] !== undefined ? row[headerMap['descricao']] : '';
    const rawDivisao = headerMap['divisao'] !== undefined ? row[headerMap['divisao']] : '';
    const rawSta = headerMap['status_sta'] !== undefined ? row[headerMap['status_sta']] : '';
    const rawEmbalagem = headerMap['embalagem'] !== undefined ? row[headerMap['embalagem']] : '';
    const rawComprador = headerMap['comprador'] !== undefined ? row[headerMap['comprador']] : '';

    // Ignora linha completamente vazia
    if (
      (rawCnpj === undefined || rawCnpj === null || String(rawCnpj).trim() === '') &&
      (rawCodigo === undefined || rawCodigo === null || String(rawCodigo).trim() === '') &&
      (rawRazao === undefined || rawRazao === null || String(rawRazao).trim() === '')
    ) {
      continue;
    }

    totalLidos++;

    if (totalLidos % 200 === 0) {
      const pct = Math.min(90, Math.floor(35 + (totalLidos / Math.max(1, totalLinhas)) * 55));
      onProgress?.(pct, `Processando fornecedor ${totalLidos} de ${totalLinhas}...`);
      await new Promise((res) => setTimeout(res, 0));
    }

    const cnpjNorm = normalizarCnpj(rawCnpj);
    if (!cnpjNorm || cnpjNorm.length !== 14 || /^0{14}$/.test(cnpjNorm)) {
      totalInvalidos++;
      if (detalhesInvalidos.length < 50) {
        detalhesInvalidos.push({
          linha: r + 1,
          motivo: 'CNPJ inválido ou ausente',
          dado: String(rawCnpj || '').slice(0, 30),
        });
      }
      continue;
    }

    const parsedCode = parseSMGCode(rawCodigo);
    if (!parsedCode.is_valid || !parsedCode.codigo_interno) {
      totalInvalidos++;
      if (detalhesInvalidos.length < 50) {
        detalhesInvalidos.push({
          linha: r + 1,
          motivo: 'Código do produto inválido ou não reconhecido',
          dado: String(rawCodigo || '').slice(0, 30),
        });
      }
      continue;
    }

    totalValidos++;
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
      cnpj_original: String(rawCnpj ?? '').trim(),
      razao_social: razaoSocial,
      codigo_interno: codigoInterno,
      digito: parsedCode.digito,
      codigo_exibicao: parsedCode.codigo_exibicao,
      codigo_original: parsedCode.codigo_original,
      descricao_spcoi: descricaoSpcoi,
      divisao: rawDivisao ? String(rawDivisao).trim().toUpperCase() : undefined,
      status_sta: rawSta ? String(rawSta).trim().toUpperCase() : undefined,
      embalagem: rawEmbalagem ? String(rawEmbalagem).trim().toUpperCase() : undefined,
      comprador: rawComprador ? String(rawComprador).trim().toUpperCase() : undefined,
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
    total_validos: totalValidos,
    total_invalidos: totalInvalidos,
    total_encontrados_smg: totalEncontradosSmg,
    total_sem_correspondencia: produtosSemCorrespondencia.length,
    total_multiplos_cnpjs: produtosComMultiplosCnpjs.size,
    total_industrias: industriasMap.size,
    nome_arquivo: file.name,
    colunas_identificadas: colunasIdentificadas,
    detalhes_invalidos: detalhesInvalidos,
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
