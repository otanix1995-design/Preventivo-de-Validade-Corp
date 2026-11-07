/**
 * ISV — SERVIÇO OFICIAL DE RELATÓRIOS PDF
 * Filial: 172 — Cascavel
 * 
 * Padrão Visual Obrigatório Institucional:
 * - Papel A4, orientação paisagem (297mm x 210mm).
 * - Cabeçalho azul-escuro (#0F172A) com identidade "ISV — INTELIGÊNCIA DE ESTOQUE".
 * - Identificação "FILIAL 172 — CASCAVEL".
 * - Data e hora reais de emissão.
 * - Faixa laranja (#EA580C) identificando o relatório ou filtro ativo.
 * - Cabeçalho das colunas em AMARELO (#FACC15) com texto em negrito (#0F172A).
 * - Tabela branca, compacta, com linhas pretas (lineWidth: 0.15, lineColor: [0, 0, 0]).
 * - Fonte legível, alinhamento consistente e margens de 10mm.
 * - Rodapé com total real de produtos, paginação real ("Página X de Y") e totais.
 * - Quebra automática de páginas com repetição dos cabeçalhos (showHead: 'everyPage').
 * - NENHUMA coluna de estoque duplicada (apenas uma única coluna "ESTOQUE").
 * 
 * Relatórios Oficiais Implementados:
 * 1. PDF — TOP 30 (Ranking dos 30 produtos com mais dias sem venda, com cores oficiais)
 * 2. PDF — Relatório por Fornecedor (Sem coluna repetida de fornecedor)
 * 3. PDF — Relatório por Promotor (Sem coluna repetida de promotor)
 * 4. PDF — Relatório por Agência (Sem coluna repetida de agência)
 * 5. PDF — Relatório Geral da Loja / Filtros Ativos
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ItemIsv } from '../types';
import { isvService } from './isvService';
import {
  classificarDiasSemVenda,
  extrairAgenciaProduto,
  extrairFornecedorProduto,
  extrairGrupoProduto,
  extrairPromotorProduto,
  formatarEstoqueColunaUnica,
  obterTop30Mercadorias,
} from './isvClassificacaoService';

export interface IsvPdfOptions {
  tituloFiltro?: string;
  tipoAgrupamento?: 'GERAL' | 'FORNECEDOR' | 'INDUSTRIA' | 'PROMOTOR' | 'AGENCIA' | 'TOP30';
  nomeEntidade?: string;
  subtituloEntidade?: string;
  exibirValorEstoque?: boolean;
  filialNome?: string;
  limiteQuantidade?: number | 'TODOS';
  fonteOficial?: string;
  filtrosDescricao?: string;
  tipoRelatorioTitulo?: string;
}

// ============================================================================
// HELPER COMPARTILHADO: CABEÇALHO AZUL-ESCURO E FAIXA LARANJA INSTITUCIONAL
// ============================================================================

interface DadosCabecalhoIsv {
  doc: jsPDF;
  pageWidth: number;
  marginX: number;
  tituloFaixaLaranja: string;
  subtituloFaixaLaranja?: string;
  dataHoraEmissao: string;
  filialNome: string;
}

function desenharCabecalhoInstitucionalIsv(dados: DadosCabecalhoIsv): number {
  const { doc, pageWidth, marginX, tituloFaixaLaranja, subtituloFaixaLaranja, dataHoraEmissao, filialNome } = dados;

  // 1. Cabeçalho Azul-Escuro (#0F172A)
  doc.setFillColor(15, 23, 42); // slate-900 institucional
  doc.rect(0, 0, pageWidth, 22, 'F');

  // Faixa de acento azul (#1D4ED8)
  doc.setFillColor(29, 78, 216);
  doc.rect(0, 22, pageWidth, 1.5, 'F');

  // Título e Identificação da Filial
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('ISV — INTELIGÊNCIA DE ESTOQUE', marginX, 9);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(191, 219, 254); // blue-200
  doc.text(filialNome.toUpperCase(), marginX, 15);

  // Data e hora reais de emissão (Direita)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(226, 232, 240); // slate-200
  doc.text(`Emissão: ${dataHoraEmissao}`, pageWidth - marginX, 9, { align: 'right' });
  doc.text('DOCUMENTO OFICIAL ISV • A4 PAISAGEM', pageWidth - marginX, 15, { align: 'right' });

  // 2. Faixa Laranja Institucional (#EA580C)
  const yFaixaLaranja = 25.5;
  const alturaFaixaLaranja = subtituloFaixaLaranja ? 12 : 9;

  doc.setFillColor(234, 88, 12); // orange-600 vibrante
  doc.rect(marginX, yFaixaLaranja, pageWidth - marginX * 2, alturaFaixaLaranja, 'F');

  // Borda sutil na faixa laranja
  doc.setDrawColor(194, 65, 12); // orange-700
  doc.setLineWidth(0.2);
  doc.rect(marginX, yFaixaLaranja, pageWidth - marginX * 2, alturaFaixaLaranja, 'S');

  // Texto da faixa laranja em branco puro
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(subtituloFaixaLaranja ? 9.5 : 9);
  doc.text(tituloFaixaLaranja.toUpperCase(), marginX + 3.5, yFaixaLaranja + (subtituloFaixaLaranja ? 4.8 : 5.8));

  if (subtituloFaixaLaranja) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 247, 237); // orange-50
    doc.text(subtituloFaixaLaranja, marginX + 3.5, yFaixaLaranja + 9.5);
  }

  return yFaixaLaranja + alturaFaixaLaranja + 3;
}

/**
 * Numera todas as páginas no formato "Página X de Y" com informações do rodapé oficial.
 */
