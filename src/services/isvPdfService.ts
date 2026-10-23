import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ItemIsv } from '../types';
import { formatarMoedaBR } from './deviceId';

export interface IsvPdfOptions {
  tituloFiltro?: string; // ex: "Geral da Loja", "Indústria: DANONE", "Promotor: JOAO SILVA"
  tipoAgrupamento?: 'GERAL' | 'INDUSTRIA' | 'PROMOTOR' | 'AGENCIA';
  nomeEntidade?: string;
  subtituloEntidade?: string; // ex: "CNPJ: 01.123.456/0001-88 - DANONE LTDA" ou "Agência: SPEED PROMO"
  exibirValorEstoque: boolean; // Padrão: true. Quando false, remove a coluna de valor e redistribui a largura
  filialNome?: string;
  limiteQuantidade?: number | 'TODOS'; // Top 30, Top 50, Top 100 ou 'TODOS'
  fonteOficial?: string; // Ex: "BASE DO RUB"
  filtrosDescricao?: string; // Descrição de filtros combinados ativos (Setor, Idade, Dias sem venda, etc.)
  tipoRelatorioTitulo?: string; // "PRODUTOS EM ISV", "RELATÓRIO POR INDÚSTRIA", "RELATÓRIO POR AGÊNCIA"
}

/**
 * Gera relatório oficial do módulo ISV | INTELIGÊNCIA DE ESTOQUE
 * no padrão obrigatório A4 Horizontal (Paisagem - 297mm x 210mm).
 */
