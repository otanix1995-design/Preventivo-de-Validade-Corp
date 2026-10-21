import * as XLSX from 'xlsx';
import { ProdutoSMG, RegistroPlanilhaIsv, ResumoImportacaoIsv } from '../types';
import { normalizeCodigoSMGO } from './codeParser';

export type IsvPlanilhaProgressCallback = (percent: number, statusText: string) => void;

/**
 * Normaliza o cabeçalho para comparação flexível e tolerante a acentos, pontuação e espaços.
 */
export function normalizarCabecalhoIsv(cabecalho: any): string {
  if (cabecalho === null || cabecalho === undefined) return '';
  return String(cabecalho)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

export interface ResultadoParseValorDisponivel {
  valor: number | null;
  status: 'VALIDO' | 'ZERO' | 'AUSENTE' | 'INVALIDO';
  raw: any;
}

/**
 * REGRA FINANCEIRA OFICIAL — PARSER DE VALOR DISPONÍVEL / INDISPONÍVEL
 * 
 * Regras obrigatórias:
 * 1. Não multiplicar o Valor Disponível pelo estoque.
 * 2. Não dividir o Valor Disponível pelo fator da embalagem.
 * 3. Não recalcular o Valor Disponível utilizando Custo Médio.
 * 4. Preservar a precisão decimal do arquivo original.
 * 5. Diferenciar valor zero, valor ausente e valor inválido.
 * 6. Não transformar valores ausentes em zero silenciosamente.
 */
export function parseValorDisponivelOficial(val: any): ResultadoParseValorDisponivel {
  if (val === undefined || val === null) {
    return { valor: null, status: 'AUSENTE', raw: val };
  }

  // Se já for numérico (lido diretamente do XLSX)
  if (typeof val === 'number') {
    if (isNaN(val)) {
      return { valor: null, status: 'INVALIDO', raw: val };
    }
    if (val === 0) {
      return { valor: 0, status: 'ZERO', raw: val };
    }
    return { valor: val, status: 'VALIDO', raw: val };
  }

  const str = String(val).trim();
  if (
    str === '' ||
    str === '-' ||
    str.toUpperCase() === 'N/A' ||
    str.toUpperCase() === 'NULL' ||
    str.toUpperCase() === 'SEM VALOR' ||
    str.toUpperCase() === 'NÃO DISPONÍVEL' ||
    str.toUpperCase() === 'NAO DISPONIVEL'
  ) {
    return { valor: null, status: 'AUSENTE', raw: val };
  }

  // Remove moeda ("R$"), espaços e caracteres invisíveis
  const limpo = str.replace(/[R$\s]/g, '');

  let parsed: number;
  if (limpo.includes(',')) {
    // Padrão brasileiro: milhar com ponto, decimal com vírgula (ex: 10.533,29 ou 890,09)
    const semPontoMilhar = limpo.replace(/\./g, '');
    const comPontoDecimal = semPontoMilhar.replace(',', '.');
    parsed = parseFloat(comPontoDecimal);
  } else {
    // Padrão internacional (ex: 10533.29 ou 890.09)
    parsed = parseFloat(limpo);
  }

  if (isNaN(parsed)) {
    return { valor: null, status: 'INVALIDO', raw: val };
  }

  if (parsed === 0) {
    return { valor: 0, status: 'ZERO', raw: val };
  }

  return { valor: parsed, status: 'VALIDO', raw: val };
}

/**
 * Converte e formata o campo de estoque operacional para a apresentação unificada exigida:
 * - 10 CXA (240) + 10 → 10 CAIXAS + 10 UNIDADES
 * - 285 CXA (24) + 14 → 285 CAIXAS + 14 UNIDADES
 * - 249 BDJ (6) + 2 → 249 BANDEJAS + 2 UNIDADES
 * - 714 KG + 882 G → 714 KG + 882 G
 * - 242 UND → 242 UNIDADES
 */
export function formatarEstoqueOperacionalExtenso(raw: any): {
  textoExtenso: string;
  textoOriginal: string;
  quantidadeNumerica: number;
} {
  if (raw === undefined || raw === null || raw === '') {
    return {
      textoExtenso: '0 UNIDADES',
      textoOriginal: '-',
      quantidadeNumerica: 0,
    };
  }

  const str = String(raw).trim();
  const textoOriginal = str;

  // 1. Padrão Caixa com fator e resto (ex: 10 CXA (240) + 10 ou 285 CXA (24) + 14 ou 5 CX + 2)
  const matchCx = str.match(/^(\d+)\s*(?:CXA|CX|CAIXAS?)(?:\s*\(\s*(\d+)\s*\))?\s*\+\s*(\d+)(?:\s*(?:UN|UND|UNIDADES?))?/i);
  if (matchCx) {
    const cx = parseInt(matchCx[1], 10);
    const un = parseInt(matchCx[3], 10);
    const cxNome = cx === 1 ? '1 CAIXA' : `${cx} CAIXAS`;
    const unNome = un === 1 ? '1 UNIDADE' : `${un} UNIDADES`;
    const totalCalc = matchCx[2] ? parseInt(matchCx[2], 10) + un : cx * 24 + un;
    return {
      textoExtenso: `${cxNome} + ${unNome}`,
      textoOriginal,
      quantidadeNumerica: totalCalc,
    };
  }

  // 2. Padrão Bandeja (ex: 249 BDJ (6) + 2)
  const matchBdj = str.match(/^(\d+)\s*(?:BDJ|BANDEJAS?)(?:\s*\(\s*(\d+)\s*\))?\s*\+\s*(\d+)/i);
  if (matchBdj) {
    const bdj = parseInt(matchBdj[1], 10);
    const un = parseInt(matchBdj[3], 10);
    const bdjNome = bdj === 1 ? '1 BANDEJA' : `${bdj} BANDEJAS`;
    const unNome = un === 1 ? '1 UNIDADE' : `${un} UNIDADES`;
    return {
      textoExtenso: `${bdjNome} + ${unNome}`,
      textoOriginal,
      quantidadeNumerica: bdj * 6 + un,
    };
  }

  // 3. Padrão Fardo (ex: 5 FD (100) + 2)
  const matchFd = str.match(/^(\d+)\s*(?:FD|FARDOS?)(?:\s*\(\s*(\d+)\s*\))?\s*\+\s*(\d+)/i);
  if (matchFd) {
    const fd = parseInt(matchFd[1], 10);
    const un = parseInt(matchFd[3], 10);
    const fdNome = fd === 1 ? '1 FARDO' : `${fd} FARDOS`;
    const unNome = un === 1 ? '1 UNIDADE' : `${un} UNIDADES`;
    return {
      textoExtenso: `${fdNome} + ${unNome}`,
      textoOriginal,
      quantidadeNumerica: fd * 12 + un,
    };
  }

  // 4. Padrão Quilo e Gramas (ex: 714 KG + 882 G)
  const matchKgG = str.match(/^(\d+)\s*(?:KG|QUILOS?)\s*\+\s*(\d+)\s*(?:G|GRAMAS?)?/i);
  if (matchKgG) {
    const kg = parseInt(matchKgG[1], 10);
    const g = parseInt(matchKgG[2], 10);
    return {
      textoExtenso: `${kg} KG + ${g} G`,
      textoOriginal,
      quantidadeNumerica: Number(`${kg}.${g}`),
    };
  }

  // 5. Padrão Unidade avulsa explícita (ex: 242 UND ou 242 UN)
  const matchUnd = str.match(/^(\d+)\s*(?:UND|UN|UNIDADES?)$/i);
  if (matchUnd) {
    const un = parseInt(matchUnd[1], 10);
    const unNome = un === 1 ? '1 UNIDADE' : `${un} UNIDADES`;
    return {
      textoExtenso: unNome,
      textoOriginal,
      quantidadeNumerica: un,
    };
  }

  // 6. Número decimal (ex: 714.882 ou 714,882)
  if (/^\d+[.,]\d+$/.test(str.replace(/\s/g, ''))) {
    const num = parseFloat(str.replace(',', '.'));
    const kg = Math.floor(num);
    const g = Math.round((num - kg) * 1000);
    return {
      textoExtenso: `${kg} KG + ${g} G`,
      textoOriginal,
      quantidadeNumerica: num,
    };
  }

  // 7. Número inteiro puro (ex: 242)
  if (/^\d+$/.test(str.replace(/\s/g, ''))) {
    const num = parseInt(str, 10);
    const unNome = num === 1 ? '1 UNIDADE' : `${num} UNIDADES`;
    return {
      textoExtenso: unNome,
      textoOriginal,
      quantidadeNumerica: num,
    };
  }

  // Fallback geral
  return {
    textoExtenso: str.toUpperCase(),
    textoOriginal,
    quantidadeNumerica: parseFloat(str.replace(/[^\d.,]/g, '').replace(',', '.')) || 0,
  };
}

/**
 * Converte e combina componentes de data e horário para formato legível brasileiro.
 */
export function formatarDataHoraExcel(dataVal: any, horaVal?: any): string {
  if (dataVal === undefined || dataVal === null || dataVal === '') {
    return 'NÃO REGISTRADA';
  }

  let dataStr = '';
  if (typeof dataVal === 'number' && dataVal > 30000 && dataVal < 60000) {
    // Serial number do Excel
    const d = new Date(Math.round((dataVal - 25569) * 86400 * 1000));
    const dia = String(d.getUTCDate()).padStart(2, '0');
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    const ano = d.getUTCFullYear();
    dataStr = `${dia}/${mes}/${ano}`;
  } else if (dataVal instanceof Date) {
    const dia = String(dataVal.getDate()).padStart(2, '0');
    const mes = String(dataVal.getMonth() + 1).padStart(2, '0');
    const ano = dataVal.getFullYear();
    dataStr = `${dia}/${mes}/${ano}`;
  } else {
    const s = String(dataVal).trim();
    if (s.includes('/')) {
      dataStr = s.split(' ')[0];
    } else if (s.includes('-')) {
      const parts = s.split('T')[0].split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          dataStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
        } else {
          dataStr = `${parts[0]}/${parts[1]}/${parts[2]}`;
        }
      } else {
        dataStr = s;
      }
    } else {
      dataStr = s;
    }
  }

  let horaStr = '';
  if (horaVal !== undefined && horaVal !== null && horaVal !== '') {
    if (typeof horaVal === 'number' && horaVal >= 0 && horaVal < 1) {
      const totalSeconds = Math.round(horaVal * 86400);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      horaStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    } else {
      const hs = String(horaVal).trim();
      if (/^\d{1,2}:\d{2}/.test(hs)) {
        horaStr = hs.substring(0, 5);
      }
    }
  }

  if (dataStr && horaStr) {
    return `${dataStr} às ${horaStr}`;
  }
  return dataStr || 'NÃO REGISTRADA';
}