function aplicarRodapeTodasPaginas(
  doc: jsPDF,
  pageWidth: number,
  pageHeight: number,
  marginX: number,
  infoEsquerda: string,
  infoCentro?: string
): void {
  const totalPages = typeof (doc as any).getNumberOfPages === 'function'
    ? (doc as any).getNumberOfPages()
    : typeof (doc.internal as any).getNumberOfPages === 'function'
    ? (doc.internal as any).getNumberOfPages()
    : (doc.internal.pages ? doc.internal.pages.length - 1 : 1);

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Linha divisória fina do rodapé
    doc.setDrawColor(203, 213, 225); // slate-300
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 9, pageWidth - marginX, pageHeight - 9);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139); // slate-500

    // Esquerda: Informações da Filial e do Sistema
    doc.text(infoEsquerda, marginX, pageHeight - 5);

    // Centro: Totais ou Informação Pertinente
    if (infoCentro) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text(infoCentro, pageWidth / 2, pageHeight - 5, { align: 'center' });
    }

    // Direita: Numeração de Páginas Real
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - marginX, pageHeight - 5, { align: 'right' });
  }
}

// ============================================================================
// 1. PDF — TOP 30 MERCADORIAS (SEÇÃO 8)
// ============================================================================

/**
 * Gera o relatório oficial TOP 30 — MERCADORIAS em A4 Paisagem.
 * 
 * Faixa Laranja: TOP 30 — MERCADORIAS
 * Subtítulo: Ranking dos 30 produtos com mais dias sem venda.
 * Colunas (11): POS. | CÓDIGO | DESCRIÇÃO | EMBALAGEM | ESTOQUE | IDADE (dias) | DIAS S/VENDA | GRUPO | FORNECEDOR | AGÊNCIA | PROMOTOR
 */