export function gerarRelatorioIsvA4Pdf(
  itens: ItemIsv[],
  options: IsvPdfOptions
): void {
  // Aplicar seleção de limite de itens (ex: 30 maiores produtos)
  const itensProcessados =
    options.limiteQuantidade && options.limiteQuantidade !== 'TODOS'
      ? itens.slice(0, Number(options.limiteQuantidade))
      : itens;

  // Inicializa documento em A4 Horizontal (297mm x 210mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 297 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 210 mm
  const marginX = 12;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filial = options.filialNome || 'Filial 172 — Cascavel';
  const exibirValor = options.exibirValorEstoque;

  // Totalizadores garantindo distinção obrigatória entre exibidos e conjunto total filtrado
  const totalProdutosExibidos = itensProcessados.length;
  const totalProdutosFiltrados = itens.length;

  let valorTotalExibidos = 0;
  let qtdComValorExibidos = 0;
  let qtdSemValorExibidos = 0;

  itensProcessados.forEach((it) => {
    if (it.valor_estoque !== null && it.valor_estoque !== undefined) {
      valorTotalExibidos += it.valor_estoque;
      qtdComValorExibidos++;
    } else {
      qtdSemValorExibidos++;
    }
  });

  let valorTotalFiltrados = 0;
  let qtdComValorFiltrados = 0;
  let qtdSemValorFiltrados = 0;

  itens.forEach((it) => {
    if (it.valor_estoque !== null && it.valor_estoque !== undefined) {
      valorTotalFiltrados += it.valor_estoque;
      qtdComValorFiltrados++;
    } else {
      qtdSemValorFiltrados++;
    }
  });

  // 1. Cabeçalho Principal (Fundo Azul Escuro Corporativo #0F172A)
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 24, 'F');

  // Faixa de acento azul royal (#2563EB)
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 24, pageWidth, 2, 'F');

  // Título e Identificação da Filial
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('ISV | INTELIGÊNCIA DE ESTOQUE', marginX, 9);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(191, 219, 254); // blue-200
  doc.text(filial, marginX, 15);

  // Tipo de Relatório (Centro)
  let tipoRelatorio = options.tipoRelatorioTitulo || 'PRODUTOS EM ISV';
  if (options.tipoAgrupamento === 'INDUSTRIA' && options.nomeEntidade) {
    tipoRelatorio = `RELATÓRIO POR INDÚSTRIA: ${options.nomeEntidade.toUpperCase()}`;
  } else if (options.tipoAgrupamento === 'AGENCIA' && options.nomeEntidade) {
    tipoRelatorio = `RELATÓRIO POR AGÊNCIA: ${options.nomeEntidade.toUpperCase()}`;
  } else if (options.tipoAgrupamento === 'PROMOTOR' && options.nomeEntidade) {
    tipoRelatorio = `RELATÓRIO POR PROMOTOR: ${options.nomeEntidade.toUpperCase()}`;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(tipoRelatorio, pageWidth / 2, 10, { align: 'center' });

  // Subtítulo da Entidade (CNPJ, Razão Social ou Agência)
  if (options.subtituloEntidade) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(226, 232, 240);
    doc.text(options.subtituloEntidade, pageWidth / 2, 15, { align: 'center' });
  }

  // Data/Hora e Padrão A4 Horizontal (Direita)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text(`Emissão: ${dataHoraEmissao}`, pageWidth - marginX, 9, { align: 'right' });
  doc.text('PADRÃO OFICIAL A4 HORIZONTAL', pageWidth - marginX, 15, { align: 'right' });

  // 2. Barra de Resumo da Seleção / Filtros / Totais
  const isTopRanking = options.limiteQuantidade && options.limiteQuantidade !== 'TODOS';
  const barraAltura = isTopRanking || options.filtrosDescricao ? 13 : 10;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.3);
  doc.rect(marginX, 28, pageWidth - marginX * 2, barraAltura, 'FD');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  let textoFiltro = options.tituloFiltro ? `FILTRO: ${options.tituloFiltro.toUpperCase()}` : 'FILTRO: GERAL DA LOJA';
  if (options.fonteOficial) {
    textoFiltro += ` • [FONTE: ${options.fonteOficial.toUpperCase()}]`;
  }
  if (isTopRanking) {
    textoFiltro += ` • [TOP ${options.limiteQuantidade}]`;
  }
  if (options.filtrosDescricao) {
    textoFiltro += ` • [${options.filtrosDescricao.toUpperCase()}]`;
  }
  doc.text(textoFiltro, marginX + 3, 33);

  // Totais na barra
  if (isTopRanking) {
    const textoTop = `Exibindo ${totalProdutosExibidos} de ${totalProdutosFiltrados} produtos | Valor Exibido: ${formatarMoedaBR(valorTotalExibidos)}`;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(textoTop, pageWidth - marginX - 3, 33, { align: 'right' });

    let textoConjunto = `Valor Total Filtrado: ${formatarMoedaBR(valorTotalFiltrados)}`;
    if (qtdSemValorFiltrados > 0) {
      textoConjunto += ` (${qtdSemValorFiltrados} ${qtdSemValorFiltrados === 1 ? 'item s/ valor' : 'itens s/ valor'})`;
    }
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(textoConjunto, pageWidth - marginX - 3, 38, { align: 'right' });
  } else {
    let textoTotais = `Total: ${totalProdutosExibidos} produtos`;
    if (exibirValor) {
      textoTotais += `  |  Valor Disponível: ${formatarMoedaBR(valorTotalFiltrados)}`;
      if (qtdSemValorFiltrados > 0) {
        textoTotais += ` (${qtdSemValorFiltrados} s/ valor)`;
      }
    }
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(textoTotais, pageWidth - marginX - 3, 34.5, { align: 'right' });
  }

  // 3. Montagem das Colunas e Linhas para A4 Horizontal
  // 1. CÓDIGO (18 mm)
  // 2. DIG (12 mm)
  // 3. DESCRIÇÃO DA MERCADORIA (65 mm)
  // 4. EMBALAGEM (24 mm)
  // 5. ESTOQUE (25 mm)
  // 6. DIAS S/V (18 mm)
  // 7. IDADE (15 mm)
  // 8. INDÚSTRIA / AGÊNCIA (35 mm)
  // 9. VALOR DISPONÍVEL (24 mm)
  const cabecalhosComValor = [
    'CÓDIGO',
    'DIG',
    'DESCRIÇÃO DA MERCADORIA',
    'EMBALAGEM',
    'ESTOQUE',
    'DIAS S/V',
    'IDADE',
    'INDÚSTRIA / AGÊNCIA',
    'VALOR DISP.',
  ];

  const cabecalhosSemValor = [
    'CÓDIGO',
    'DIG',
    'DESCRIÇÃO DA MERCADORIA',
    'EMBALAGEM',
    'ESTOQUE',
    'DIAS S/V',
    'IDADE',
    'INDÚSTRIA / AGÊNCIA',
  ];

  const cabecalhosFinais = exibirValor ? cabecalhosComValor : cabecalhosSemValor;

  const linhasDados = itensProcessados.map((item) => {
    // Indústria / Agência compacta
    let industriaAgenciaTexto = '-';
    if (item.industrias_nomes && item.industrias_nomes.length > 0) {
      industriaAgenciaTexto = item.industrias_nomes[0];
      if (item.agencias_nomes && item.agencias_nomes.length > 0) {
        industriaAgenciaTexto += ` (${item.agencias_nomes[0]})`;
      }
    } else if (item.agencias_nomes && item.agencias_nomes.length > 0) {
      industriaAgenciaTexto = item.agencias_nomes[0];
    }

    const embalagemTexto = item.embalagem_divergente
      ? `${item.embalagem || 'UN'} *`
      : (item.embalagem || 'UN');

    const linhaBase = [
      item.codigo_interno,
      item.digito || '-',
      item.descricao,
      embalagemTexto,
      item.estoque_formatado,
      String(item.dias_sem_venda),
      String(item.idade),
      industriaAgenciaTexto,
    ];

    if (exibirValor) {
      linhaBase.push(item.valor_estoque_formatado);
    }

    return linhaBase;
  });

  // Configuração das larguras exatas em mm para caber perfeitamente no A4 landscape (largura útil: ~273mm)
  const columnStylesConfig: Record<number, any> = exibirValor
    ? {
        0: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
        1: { cellWidth: 12, halign: 'center', fontStyle: 'bold' }, // DIG
        2: { cellWidth: 72, halign: 'left' }, // DESCRIÇÃO
        3: { cellWidth: 26, halign: 'left' }, // EMBALAGEM
        4: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
        5: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, // DIAS S/V
        6: { cellWidth: 16, halign: 'center' }, // IDADE
        7: { cellWidth: 49, halign: 'left' }, // INDÚSTRIA / AGÊNCIA
        8: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }, // VALOR DISPONÍVEL
      }
    : {
        0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
        1: { cellWidth: 14, halign: 'center', fontStyle: 'bold' }, // DIG
        2: { cellWidth: 92, halign: 'left' }, // DESCRIÇÃO
        3: { cellWidth: 30, halign: 'left' }, // EMBALAGEM
        4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
        5: { cellWidth: 22, halign: 'center', fontStyle: 'bold' }, // DIAS S/V
        6: { cellWidth: 18, halign: 'center' }, // IDADE
        7: { cellWidth: 41, halign: 'left' }, // INDÚSTRIA / AGÊNCIA
      };

  autoTable(doc, {
    head: [cabecalhosFinais],
    body: linhasDados,
    startY: 28 + barraAltura + 3,
    margin: { left: marginX, right: marginX, bottom: 12 },
    theme: 'grid',
    showHead: 'everyPage', // Repetição automática do cabeçalho em todas as páginas
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 1.8,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252], // slate-50
    },
    columnStyles: columnStylesConfig,
    didDrawPage: (data) => {
      // Rodapé da página com identificação e numeração
      const pageNumber = data.pageNumber;
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139); // slate-500

      doc.text(
        `ISV | Inteligência de Estoque • Filial 172 — Cascavel`,
        marginX,
        pageHeight - 5
      );

      doc.text(
        `Página ${pageNumber}`,
        pageWidth - marginX,
        pageHeight - 5,
        { align: 'right' }
      );
    },
  });

  // Nome do arquivo padronizado A4
  const dia = String(agora.getDate()).padStart(2, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const ano = agora.getFullYear();
  const hora = String(agora.getHours()).padStart(2, '0');
  const min = String(agora.getMinutes()).padStart(2, '0');

  const sufixoLimite = options.limiteQuantidade && options.limiteQuantidade !== 'TODOS' ? `TOP${options.limiteQuantidade}_` : '';
  const sufixoValor = exibirValor ? 'COM_VALOR' : 'SEM_VALOR';
  const prefixoEntidade = options.nomeEntidade ? `${options.tipoAgrupamento || 'ENTIDADE'}_` : '';
  const nomeArquivo = `ISV_A4_${prefixoEntidade}${sufixoLimite}${dia}-${mes}-${ano}_${hora}${min}_${sufixoValor}.pdf`;

  // Download do PDF
  doc.save(nomeArquivo);
}