function parseNumeroInteiro(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val);
  const str = String(val).replace(/\D/g, '');
  if (!str) return 0;
  const parsed = parseInt(str, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Mapeamento completo das 36 colunas da nova planilha operacional oficial.
 */
export interface MapeamentoColunasIsv {
  colCodigo?: number; // A: Código
  colCodigoInterno?: number; // B: Código Interno (Dígito)
  colNome?: number; // C: Nome
  colComplemento?: number; // D: Complemento
  colValorDisponivel?: number; // E: Valor Disponível
  colEstoque?: number; // F: Estoque
  colValorIndisponivel?: number; // G: Valor Indisponível
  colBloqueio?: number; // H: Bloqueio
  colTransitoEntrada?: number; // I: Trânsito de Entrada
  colEstoqueIndisponivel?: number; // J: Estoque Indisponível
  colDiasSemVenda?: number; // K: Dias sem venda
  colUltimaVendaData?: number; // L: Última venda (Data)
  colUltimaVendaHora?: number; // M: Última venda (Hora)
  colUltimaCompraData?: number; // N: Última Compra (Data)
  colUltimaCompraHora?: number; // O: Última Compra (Hora)
  colClasseProduto?: number; // P: Classe de Produto
  colClasseProdutoRaiz?: number; // Q: Classe de Produto Raiz
  colIdade?: number; // R: Idade
  colPedidosPendentes?: number; // S: Pedidos Pendentes
  colQtdVenda30Dias?: number; // T: Quantidade de Venda 30 Dias
  colSetorSave?: number; // U: Setor Save
  colValidade1?: number; // V: Validade (1)
  colValidade2?: number; // W: Validade (2)
  colCadeia?: number; // X: Cadeia
  colSetor?: number; // Y: Setor
  colSetorHerdado?: number; // Z: Setor herdado
  colFornecedor?: number; // AA: Fornecedor
  colGerenciado?: number; // AB: Gerenciado
  colAtivo?: number; // AC: Ativo
  colResiduo?: number; // AD: Resíduo
  colPesoVariavel?: number; // AE: Peso Variável
  colAlteracaoPrecoData?: number; // AF: Alteração de Preço (Data)
  colAlteracaoPrecoHora?: number; // AG: Alteração de Preço (Hora)
  colVerificador?: number; // AH: Verificador
  colAutonomia?: number; // AI: Autonomia
  colAutonomiaPedido?: number; // AJ: Autonomia de Pedido
}

/**
 * Detecta automaticamente o cabeçalho e as 36 colunas da Planilha Operacional do ISV.
 */
export function detectarEstruturaPlanilhaIsv(raw2D: any[][]): {
  linhaCabecalho: number;
  colunas: MapeamentoColunasIsv;
} {
  const maxLinhas = Math.min(raw2D.length, 15);

  for (let r = 0; r < maxLinhas; r++) {
    const linha = raw2D[r];
    if (!Array.isArray(linha) || linha.length === 0) continue;

    const normCols = linha.map(normalizarCabecalhoIsv);

    // Verificação de não confusão com outras planilhas
    const isSpcoi = normCols.some((c) => c.includes('FORNECEDOR') && c.includes('RAZAOSOCIAL'));
    const isSaeou = normCols.some((c) => c.includes('DTVENCIMENTO') || c.includes('DIASPRAVENCER'));
    const isSmgoi = normCols.some((c) => c.includes('ESTOQUE1') && c.includes('ESTOQUE9'));

    if (isSpcoi || isSaeou || isSmgoi) {
      continue;
    }

    const colunas: MapeamentoColunasIsv = {};

    let countUltimaVenda = 0;
    let countUltimaCompra = 0;
    let countValidade = 0;
    let countAlteracaoPreco = 0;

    linha.forEach((cellVal, colIdx) => {
      const n = normalizarCabecalhoIsv(cellVal);
      if (!n) return;

      // COLUNA A: Código (raiz)
      if (
        (n === 'CODIGO' || n === 'COD' || n === 'CODPROD' || n === 'CODIGOPROD') &&
        colunas.colCodigo === undefined
      ) {
        colunas.colCodigo = colIdx;
      }
      // COLUNA B: Código Interno (dígito na planilha nova)
      else if (
        (n === 'CODIGOINTERNO' || n === 'CODINTERNO' || n === 'CODINT' || n === 'DIGITO' || n === 'DIG') &&
        colunas.colCodigoInterno === undefined
      ) {
        colunas.colCodigoInterno = colIdx;
      }
      // COLUNA C: Nome / Descrição
      else if (
        (n === 'NOME' || n === 'DESCRICAO' || n === 'DESCRICAOPRODUTO' || n === 'NOMEDOPRODUTO' || n === 'PRODUTO') &&
        colunas.colNome === undefined
      ) {
        colunas.colNome = colIdx;
      }
      // COLUNA D: Complemento
      else if (
        (n === 'COMPLEMENTO' || n === 'COMPL' || n === 'EMBALAGEM' || n === 'EMB' || n === 'DETALHE') &&
        colunas.colComplemento === undefined
      ) {
        colunas.colComplemento = colIdx;
      }
      // COLUNA E: Valor Disponível
      else if (
        (n === 'VALORDISPONIVEL' || n === 'VLRDISPONIVEL' || n === 'VALORDISP' || n === 'VLRDISP' || n === 'VALORESTOQUE') &&
        colunas.colValorDisponivel === undefined
      ) {
        colunas.colValorDisponivel = colIdx;
      }
      // COLUNA F: Estoque
      else if (
        (n === 'ESTOQUE' || n === 'QTDEESTOQUE' || n === 'QTESTOQUE' || n === 'SALDOESTOQUE' || n === 'ESTOQUEDISPONIVEL' || n === 'SALDO') &&
        colunas.colEstoque === undefined
      ) {
        colunas.colEstoque = colIdx;
      }
      // COLUNA G: Valor Indisponível
      else if (
        (n === 'VALORINDISPONIVEL' || n === 'VLRINDISPONIVEL' || n === 'VALORINDISP' || n === 'VLRINDISP') &&
        colunas.colValorIndisponivel === undefined
      ) {
        colunas.colValorIndisponivel = colIdx;
      }
      // COLUNA H: Bloqueio
      else if (n === 'BLOQUEIO' && colunas.colBloqueio === undefined) {
        colunas.colBloqueio = colIdx;
      }
      // COLUNA I: Trânsito de Entrada
      else if (
        (n === 'TRANSITODEENTRADA' || n === 'TRANSITOENTRADA' || n === 'TRANSITO' || n === 'EMTRANSITO') &&
        colunas.colTransitoEntrada === undefined
      ) {
        colunas.colTransitoEntrada = colIdx;
      }
      // COLUNA J: Estoque Indisponível
      else if (
        (n === 'ESTOQUEINDISPONIVEL' || n === 'QTDEINDISPONIVEL' || n === 'ESTINDISPONIVEL') &&
        colunas.colEstoqueIndisponivel === undefined
      ) {
        colunas.colEstoqueIndisponivel = colIdx;
      }
      // COLUNA K: Dias sem venda
      else if (
        (n === 'DIASSEMVENDA' || n === 'DIASSVENDA' || n === 'DIASSEMGIRO' || n === 'DIASSGIRO' || n.includes('SEMVENDA')) &&
        colunas.colDiasSemVenda === undefined
      ) {
        colunas.colDiasSemVenda = colIdx;
      }
      // COLUNAS L / M: Última venda (duplicada: 1ª data, 2ª hora)
      else if (n === 'ULTIMAVENDA' || n === 'DTULTIMAVENDA' || n === 'DATAULTIMAVENDA') {
        countUltimaVenda++;
        if (countUltimaVenda === 1 && colunas.colUltimaVendaData === undefined) {
          colunas.colUltimaVendaData = colIdx;
        } else if (countUltimaVenda === 2 && colunas.colUltimaVendaHora === undefined) {
          colunas.colUltimaVendaHora = colIdx;
        }
      }
      // COLUNAS N / O: Última Compra (duplicada: 1ª data, 2ª hora)
      else if (n === 'ULTIMACOMPRA' || n === 'DTULTIMACOMPRA' || n === 'DATAULTIMACOMPRA') {
        countUltimaCompra++;
        if (countUltimaCompra === 1 && colunas.colUltimaCompraData === undefined) {
          colunas.colUltimaCompraData = colIdx;
        } else if (countUltimaCompra === 2 && colunas.colUltimaCompraHora === undefined) {
          colunas.colUltimaCompraHora = colIdx;
        }
      }
      // COLUNA P: Classe de Produto
      else if (
        (n === 'CLASSEDEPRODUTO' || n === 'CLASSEPRODUTO' || n === 'CLASSE') &&
        !n.includes('RAIZ') &&
        colunas.colClasseProduto === undefined
      ) {
        colunas.colClasseProduto = colIdx;
      }
      // COLUNA Q: Classe de Produto Raiz
      else if (
        (n === 'CLASSEDEPRODUTORAIZ' || n === 'CLASSEPRODUTORAIZ' || n === 'CLASSERAIZ') &&
        colunas.colClasseProdutoRaiz === undefined
      ) {
        colunas.colClasseProdutoRaiz = colIdx;
      }
      // COLUNA R: Idade
      else if (
        (n === 'IDADE' || n === 'IDADEDIAS' || n === 'IDADELOTE' || n === 'IDADECADASTRO') &&
        colunas.colIdade === undefined
      ) {
        colunas.colIdade = colIdx;
      }
      // COLUNA S: Pedidos Pendentes
      else if (
        (n === 'PEDIDOSPENDENTES' || n === 'PEDIDOPENDENTE' || n === 'PEDPENDENTES' || n === 'PEDPENDENTE') &&
        colunas.colPedidosPendentes === undefined
      ) {
        colunas.colPedidosPendentes = colIdx;
      }
      // COLUNA T: Quantidade de Venda 30 Dias
      else if (
        (n === 'QUANTIDADEDEVENDA30DIAS' || n === 'QTDEVENDA30DIAS' || n === 'VENDA30DIAS' || n === 'VENDAS30DIAS' || n === 'QTDVENDA30DIAS') &&
        colunas.colQtdVenda30Dias === undefined
      ) {
        colunas.colQtdVenda30Dias = colIdx;
      }
      // COLUNA U: Setor Save
      else if (
        (n === 'SETORSAVE' || n === 'SETSAVE' || n === 'SAVELOTE') &&
        colunas.colSetorSave === undefined
      ) {
        colunas.colSetorSave = colIdx;
      }
      // COLUNAS V / W: Validade (duplicada)
      else if (n === 'VALIDADE' || n === 'DTVENCIMENTO' || n === 'DATAVALIDADE') {
        countValidade++;
        if (countValidade === 1 && colunas.colValidade1 === undefined) {
          colunas.colValidade1 = colIdx;
        } else if (countValidade === 2 && colunas.colValidade2 === undefined) {
          colunas.colValidade2 = colIdx;
        }
      }
      // COLUNA X: Cadeia
      else if (n === 'CADEIA' && colunas.colCadeia === undefined) {
        colunas.colCadeia = colIdx;
      }
      // COLUNA Y: Setor
      else if (
        n === 'SETOR' &&
        colunas.colSetor === undefined
      ) {
        colunas.colSetor = colIdx;
      }
      // COLUNA Z: Setor herdado
      else if (
        (n === 'SETORHERDADO' || n === 'SETHERDADO') &&
        colunas.colSetorHerdado === undefined
      ) {
        colunas.colSetorHerdado = colIdx;
      }
      // COLUNA AA: Fornecedor
      else if (
        (n === 'FORNECEDOR' || n === 'FORN' || n === 'FORNEC') &&
        colunas.colFornecedor === undefined
      ) {
        colunas.colFornecedor = colIdx;
      }
      // COLUNA AB: Gerenciado
      else if (
        (n === 'GERENCIADO' || n === 'PRODUTOGERENCIADO') &&
        colunas.colGerenciado === undefined
      ) {
        colunas.colGerenciado = colIdx;
      }
      // COLUNA AC: Ativo
      else if (
        (n === 'ATIVO' || n === 'SITUACAOATIVO' || n === 'STA') &&
        colunas.colAtivo === undefined
      ) {
        colunas.colAtivo = colIdx;
      }
      // COLUNA AD: Resíduo
      else if (
        (n === 'RESIDUO' || n === 'RESIDUOS') &&
        colunas.colResiduo === undefined
      ) {
        colunas.colResiduo = colIdx;
      }
      // COLUNA AE: Peso Variável
      else if (
        (n === 'PESOVARIAVEL' || n === 'PESOVAR' || n === 'VARIAVEL') &&
        colunas.colPesoVariavel === undefined
      ) {
        colunas.colPesoVariavel = colIdx;
      }
      // COLUNAS AF / AG: Alteração de Preço (duplicada: 1ª data, 2ª hora)
      else if (
        n === 'ALTERACAODEPRECO' ||
        n === 'ALTERACAOPRECO' ||
        n === 'ALTPRECO' ||
        n === 'MUDANCAPRECO'
      ) {
        countAlteracaoPreco++;
        if (countAlteracaoPreco === 1 && colunas.colAlteracaoPrecoData === undefined) {
          colunas.colAlteracaoPrecoData = colIdx;
        } else if (countAlteracaoPreco === 2 && colunas.colAlteracaoPrecoHora === undefined) {
          colunas.colAlteracaoPrecoHora = colIdx;
        }
      }
      // COLUNA AH: Verificador
      else if (
        (n === 'VERIFICADOR' || n === 'DIGITOVERIFICADOR') &&
        colunas.colVerificador === undefined
      ) {
        colunas.colVerificador = colIdx;
      }
      // COLUNA AI: Autonomia
      else if (
        n === 'AUTONOMIA' &&
        colunas.colAutonomia === undefined
      ) {
        colunas.colAutonomia = colIdx;
      }
      // COLUNA AJ: Autonomia de Pedido
      else if (
        (n === 'AUTONOMIADEPEDIDO' || n === 'AUTONOMIAPEDIDO') &&
        colunas.colAutonomiaPedido === undefined
      ) {
        colunas.colAutonomiaPedido = colIdx;
      }
    });

    // Se o arquivo tiver pelo menos 36 colunas em ordem exata tradicional A..AJ
    if (linha.length >= 36) {
      if (colunas.colCodigo === undefined) colunas.colCodigo = 0;
      if (colunas.colCodigoInterno === undefined) colunas.colCodigoInterno = 1;
      if (colunas.colNome === undefined) colunas.colNome = 2;
      if (colunas.colComplemento === undefined) colunas.colComplemento = 3;
      if (colunas.colValorDisponivel === undefined) colunas.colValorDisponivel = 4;
      if (colunas.colEstoque === undefined) colunas.colEstoque = 5;
      if (colunas.colValorIndisponivel === undefined) colunas.colValorIndisponivel = 6;
      if (colunas.colBloqueio === undefined) colunas.colBloqueio = 7;
      if (colunas.colTransitoEntrada === undefined) colunas.colTransitoEntrada = 8;
      if (colunas.colEstoqueIndisponivel === undefined) colunas.colEstoqueIndisponivel = 9;
      if (colunas.colDiasSemVenda === undefined) colunas.colDiasSemVenda = 10;
      if (colunas.colUltimaVendaData === undefined) colunas.colUltimaVendaData = 11;
      if (colunas.colUltimaVendaHora === undefined) colunas.colUltimaVendaHora = 12;
      if (colunas.colUltimaCompraData === undefined) colunas.colUltimaCompraData = 13;
      if (colunas.colUltimaCompraHora === undefined) colunas.colUltimaCompraHora = 14;
      if (colunas.colClasseProduto === undefined) colunas.colClasseProduto = 15;
      if (colunas.colClasseProdutoRaiz === undefined) colunas.colClasseProdutoRaiz = 16;
      if (colunas.colIdade === undefined) colunas.colIdade = 17;
      if (colunas.colPedidosPendentes === undefined) colunas.colPedidosPendentes = 18;
      if (colunas.colQtdVenda30Dias === undefined) colunas.colQtdVenda30Dias = 19;
      if (colunas.colSetorSave === undefined) colunas.colSetorSave = 20;
      if (colunas.colValidade1 === undefined) colunas.colValidade1 = 21;
      if (colunas.colValidade2 === undefined) colunas.colValidade2 = 22;
      if (colunas.colCadeia === undefined) colunas.colCadeia = 23;
      if (colunas.colSetor === undefined) colunas.colSetor = 24;
      if (colunas.colSetorHerdado === undefined) colunas.colSetorHerdado = 25;
      if (colunas.colFornecedor === undefined) colunas.colFornecedor = 26;
      if (colunas.colGerenciado === undefined) colunas.colGerenciado = 27;
      if (colunas.colAtivo === undefined) colunas.colAtivo = 28;
      if (colunas.colResiduo === undefined) colunas.colResiduo = 29;
      if (colunas.colPesoVariavel === undefined) colunas.colPesoVariavel = 30;
      if (colunas.colAlteracaoPrecoData === undefined) colunas.colAlteracaoPrecoData = 31;
      if (colunas.colAlteracaoPrecoHora === undefined) colunas.colAlteracaoPrecoHora = 32;
      if (colunas.colVerificador === undefined) colunas.colVerificador = 33;
      if (colunas.colAutonomia === undefined) colunas.colAutonomia = 34;
      if (colunas.colAutonomiaPedido === undefined) colunas.colAutonomiaPedido = 35;
    }

    const temValorOuEstoque = colunas.colValorDisponivel !== undefined || colunas.colEstoque !== undefined;
    const temCodigo = colunas.colCodigo !== undefined || colunas.colCodigoInterno !== undefined;
    const temNome = colunas.colNome !== undefined;

    if (temValorOuEstoque && (temCodigo || temNome)) {
      return { linhaCabecalho: r, colunas };
    }
  }

  throw new Error(
    'Não foi possível identificar o cabeçalho da Planilha Operacional do ISV. ' +
    'Certifique-se de que o arquivo contém as colunas "Valor Disponível", "Estoque", "Código" ou "Código Interno", e "Nome".'
  );
}

export interface ResultadoParsePlanilhaIsv {
  registros: RegistroPlanilhaIsv[];
  resumo: ResumoImportacaoIsv;
}

/**
 * Processa a Planilha Operacional oficial de 36 colunas de forma controlada e não-destrutiva.
 */
export async function processarPlanilhaOperacionalIsv(
  file: File,
  produtosSMG: ProdutoSMG[] = [],
  fornecedoresSpcoi: any[] = [],
  onProgress?: IsvPlanilhaProgressCallback
): Promise<ResultadoParsePlanilhaIsv> {
  onProgress?.(5, 'Lendo arquivo da Planilha Operacional (36 colunas)...');
  await new Promise((r) => setTimeout(r, 40));

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
    throw new Error(`Erro ao ler arquivo da planilha operacional: ${err.message || 'Formato incompatível'}`);
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('A planilha selecionada não possui abas de dados.');
  }

  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  const raw2D: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (raw2D.length === 0) {
    throw new Error('A planilha selecionada está vazia.');
  }

  onProgress?.(20, 'Identificando cabeçalhos e estrutura de 36 colunas...');
  await new Promise((r) => setTimeout(r, 40));

  const { linhaCabecalho, colunas } = detectarEstruturaPlanilhaIsv(raw2D);

  // Validação explícita dos campos obrigatórios
  const faltantes: string[] = [];
  if (colunas.colValorDisponivel === undefined) faltantes.push('Valor Disponível');
  if (colunas.colEstoque === undefined) faltantes.push('Estoque');
  if (colunas.colCodigo === undefined && colunas.colCodigoInterno === undefined) {
    faltantes.push('Código / Código Interno');
  }
  if (colunas.colNome === undefined) faltantes.push('Nome / Descrição');

  if (faltantes.length > 0) {
    throw new Error(
      `A planilha selecionada não possui os seguintes campos obrigatórios: ${faltantes.join(', ')}. ` +
      'Verifique se esta é a Planilha Operacional oficial do ISV.'
    );
  }

  onProgress?.(35, 'Processando e mapeando todos os registros operacionais...');
  await new Promise((r) => setTimeout(r, 40));

  // Mapeamentos rápidos para enriquecimento não-destrutivo com SMGOI013 e SPCOI007
  const smgPorCodigo = new Map<string, ProdutoSMG>();
  produtosSMG.forEach((p) => {
    smgPorCodigo.set(p.codigo_interno, p);
    if (p.codigo_exibicao) smgPorCodigo.set(p.codigo_exibicao, p);
  });

  const cnpjsSpcoiPorCodigo = new Set<string>();
  fornecedoresSpcoi.forEach((f) => {
    if (f.codigo_interno) cnpjsSpcoiPorCodigo.add(f.codigo_interno);
  });

  const registros: RegistroPlanilhaIsv[] = [];
  const avisos: string[] = [];

  let totalComValor = 0;
  let totalSemValor = 0;
  let somaValorTotal = 0;
  let cruzadosSmg = 0;
  let cruzadosSpcoi = 0;

  const totalLinhasDados = raw2D.length - (linhaCabecalho + 1);

  for (let i = linhaCabecalho + 1; i < raw2D.length; i++) {
    const row = raw2D[i];
    if (!Array.isArray(row) || row.every((c) => c === '' || c === null || c === undefined)) {
      continue;
    }

    // Leitura dos códigos:
    // Na nova planilha, Coluna A contém o código raiz e Coluna B contém o dígito
    const rawCodA = colunas.colCodigo !== undefined ? row[colunas.colCodigo] : '';
    const rawCodB = colunas.colCodigoInterno !== undefined ? row[colunas.colCodigoInterno] : '';

    let norm = normalizeCodigoSMGO(rawCodA, rawCodB);
    if (!norm.isValid && rawCodB) {
      norm = normalizeCodigoSMGO(rawCodB, rawCodA);
    }

    if (!norm.isValid || !norm.codigoInterno) {
      avisos.push(`Linha ${i + 1}: código de produto inválido ou não informado.`);
      continue;
    }

    const nome = colunas.colNome !== undefined ? String(row[colunas.colNome] || '').trim() : '';
    const complemento = colunas.colComplemento !== undefined ? String(row[colunas.colComplemento] || '').trim() : '';

    // VALOR DISPONÍVEL (REGRA FINANCEIRA OFICIAL SOBERANA)
    const rawValorDisp = colunas.colValorDisponivel !== undefined ? row[colunas.colValorDisponivel] : null;
    const resValorDisp = parseValorDisponivelOficial(rawValorDisp);

    if (resValorDisp.valor !== null) {
      totalComValor++;
      somaValorTotal += resValorDisp.valor;
    } else {
      totalSemValor++;
    }

    // VALOR INDISPONÍVEL (COLUNA G)
    const rawValorIndisp = colunas.colValorIndisponivel !== undefined ? row[colunas.colValorIndisponivel] : null;
    const resValorIndisp = parseValorDisponivelOficial(rawValorIndisp);

    // ESTOQUE (COLUNA F) - Preservação do texto original e formatação operacional
    const rawEstoque = colunas.colEstoque !== undefined ? row[colunas.colEstoque] : '';
    const estoqueInfo = formatarEstoqueOperacionalExtenso(rawEstoque);

    // DIAS SEM VENDA (COLUNA K)
    const rawDiasSemVenda = colunas.colDiasSemVenda !== undefined ? row[colunas.colDiasSemVenda] : '';
    const diasSemVenda = parseNumeroInteiro(rawDiasSemVenda);

    // IDADE (COLUNA R)
    const rawIdade = colunas.colIdade !== undefined ? row[colunas.colIdade] : '';
    const idade = parseNumeroInteiro(rawIdade);

    // QUANTIDADE DE VENDA 30 DIAS (COLUNA T)
    const rawVenda30D = colunas.colQtdVenda30Dias !== undefined ? row[colunas.colQtdVenda30Dias] : '';
    const venda30D = parseNumeroInteiro(rawVenda30D);

    // DATAS E HORAS COMBINADAS:
    // Última Venda (Colunas L e M)
    const rawUltimaVendaData = colunas.colUltimaVendaData !== undefined ? row[colunas.colUltimaVendaData] : '';
    const rawUltimaVendaHora = colunas.colUltimaVendaHora !== undefined ? row[colunas.colUltimaVendaHora] : '';
    const ultimaVendaFormatada = formatarDataHoraExcel(rawUltimaVendaData, rawUltimaVendaHora);

    // Última Compra (Colunas N e O)
    const rawUltimaCompraData = colunas.colUltimaCompraData !== undefined ? row[colunas.colUltimaCompraData] : '';
    const rawUltimaCompraHora = colunas.colUltimaCompraHora !== undefined ? row[colunas.colUltimaCompraHora] : '';
    const ultimaCompraFormatada = formatarDataHoraExcel(rawUltimaCompraData, rawUltimaCompraHora);

    // Alteração de Preço (Colunas AF e AG)
    const rawAltPrecoData = colunas.colAlteracaoPrecoData !== undefined ? row[colunas.colAlteracaoPrecoData] : '';
    const rawAltPrecoHora = colunas.colAlteracaoPrecoHora !== undefined ? row[colunas.colAlteracaoPrecoHora] : '';
    const alteracaoPrecoFormatada = formatarDataHoraExcel(rawAltPrecoData, rawAltPrecoHora);

    // SITUAÇÃO DE ESTOQUE E MERCADORIA:
    const bloqueio = colunas.colBloqueio !== undefined ? String(row[colunas.colBloqueio] || '').trim() : '';
    const transitoEntrada = colunas.colTransitoEntrada !== undefined ? row[colunas.colTransitoEntrada] : '';
    const estoqueIndisponivel = colunas.colEstoqueIndisponivel !== undefined ? row[colunas.colEstoqueIndisponivel] : '';
    const pedidosPendentes = colunas.colPedidosPendentes !== undefined ? String(row[colunas.colPedidosPendentes] || '').trim() : '';

    // CLASSIFICAÇÃO E SETORES:
    const classeProduto = colunas.colClasseProduto !== undefined ? String(row[colunas.colClasseProduto] || '').trim() : '';
    const classeProdutoRaiz = colunas.colClasseProdutoRaiz !== undefined ? String(row[colunas.colClasseProdutoRaiz] || '').trim() : '';
    const setorSave = colunas.colSetorSave !== undefined ? String(row[colunas.colSetorSave] || '').trim() : '';
    const validade1 = colunas.colValidade1 !== undefined ? String(row[colunas.colValidade1] || '').trim() : '';
    const validade2 = colunas.colValidade2 !== undefined ? String(row[colunas.colValidade2] || '').trim() : '';
    const cadeia = colunas.colCadeia !== undefined ? String(row[colunas.colCadeia] || '').trim() : '';
    const setor = colunas.colSetor !== undefined ? String(row[colunas.colSetor] || '').trim() : '';
    const setorHerdado = colunas.colSetorHerdado !== undefined ? String(row[colunas.colSetorHerdado] || '').trim() : '';

    // CADASTRO E OPERAÇÃO:
    const fornecedorPlanilha = colunas.colFornecedor !== undefined ? String(row[colunas.colFornecedor] || '').trim() : '';
    const gerenciado = colunas.colGerenciado !== undefined ? String(row[colunas.colGerenciado] || '').trim() : '';
    const ativo = colunas.colAtivo !== undefined ? String(row[colunas.colAtivo] || '').trim() : '';
    const residuo = colunas.colResiduo !== undefined ? String(row[colunas.colResiduo] || '').trim() : '';
    const pesoVariavel = colunas.colPesoVariavel !== undefined ? String(row[colunas.colPesoVariavel] || '').trim() : '';
    const verificador = colunas.colVerificador !== undefined ? String(row[colunas.colVerificador] || '').trim() : '';
    const autonomia = colunas.colAutonomia !== undefined ? String(row[colunas.colAutonomia] || '').trim() : '';
    const autonomiaPedido = colunas.colAutonomiaPedido !== undefined ? String(row[colunas.colAutonomiaPedido] || '').trim() : '';

    // Cruzamento com SMGOI013 e SPCOI007
    if (smgPorCodigo.has(norm.codigoInterno)) {
      cruzadosSmg++;
    }
    if (cnpjsSpcoiPorCodigo.has(norm.codigoInterno)) {
      cruzadosSpcoi++;
    }

    registros.push({
      id: norm.codigoInterno,
      codigo_original: norm.codigoOriginal,
      codigo_interno: norm.codigoInterno,
      digito: norm.digito,
      codigo_exibicao: norm.codigoExibicao,
      filial: '172',
      nome: nome || (smgPorCodigo.get(norm.codigoInterno)?.descricao || `PRODUTO ${norm.codigoExibicao}`),
      complemento,
      valor_disponivel: resValorDisp.valor,
      valor_disponivel_status: resValorDisp.status,
      estoque: estoqueInfo.quantidadeNumerica,
      estoque_original_texto: estoqueInfo.textoOriginal,
      estoque_formatado_extenso: estoqueInfo.textoExtenso,
      valor_indisponivel: resValorIndisp.valor,
      bloqueio: bloqueio || 'NÃO',
      transito_entrada: transitoEntrada !== '' ? transitoEntrada : 0,
      estoque_indisponivel: estoqueIndisponivel !== '' ? estoqueIndisponivel : 0,
      dias_sem_venda: diasSemVenda,
      dias_sem_venda_original: String(rawDiasSemVenda).trim(),
      ultima_venda_data: String(rawUltimaVendaData).trim(),
      ultima_venda_hora: String(rawUltimaVendaHora).trim(),
      ultima_venda_formatada: ultimaVendaFormatada,
      ultima_compra_data: String(rawUltimaCompraData).trim(),
      ultima_compra_hora: String(rawUltimaCompraHora).trim(),
      ultima_compra_formatada: ultimaCompraFormatada,
      classe_produto: classeProduto,
      classe_produto_raiz: classeProdutoRaiz,
      idade: idade,
      pedidos_pendentes: pedidosPendentes || '0',
      venda_30_dias: venda30D,
      setor_save: setorSave,
      validade_1: validade1,
      validade_2: validade2,
      cadeia: cadeia,
      setor: setor,
      setor_herdado: setorHerdado,
      fornecedor_planilha: fornecedorPlanilha,
      gerenciado: gerenciado || 'SIM',
      ativo: ativo || 'SIM',
      residuo: residuo || '0',
      peso_variavel: pesoVariavel || 'NÃO',
      alteracao_preco_data: String(rawAltPrecoData).trim(),
      alteracao_preco_hora: String(rawAltPrecoHora).trim(),
      alteracao_preco_formatada: alteracaoPrecoFormatada,
      verificador: verificador || norm.digito,
      autonomia: autonomia,
      autonomia_pedido: autonomiaPedido,
      linha_arquivo: i + 1,
    });

    if (i % 250 === 0 && onProgress) {
      const pct = Math.min(90, Math.round(35 + (i / raw2D.length) * 55));
      onProgress(pct, `Processando linha ${i - linhaCabecalho} de ${totalLinhasDados}...`);
    }
  }

  onProgress?.(95, 'Consolidando indicadores e resumo da importação...');
  await new Promise((r) => setTimeout(r, 40));

  const resumo: ResumoImportacaoIsv = {
    id: `ISV_${Date.now()}`,
    data_hora: new Date().toISOString(),
    nome_arquivo: file.name,
    total_lidos: totalLinhasDados,
    total_processados: registros.length,
    total_com_valor: totalComValor,
    total_sem_valor: totalSemValor,
    valor_total_disponivel: Number(somaValorTotal.toFixed(2)),
    total_cruzados_smgoi013: cruzadosSmg,
    total_cruzados_spcoi007: cruzadosSpcoi,
    avisos: avisos.slice(0, 30),
  };

  onProgress?.(100, 'Importação da Planilha Operacional de 36 colunas concluída com sucesso!');

  return {
    registros,
    resumo,
  };
}