export function gerarRelatorioTop30Pdf(
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 297 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 210 mm
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options?.filialNome || 'FILIAL 172 — CASCAVEL';

  // Obter exatamente os 30 produtos ordenados com as regras oficiais
  const top30 = obterTop30Mercadorias(itens);

  let estoqueTotal = 0;
  for (const it of top30) {
    estoqueTotal += it.estoque;
  }

  // Desenhar cabeçalho azul-escuro e faixa laranja
  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: 'TOP 30 — MERCADORIAS',
    subtituloFaixaLaranja: 'Ranking dos 30 produtos com mais dias sem venda.',
    dataHoraEmissao,
    filialNome,
  });

  // Cabeçalhos das 11 colunas na ordem estrita
  const cabecalhos = [
    'POS.',
    'CÓDIGO',
    'DESCRIÇÃO',
    'EMBALAGEM',
    'ESTOQUE',
    'IDADE (dias)',
    'DIAS S/VENDA',
    'GRUPO',
    'FORNECEDOR',
    'AGÊNCIA',
    'PROMOTOR',
  ];

  const linhasDados = top30.map((p) => [
    p.posicaoFormatada,
    p.codigoInterno,
    p.descricao,
    p.embalagem,
    p.estoqueFormatado,
    String(p.idade),
    String(p.diasSemVenda),
    p.grupo,
    p.fornecedor,
    p.agencia,
    p.promotor,
  ]);

  // Largura útil total: 277 mm (297 - 20)
  // 12 + 18 + 68 + 22 + 20 + 18 + 20 + 23 + 28 + 24 + 24 = 277 mm
  const columnStylesConfig: Record<number, any> = {
    0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' }, // POS.
    1: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
    2: { cellWidth: 68, halign: 'left' }, // DESCRIÇÃO
    3: { cellWidth: 22, halign: 'left' }, // EMBALAGEM
    4: { cellWidth: 20, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
    5: { cellWidth: 18, halign: 'center' }, // IDADE (dias)
    6: { cellWidth: 20, halign: 'center', fontStyle: 'bold' }, // DIAS S/VENDA
    7: { cellWidth: 23, halign: 'left' }, // GRUPO
    8: { cellWidth: 28, halign: 'left' }, // FORNECEDOR
    9: { cellWidth: 24, halign: 'left' }, // AGÊNCIA
    10: { cellWidth: 24, halign: 'left' }, // PROMOTOR
  };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage', // Repete cabeçalho em todas as páginas
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0], // Linhas pretas
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21], // Amarelo oficial (#FACC15)
      textColor: [15, 23, 42], // Texto preto/azul-escuro em negrito
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255], // Tabela branca compacta
    },
    columnStyles: columnStylesConfig,
    didParseCell: (data) => {
      // Destacar cores oficiais na célula de DIAS S/VENDA (coluna index 6) e POS. (coluna index 0)
      if (data.section === 'body') {
        const itemTop = top30[data.row.index];
        if (itemTop) {
          const classif = itemTop.classificacao;
          if (data.column.index === 6) {
            // DIAS S/VENDA com fundo colorido suave e texto contrastante
            if (classif.tipo === 'CRITICO') {
              data.cell.styles.fillColor = [254, 226, 226]; // red-100
              data.cell.styles.textColor = [185, 28, 28]; // red-700
              data.cell.styles.fontStyle = 'bold';
            } else if (classif.tipo === 'ALERTA') {
              data.cell.styles.fillColor = [255, 237, 213]; // orange-100
              data.cell.styles.textColor = [194, 65, 12]; // orange-700
              data.cell.styles.fontStyle = 'bold';
            } else if (classif.tipo === 'ATENCAO') {
              data.cell.styles.fillColor = [254, 249, 195]; // yellow-100
              data.cell.styles.textColor = [161, 98, 7]; // yellow-800
              data.cell.styles.fontStyle = 'bold';
            } else if (classif.tipo === 'GIRO_NORMAL') {
              data.cell.styles.fillColor = [209, 250, 229]; // emerald-100
              data.cell.styles.textColor = [4, 120, 87]; // emerald-700
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      }
    },
  });

  // Aplicar paginação real e rodapé com totais
  const dataAnaliseFormatada = agora.toLocaleDateString('pt-BR');
  const unidades = new Set(top30.map((i) => (i.embalagem || 'UN').trim().toUpperCase()));
  let infoEstoque = '';
  if (unidades.size === 1) {
    const uni = Array.from(unidades)[0];
    infoEstoque = ` | Estoque Total: ${Number.isInteger(estoqueTotal) ? estoqueTotal.toLocaleString('pt-BR') : estoqueTotal.toLocaleString('pt-BR', { minimumFractionDigits: 3 })} ${uni}`;
  }
  const infoCentro = `Total de Itens: ${top30.length} produtos classificados${infoEstoque} | Data de Análise: ${dataAnaliseFormatada}`;
  const infoEsquerda = `ISV • Inteligência de Estoque — ${filialNome}`;

  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  // Download do PDF
  const timestamp = agora.toISOString().slice(0, 10);
  doc.save(`ISV_TOP30_MERCADORIAS_FILIAL172_${timestamp}.pdf`);
}