// Manter alias retrocompatível para evitar quebras em chamadas antigas
export const gerarRelatorioIsvA3Pdf = gerarRelatorioIsvA4Pdf;

/**
 * Gera relatório A4 específico para uma Indústria ou Agência selecionada no Drilldown
 */
export function gerarRelatorioEntidadeIsvA4Pdf(
  tipo: 'INDUSTRIA' | 'AGENCIA',
  entidadeNome: string,
  subtitulo: string,
  itens: ItemIsv[],
  options?: Partial<IsvPdfOptions>
): void {
  gerarRelatorioIsvA4Pdf(itens, {
    tipoAgrupamento: tipo,
    nomeEntidade: entidadeNome,
    subtituloEntidade: subtitulo,
    tituloFiltro: `${tipo === 'INDUSTRIA' ? 'Indústria' : 'Agência'}: ${entidadeNome}`,
    exibirValorEstoque: options?.exibirValorEstoque !== undefined ? options.exibirValorEstoque : true,
    filialNome: 'Filial 172 — Cascavel',
    fonteOficial: 'BASE DO RUB',
    tipoRelatorioTitulo: tipo === 'INDUSTRIA' ? 'RELATÓRIO POR INDÚSTRIA' : 'RELATÓRIO POR AGÊNCIA',
    ...options,
  });
}