/**
 * Gera um arquivo modelo .XLSX com todas as 36 colunas oficiais na ordem exata do ERP.
 * Inclui os produtos reais de teste obrigatório da Filial 172:
 * - 16337-160 CONFEITO M M TUBE: R$ 890,09 (242 UND)
 * - 17231-110 CHOC. NESTLÉ SUFLAIR: R$ 10.533,29 (45 CXA (24) + 0)
 * - 85327-177 AC. BOV. BUCHO: R$ 16.168,49 (714 KG + 882 G)
 * - 7922-130 REF. SUKITA LARANJA PET: R$ 8.521,55 (200 CXA (6) + 0)
 * - 84282-160 DET.LIQ.VIDA LIMAO: R$ 8.436,20 (150 CXA (24) + 0)
 */
export function gerarExemploPlanilhaISV(): void {
  const cabecalhos = [
    'Código',                    // A
    'Código Interno',            // B
    'Nome',                      // C
    'Complemento',               // D
    'Valor Disponível',          // E
    'Estoque',                   // F
    'Valor Indisponível',        // G
    'Bloqueio',                  // H
    'Trânsito de Entrada',       // I
    'Estoque Indisponível',      // J
    'Dias sem venda',            // K
    'Última venda',              // L (Data)
    'Última venda',              // M (Hora)
    'Última Compra',             // N (Data)
    'Última Compra',             // O (Hora)
    'Classe de Produto',         // P
    'Classe de Produto Raiz',    // Q
    'Idade',                     // R
    'Pedidos Pendentes',         // S
    'Quantidade de Venda 30 Dias',// T
    'Setor Save',                // U
    'Validade',                  // V
    'Validade',                  // W
    'Cadeia',                    // X
    'Setor',                     // Y
    'Setor herdado',             // Z
    'Fornecedor',                // AA
    'Gerenciado',                // AB
    'Ativo',                     // AC
    'Resíduo',                   // AD
    'Peso Variável',             // AE
    'Alteração de Preço',        // AF (Data)
    'Alteração de Preço',        // AG (Hora)
    'Verificador',               // AH
    'Autonomia',                 // AI
    'Autonomia de Pedido',       // AJ
  ];

  const linhasExemplo = [
    [
      '85327', '177', 'AC. BOV. BUCHO RESERVA CONG MAE', 'KG 1 X 1', 16168.49,
      '714 KG + 882 G', 0, 'NÃO', 0, 0, 22, '10/08/2026', '14:25', '28/07/2026', '09:15',
      'CARNES BOVINAS', 'ACOUGUE', 60, '0', 180, '03 - CARNES',
      '30/11/2026', '15/12/2026', 'CADEIA FRIA', 'ACOUGUE', 'PERECIVEIS',
      '03.555.444/0001-33 BRF S.A.', 'SIM', 'SIM', '0', 'SIM',
      '01/08/2026', '08:00', '177', '15 DIAS', '7 DIAS',
    ],
    [
      '16337', '160', 'CONFEITO M M TUBE', 'CXA 24 X 12 X 30G', 890.09,
      '242 UND', 0, 'NÃO', 0, 0, 45, '15/07/2026', '16:40', '10/06/2026', '11:00',
      'CONFEITOS & CHOCOLATES', 'MERCEARIA DOCE', 120, '0', 36, '02 - MERCEARIA',
      '28/02/2027', '15/03/2027', 'MERCEARIA', 'MERCEARIA DOCE', 'SECOS',
      '02.987.654/0001-22 NESTLE BRASIL LTDA', 'SIM', 'SIM', '0', 'NÃO',
      '15/06/2026', '08:00', '160', '30 DIAS', '15 DIAS',
    ],
    [
      '17231', '110', 'CHOC. NESTLÉ SUFLAIR AO LEITE', 'CXA 1 X 24 X 50G', 10533.29,
      '45 CXA (24) + 0', 0, 'NÃO', 0, 0, 38, '20/07/2026', '18:10', '18/06/2026', '14:30',
      'CHOCOLATES TABLETES', 'MERCEARIA DOCE', 95, '0', 60, '02 - MERCEARIA',
      '30/01/2027', '15/02/2027', 'MERCEARIA', 'MERCEARIA DOCE', 'SECOS',
      '02.987.654/0001-22 NESTLE BRASIL LTDA', 'SIM', 'SIM', '0', 'NÃO',
      '20/06/2026', '08:00', '110', '25 DIAS', '10 DIAS',
    ],
    [
      '7922', '130', 'REF. SUKITA LARANJA PET', 'CXA 1 X 6', 8521.55,
      '200 CXA (6) + 0', 0, 'NÃO', 0, 0, 30, '25/07/2026', '11:20', '02/07/2026', '10:00',
      'REFRIGERANTES PET', 'BEBIDAS', 85, '0', 95, '06 - BEBIDAS',
      '15/12/2026', '30/12/2026', 'BEBIDAS', 'BEBIDAS', 'LIQUIDOS',
      '00.000.000/0001-91 AMBEV S/A', 'SIM', 'SIM', '0', 'NÃO',
      '05/07/2026', '08:00', '130', '20 DIAS', '7 DIAS',
    ],
    [
      '84282', '160', 'DET.LIQ.VIDA LIMAO', 'CXA 1 X 24', 8436.20,
      '150 CXA (24) + 0', 0, 'NÃO', 0, 0, 42, '18/07/2026', '10:15', '20/06/2026', '15:45',
      'DETERGENTES LIQUIDOS', 'LIMPEZA', 110, '0', 240, '05 - HIGIENE E LIMPEZA',
      '30/06/2028', '30/07/2028', 'LIMPEZA', 'LIMPEZA', 'QUIMICOS',
      '04.111.222/0001-44 VIDA QUIMICA LTDA', 'SIM', 'SIM', '0', 'NÃO',
      '25/06/2026', '08:00', '160', '35 DIAS', '14 DIAS',
    ],
    [
      '60662', '120', 'CHOCOLATE CHARGE NESTLE', 'CXA 1 X 30', 2145.80,
      '24 CXA (24) + 5', 0, 'NÃO', 0, 0, 28, '02/08/2026', '17:05', '12/07/2026', '13:20',
      'BOMBONS & BARRAS', 'MERCEARIA DOCE', 70, '0', 85, '02 - MERCEARIA',
      '15/04/2027', '30/04/2027', 'MERCEARIA', 'MERCEARIA DOCE', 'SECOS',
      '02.987.654/0001-22 NESTLE BRASIL LTDA', 'SIM', 'SIM', '0', 'NÃO',
      '15/07/2026', '08:00', '120', '18 DIAS', '7 DIAS',
    ],
    [
      '43708', '134', 'SACOLA PLAST EXTRUSA PACK 30X40', 'FD 1 X 1000', 3420.50,
      '45 FD (1000) + 0', 0, 'NÃO', 0, 0, 65, '12/06/2026', '09:50', '15/05/2026', '11:10',
      'DESCARTAVEIS & EMBALAGENS', 'UTILIDADES', 180, '0', 12, '09 - BAZAR',
      '31/12/2030', '31/12/2030', 'BAZAR', 'BAZAR', 'NAO PERECIVEIS',
      '05.666.777/0001-88 EXTRUSA PACK IND LTDA', 'SIM', 'SIM', '0', 'NÃO',
      '20/05/2026', '08:00', '134', '60 DIAS', '30 DIAS',
    ],
    [
      '11285', '151', 'RF.IOG.DANONE 5X ZERO MORANGO', 'CXA 1 X 8 X 1200G', 1240.18,
      '12 CXA (8) + 0', 0, 'NÃO', 0, 0, 18, '12/08/2026', '16:00', '02/08/2026', '08:30',
      'IOGURTES LIQUIDOS', 'LATICINIOS', 40, '0', 75, '04 - FRIOS E LATICINIOS',
      '25/09/2026', '10/10/2026', 'CADEIA FRIA', 'LATICINIOS', 'PERECIVEIS',
      '01.123.456/0001-88 DANONE LTDA', 'SIM', 'SIM', '0', 'NÃO',
      '05/08/2026', '08:00', '151', '10 DIAS', '5 DIAS',
    ],
    [
      '46135', '156', 'RF.MARG.QUALY C/SAL 500G', 'CXA 1 X 24', 1890.40,
      '10 CXA (24) + 0', 0, 'NÃO', 0, 0, 15, '15/08/2026', '14:40', '05/08/2026', '09:00',
      'MARGARINAS', 'LATICINIOS', 35, '0', 120, '04 - FRIOS E LATICINIOS',
      '15/11/2026', '30/11/2026', 'CADEIA FRIA', 'LATICINIOS', 'PERECIVEIS',
      '03.555.444/0001-33 BRF S.A.', 'SIM', 'SIM', '0', 'NÃO',
      '08/08/2026', '08:00', '156', '12 DIAS', '5 DIAS',
    ],
    [
      '76916', '185', 'CHOCOLATE NESTLE CLASSIC 90G', 'CXA 1 X 20', 2650.00,
      '20 CXA (20) + 0', 0, 'NÃO', 0, 0, 25, '05/08/2026', '12:30', '15/07/2026', '14:00',
      'CHOCOLATES TABLETES', 'MERCEARIA DOCE', 60, '0', 90, '02 - MERCEARIA',
      '15/02/2027', '28/02/2027', 'MERCEARIA', 'MERCEARIA DOCE', 'SECOS',
      '02.987.654/0001-22 NESTLE BRASIL LTDA', 'SIM', 'SIM', '0', 'NÃO',
      '20/07/2026', '08:00', '185', '20 DIAS', '10 DIAS',
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet([cabecalhos, ...linhasExemplo]);
  ws['!cols'] = [
    { wch: 14 }, // A: Código
    { wch: 16 }, // B: Código Interno
    { wch: 38 }, // C: Nome
    { wch: 22 }, // D: Complemento
    { wch: 18 }, // E: Valor Disponível
    { wch: 22 }, // F: Estoque
    { wch: 18 }, // G: Valor Indisponível
    { wch: 12 }, // H: Bloqueio
    { wch: 18 }, // I: Trânsito Entrada
    { wch: 18 }, // J: Estoque Indisp
    { wch: 15 }, // K: Dias sem venda
    { wch: 15 }, // L: Última venda (Data)
    { wch: 15 }, // M: Última venda (Hora)
    { wch: 15 }, // N: Última Compra (Data)
    { wch: 15 }, // O: Última Compra (Hora)
    { wch: 25 }, // P: Classe
    { wch: 22 }, // Q: Classe Raiz
    { wch: 10 }, // R: Idade
    { wch: 18 }, // S: Pedidos Pendentes
    { wch: 24 }, // T: Qtd Venda 30D
    { wch: 20 }, // U: Setor Save
    { wch: 14 }, // V: Validade 1
    { wch: 14 }, // W: Validade 2
    { wch: 16 }, // X: Cadeia
    { wch: 18 }, // Y: Setor
    { wch: 18 }, // Z: Setor herdado
    { wch: 35 }, // AA: Fornecedor
    { wch: 12 }, // AB: Gerenciado
    { wch: 10 }, // AC: Ativo
    { wch: 12 }, // AD: Resíduo
    { wch: 14 }, // AE: Peso Variável
    { wch: 18 }, // AF: Alt Preço Data
    { wch: 18 }, // AG: Alt Preço Hora
    { wch: 14 }, // AH: Verificador
    { wch: 16 }, // AI: Autonomia
    { wch: 18 }, // AJ: Autonomia Pedido
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planilha_Operacional_36_Cols');
  XLSX.writeFile(wb, 'MODELO_PLANILHA_OPERACIONAL_36_COLUNAS.xlsx');
}