// ============================================================================
// 2. PDF — RELATÓRIO POR FORNECEDOR (SEÇÃO 5)
// ============================================================================

/**
 * Gera o relatório oficial por Fornecedor.
 * 
 * Faixa Laranja: FORNECEDOR: [NOME DO FORNECEDOR SELECIONADO]
 * Colunas (9): CÓDIGO | DESCRIÇÃO | EMBALAGEM | ESTOQUE | IDADE (dias) | DIAS S/VENDA | GRUPO | AGÊNCIA | PROMOTOR
 * Regra: Não repete coluna FORNECEDOR na tabela.
 */
export function gerarRelatorioFornecedorPdf(
  fornecedorNome: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options?.filialNome || 'FILIAL 172 — CASCAVEL';

  let razaoSocialFornecedor = (fornecedorNome || 'FORNECEDOR SELECIONADO').trim().toUpperCase();
  if (fornecedorNome) {
    const apenasDigitos = fornecedorNome.replace(/\D/g, '');
    if (apenasDigitos.length === 14) {
      const ind = isvService.getIndustriaByCnpj(apenasDigitos);
      if (ind?.razao_social) {
        razaoSocialFornecedor = ind.razao_social.trim().toUpperCase();
      }
    }
  }

  // Filtra itens do fornecedor caso ainda não estejam filtrados
  const itensDoFornecedor = itens.filter((it) => {
    if (!fornecedorNome || fornecedorNome === 'TODOS' || fornecedorNome === 'TODAS') return true;
    const fn = (extrairFornecedorProduto(it) || '').toUpperCase();
    const indNomes = (it.industrias_nomes || []).map((n) => n.toUpperCase());
    return fn.includes(razaoSocialFornecedor) || indNomes.some((n) => n.includes(razaoSocialFornecedor));
  });

  // Desenhar cabeçalho azul-escuro e faixa laranja com a Razão Social da Indústria
  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: `FORNECEDOR: ${razaoSocialFornecedor}`,
    subtituloFaixaLaranja: options?.subtituloEntidade,
    dataHoraEmissao,
    filialNome,
  });

  // Cabeçalhos (9 colunas - sem coluna Fornecedor)
  const cabecalhos = [
    'CÓDIGO',
    'DESCRIÇÃO',
    'EMBALAGEM',
    'ESTOQUE',
    'IDADE (dias)',
    'DIAS S/VENDA',
    'GRUPO',
    'AGÊNCIA',
    'PROMOTOR',
  ];

  const linhasDados = itensDoFornecedor.map((item) => [
    item.codigo_interno,
    item.descricao,
    item.embalagem || 'UN',
    formatarEstoqueColunaUnica(item),
    String(item.idade ?? item.produto?.idade ?? 0),
    String(item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0),
    extrairGrupoProduto(item),
    extrairAgenciaProduto(item),
    extrairPromotorProduto(item),
  ]);

  // Largura útil total: 277 mm
  // 20 + 80 + 26 + 24 + 20 + 22 + 27 + 28 + 30 = 277 mm
  const columnStylesConfig: Record<number, any> = {
    0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
    1: { cellWidth: 80, halign: 'left' }, // DESCRIÇÃO
    2: { cellWidth: 26, halign: 'left' }, // EMBALAGEM
    3: { cellWidth: 24, halign: 'right', fontStyle: 'bold' }, // ESTOQUE (ÚNICA COLUNA)
    4: { cellWidth: 20, halign: 'center' }, // IDADE (dias)
    5: { cellWidth: 22, halign: 'center', fontStyle: 'bold' }, // DIAS S/VENDA
    6: { cellWidth: 27, halign: 'left' }, // GRUPO
    7: { cellWidth: 28, halign: 'left' }, // AGÊNCIA
    8: { cellWidth: 30, halign: 'left' }, // PROMOTOR
  };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21], // Amarelo (#FACC15)
      textColor: [15, 23, 42],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
  });

  const infoCentro = `Total de Produtos: ${itensDoFornecedor.length} itens`;
  const infoEsquerda = `ISV • Fornecedor: ${razaoSocialFornecedor} — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  const timestamp = agora.toISOString().slice(0, 10);
  const nomeArq = razaoSocialFornecedor.replace(/[^A-Z0-9]/g, '_').substring(0, 30);
  doc.save(`ISV_FORNECEDOR_${nomeArq}_${timestamp}.pdf`);
}

// ============================================================================
// 3. PDF — RELATÓRIO POR PROMOTOR (SEÇÃO 6)
// ============================================================================

/**
 * Gera o relatório oficial por Promotor.
 * 
 * Faixa Laranja: PROMOTOR: [NOME DO PROMOTOR SELECIONADO]
 * Colunas (9): CÓDIGO | DESCRIÇÃO | EMBALAGEM | FORNECEDOR | ESTOQUE | IDADE (dias) | DIAS S/VENDA | GRUPO | AGÊNCIA
 * Regra: Não repete coluna PROMOTOR na tabela.
 */
export function gerarRelatorioPromotorPdf(
  promotorNome: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options?.filialNome || 'FILIAL 172 — CASCAVEL';

  const nomePromLimpo = (promotorNome || 'PROMOTOR SELECIONADO').trim().toUpperCase();

  const itensDoPromotor = itens.filter((it) => {
    if (!promotorNome || promotorNome === 'TODOS') return true;
    const pNomes = (it.promotores_nomes || []).map((n) => n.toUpperCase());
    return pNomes.some((n) => n.includes(nomePromLimpo));
  });

  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: `PROMOTOR: ${nomePromLimpo}`,
    dataHoraEmissao,
    filialNome,
  });

  // Cabeçalhos (9 colunas - sem coluna Promotor)
  const cabecalhos = [
    'CÓDIGO',
    'DESCRIÇÃO',
    'EMBALAGEM',
    'FORNECEDOR',
    'ESTOQUE',
    'IDADE (dias)',
    'DIAS S/VENDA',
    'GRUPO',
    'AGÊNCIA',
  ];

  const linhasDados = itensDoPromotor.map((item) => [
    item.codigo_interno,
    item.descricao,
    item.embalagem || 'UN',
    extrairFornecedorProduto(item),
    formatarEstoqueColunaUnica(item),
    String(item.idade ?? item.produto?.idade ?? 0),
    String(item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0),
    extrairGrupoProduto(item),
    extrairAgenciaProduto(item),
  ]);

  // Largura útil total: 277 mm
  // 20 + 76 + 25 + 35 + 24 + 20 + 22 + 27 + 28 = 277 mm
  const columnStylesConfig: Record<number, any> = {
    0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
    1: { cellWidth: 76, halign: 'left' }, // DESCRIÇÃO
    2: { cellWidth: 25, halign: 'left' }, // EMBALAGEM
    3: { cellWidth: 35, halign: 'left' }, // FORNECEDOR
    4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
    5: { cellWidth: 20, halign: 'center' }, // IDADE (dias)
    6: { cellWidth: 22, halign: 'center', fontStyle: 'bold' }, // DIAS S/VENDA
    7: { cellWidth: 27, halign: 'left' }, // GRUPO
    8: { cellWidth: 28, halign: 'left' }, // AGÊNCIA
  };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21], // Amarelo (#FACC15)
      textColor: [15, 23, 42],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
  });

  const infoCentro = `Total de Produtos Vinculados: ${itensDoPromotor.length} itens`;
  const infoEsquerda = `ISV • Promotor: ${nomePromLimpo} — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  const timestamp = agora.toISOString().slice(0, 10);
  const nomeArq = nomePromLimpo.replace(/[^A-Z0-9]/g, '_').substring(0, 30);
  doc.save(`ISV_PROMOTOR_${nomeArq}_${timestamp}.pdf`);
}

// ============================================================================
// 4. PDF — RELATÓRIO POR AGÊNCIA (SEÇÃO 7)
// ============================================================================

/**
 * Gera o relatório oficial por Agência.
 * 
 * Faixa Laranja: AGÊNCIA: [NOME DA AGÊNCIA SELECIONADA]
 * Colunas (9): CÓDIGO | DESCRIÇÃO | EMBALAGEM | FORNECEDOR | ESTOQUE | IDADE (dias) | DIAS S/VENDA | GRUPO | PROMOTOR
 * Regra: Não repete coluna AGÊNCIA na tabela.
 */
export function gerarRelatorioAgenciaPdf(
  agenciaNome: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options?.filialNome || 'FILIAL 172 — CASCAVEL';

  const nomeAgLimpo = (agenciaNome || 'AGÊNCIA SELECIONADA').trim().toUpperCase();

  const itensDaAgencia = itens.filter((it) => {
    if (!agenciaNome || agenciaNome === 'TODAS') return true;
    const agNomes = (it.agencias_nomes || []).map((n) => n.toUpperCase());
    return agNomes.some((n) => n.includes(nomeAgLimpo));
  });

  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja: `AGÊNCIA: ${nomeAgLimpo}`,
    dataHoraEmissao,
    filialNome,
  });

  // Cabeçalhos (9 colunas - sem coluna Agência)
  const cabecalhos = [
    'CÓDIGO',
    'DESCRIÇÃO',
    'EMBALAGEM',
    'FORNECEDOR',
    'ESTOQUE',
    'IDADE (dias)',
    'DIAS S/VENDA',
    'GRUPO',
    'PROMOTOR',
  ];

  const linhasDados = itensDaAgencia.map((item) => [
    item.codigo_interno,
    item.descricao,
    item.embalagem || 'UN',
    extrairFornecedorProduto(item),
    formatarEstoqueColunaUnica(item),
    String(item.idade ?? item.produto?.idade ?? 0),
    String(item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0),
    extrairGrupoProduto(item),
    extrairPromotorProduto(item),
  ]);

  // Largura útil total: 277 mm
  // 20 + 76 + 25 + 35 + 24 + 20 + 22 + 27 + 28 = 277 mm
  const columnStylesConfig: Record<number, any> = {
    0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
    1: { cellWidth: 76, halign: 'left' }, // DESCRIÇÃO
    2: { cellWidth: 25, halign: 'left' }, // EMBALAGEM
    3: { cellWidth: 35, halign: 'left' }, // FORNECEDOR
    4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
    5: { cellWidth: 20, halign: 'center' }, // IDADE (dias)
    6: { cellWidth: 22, halign: 'center', fontStyle: 'bold' }, // DIAS S/VENDA
    7: { cellWidth: 27, halign: 'left' }, // GRUPO
    8: { cellWidth: 28, halign: 'left' }, // PROMOTOR
  };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21], // Amarelo (#FACC15)
      textColor: [15, 23, 42],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
  });

  const infoCentro = `Total de Produtos Vinculados: ${itensDaAgencia.length} itens`;
  const infoEsquerda = `ISV • Agência: ${nomeAgLimpo} — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  const timestamp = agora.toISOString().slice(0, 10);
  const nomeArq = nomeAgLimpo.replace(/[^A-Z0-9]/g, '_').substring(0, 30);
  doc.save(`ISV_AGENCIA_${nomeArq}_${timestamp}.pdf`);
}

// ============================================================================
// 5. PDF GERAL DA LOJA (COMPATIBILIDADE RETROATIVA TOTALMENTE ATUALIZADA)
// ============================================================================

/**
 * Gera relatório geral do ISV seguindo o padrão oficial A4 Paisagem.
 */
export function gerarRelatorioIsvA4Pdf(
  itens: ItemIsv[],
  options: IsvPdfOptions
): void {
  // Roteamento inteligente baseado no tipo de agrupamento solicitado
  if (options.tipoAgrupamento === 'TOP30' || options.limiteQuantidade === 30) {
    gerarRelatorioTop30Pdf(itens, options);
    return;
  }

  if (options.tipoAgrupamento === 'FORNECEDOR' && options.nomeEntidade) {
    gerarRelatorioFornecedorPdf(options.nomeEntidade, itens, options);
    return;
  }

  if (options.tipoAgrupamento === 'PROMOTOR' && options.nomeEntidade) {
    gerarRelatorioPromotorPdf(options.nomeEntidade, itens, options);
    return;
  }

  if (options.tipoAgrupamento === 'AGENCIA' && options.nomeEntidade) {
    gerarRelatorioAgenciaPdf(options.nomeEntidade, itens, options);
    return;
  }

  // Relatório Geral da Loja com Filtros Ativos
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filialNome = options.filialNome || 'FILIAL 172 — CASCAVEL';

  // Aplicar limite de exportação se especificado
  const itensProcessados =
    options.limiteQuantidade && options.limiteQuantidade !== 'TODOS'
      ? itens.slice(0, Number(options.limiteQuantidade))
      : itens;

  let tituloFaixaLaranja = options.tituloFiltro || 'RELATÓRIO GERAL DA LOJA';
  if (options.nomeEntidade) {
    tituloFaixaLaranja = `${options.tipoAgrupamento || 'ENTIDADE'}: ${options.nomeEntidade}`;
  }

  const subtituloFaixa = options.subtituloEntidade || (options.filtrosDescricao ? `Filtros: ${options.filtrosDescricao}` : undefined);

  const startY = desenharCabecalhoInstitucionalIsv({
    doc,
    pageWidth,
    marginX,
    tituloFaixaLaranja,
    subtituloFaixaLaranja: subtituloFaixa,
    dataHoraEmissao,
    filialNome,
  });

  // Colunas oficiais com única coluna de estoque
  const cabecalhos = [
    'CÓDIGO',
    'DESCRIÇÃO',
    'EMBALAGEM',
    'FORNECEDOR',
    'ESTOQUE',
    'IDADE (dias)',
    'DIAS S/VENDA',
    'GRUPO',
    'AGÊNCIA',
    'PROMOTOR',
  ];

  const linhasDados = itensProcessados.map((item) => [
    item.codigo_interno,
    item.descricao,
    item.embalagem || 'UN',
    extrairFornecedorProduto(item),
    formatarEstoqueColunaUnica(item),
    String(item.idade ?? item.produto?.idade ?? 0),
    String(item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0),
    extrairGrupoProduto(item),
    extrairAgenciaProduto(item),
    extrairPromotorProduto(item),
  ]);

  // Largura útil total: 277 mm
  // 18 + 68 + 22 + 32 + 22 + 18 + 22 + 25 + 25 + 25 = 277 mm
  const columnStylesConfig: Record<number, any> = {
    0: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
    1: { cellWidth: 68, halign: 'left' }, // DESCRIÇÃO
    2: { cellWidth: 22, halign: 'left' }, // EMBALAGEM
    3: { cellWidth: 32, halign: 'left' }, // FORNECEDOR
    4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
    5: { cellWidth: 18, halign: 'center' }, // IDADE (dias)
    6: { cellWidth: 22, halign: 'center', fontStyle: 'bold' }, // DIAS S/VENDA
    7: { cellWidth: 25, halign: 'left' }, // GRUPO
    8: { cellWidth: 25, halign: 'left' }, // AGÊNCIA
    9: { cellWidth: 25, halign: 'left' }, // PROMOTOR
  };

  autoTable(doc, {
    head: [cabecalhos],
    body: linhasDados,
    startY,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: 1.6,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [250, 204, 21], // Amarelo (#FACC15)
      textColor: [15, 23, 42],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles: columnStylesConfig,
  });

  const infoCentro = `Exibindo ${itensProcessados.length} de ${itens.length} produtos`;
  const infoEsquerda = `ISV • Relatório Geral — ${filialNome}`;
  aplicarRodapeTodasPaginas(doc, pageWidth, pageHeight, marginX, infoEsquerda, infoCentro);

  const timestamp = agora.toISOString().slice(0, 10);
  doc.save(`ISV_RELATORIO_GERAL_${timestamp}.pdf`);
}

// Alias retrocompatíveis
export const gerarRelatorioIsvA3Pdf = gerarRelatorioIsvA4Pdf;

export function gerarRelatorioEntidadeIsvA4Pdf(
  tipo: 'INDUSTRIA' | 'AGENCIA' | 'FORNECEDOR' | 'PROMOTOR',
  entidadeNome: string,
  subtitulo: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): void {
  if (tipo === 'AGENCIA') {
    gerarRelatorioAgenciaPdf(entidadeNome, itens, options);
  } else if (tipo === 'PROMOTOR') {
    gerarRelatorioPromotorPdf(entidadeNome, itens, options);
  } else {
    gerarRelatorioFornecedorPdf(entidadeNome, itens, options);
  }
}
