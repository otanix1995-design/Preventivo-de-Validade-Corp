import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ItemIsv } from '../types';
import { formatarMoedaBR } from './deviceId';

export interface IsvPdfOptions {
  tituloFiltro?: string; // ex: "Geral da Loja", "Indústria: DANONE", "Promotor: JOAO SILVA"
  tipoAgrupamento?: 'GERAL' | 'INDUSTRIA' | 'PROMOTOR' | 'AGENCIA';
  nomeEntidade?: string;
  subtituloEntidade?: string; // ex: "CNPJ: 01.123.456/0001-88 - DANONE LTDA" ou "Agência: SPEED PROMO"
  exibirValorEstoque: boolean; // Padrão: true. Quando false, remove a coluna 11 e todos os totais em R$
  filialNome?: string;
  limiteQuantidade?: number | 'TODOS'; // Novo: Top 30, Top 50, Top 100 ou 'TODOS'
  fonteOficial?: string; // Ex: "PLANILHA OPERACIONAL OFICIAL ISV"
  filtrosDescricao?: string; // Descrição de filtros combinados ativos (Setor, Idade, Dias sem venda, etc.)
}

/**
 * Gera relatório oficial sob demanda do módulo ISV — ITENS SEM VENDA
 * no formato padrão aprovado A3 Horizontal (Paisagem).
 */
export function gerarRelatorioIsvA3Pdf(
  itens: ItemIsv[],
  options: IsvPdfOptions
): void {
  // Aplicar seleção de limite de itens (ex: 30 maiores produtos)
  const itensProcessados =
    options.limiteQuantidade && options.limiteQuantidade !== 'TODOS'
      ? itens.slice(0, Number(options.limiteQuantidade))
      : itens;

  // Inicializa documento em A3 Horizontal (420mm x 297mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a3',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // ~420 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // ~297 mm
  const marginX = 14;

  const agora = new Date();
  const dataHoraEmissao = agora.toLocaleString('pt-BR');
  const filial = options.filialNome || 'FILIAL 172 - CASCAVEL';
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

  // 1. Cabeçalho Principal (Faixa Azul Escuro Corporativo)
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Faixa de acento azul royal
  doc.setFillColor(29, 78, 216); // blue-700
  doc.rect(0, 28, pageWidth, 2, 'F');

  // Título e Identificação da Filial
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('CONTROLE DE VENCIMENTOS & PREVENÇÃO DE PERDAS', marginX, 10);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(191, 219, 254); // blue-200
  doc.text(`${filial} • SISTEMA OPERACIONAL`, marginX, 16);

  // Título do Módulo Centralizado
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);

  let tituloPrincipal = 'ISV — ITENS SEM VENDA';
  if (options.tipoAgrupamento === 'INDUSTRIA' && options.nomeEntidade) {
    tituloPrincipal = `INDÚSTRIA: ${options.nomeEntidade.toUpperCase()}`;
  } else if (options.tipoAgrupamento === 'PROMOTOR' && options.nomeEntidade) {
    tituloPrincipal = `PROMOTOR: ${options.nomeEntidade.toUpperCase()}`;
  } else if (options.tipoAgrupamento === 'AGENCIA' && options.nomeEntidade) {
    tituloPrincipal = `AGÊNCIA: ${options.nomeEntidade.toUpperCase()}`;
  }

  doc.text(tituloPrincipal, pageWidth / 2, 13, { align: 'center' });

  // Subtítulo da Entidade (CNPJ, Razão Social ou Agência)
  if (options.subtituloEntidade) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(226, 232, 240);
    doc.text(options.subtituloEntidade, pageWidth / 2, 19, { align: 'center' });
  }

  // Data/Hora e Identificação do Documento (Direita)
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text(`Emissão: ${dataHoraEmissao}`, pageWidth - marginX, 10, { align: 'right' });
  doc.text('FORMATO OFICIAL A3 HORIZONTAL', pageWidth - marginX, 16, { align: 'right' });

  // 2. Barra de Resumo da Seleção / Filtros (Abaixo do cabeçalho)
  const isTopRanking = options.limiteQuantidade && options.limiteQuantidade !== 'TODOS';
  const barraAltura = isTopRanking || options.filtrosDescricao ? 14 : 11;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.3);
  doc.rect(marginX, 33, pageWidth - marginX * 2, barraAltura, 'FD');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  let textoFiltro = options.tituloFiltro ? `FILTRO: ${options.tituloFiltro.toUpperCase()}` : 'FILTRO: GERAL DA LOJA';
  if (options.fonteOficial) {
    textoFiltro += ` • [FONTE: ${options.fonteOficial.toUpperCase()}]`;
  }
  if (isTopRanking) {
    textoFiltro += ` • [TOP ${options.limiteQuantidade} MAIORES PRODUTOS]`;
  }
  if (options.filtrosDescricao) {
    textoFiltro += ` • [${options.filtrosDescricao.toUpperCase()}]`;
  }
  doc.text(textoFiltro, marginX + 4, 38);

  // Totais na barra
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);

  if (isTopRanking) {
    const textoTop = `VALOR DOS ${totalProdutosExibidos} PRODUTOS EXIBIDOS: ${formatarMoedaBR(valorTotalExibidos)}`;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(textoTop, pageWidth - marginX - 4, 38.5, { align: 'right' });

    let textoConjunto = `VALOR TOTAL DE TODOS OS ${totalProdutosFiltrados} PRODUTOS FILTRADOS: ${formatarMoedaBR(valorTotalFiltrados)}`;
    if (qtdSemValorFiltrados > 0) {
      textoConjunto += `  *(Total parcial: ${qtdSemValorFiltrados} ${qtdSemValorFiltrados === 1 ? 'item sem custo' : 'itens sem custo'})`;
    }
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(textoConjunto, pageWidth - marginX - 4, 43.5, { align: 'right' });
  } else {
    let textoTotais = `TOTAL DE PRODUTOS: ${totalProdutosExibidos}`;
    if (exibirValor) {
      textoTotais += `   |   VALOR TOTAL DO ESTOQUE FILTRADO: ${formatarMoedaBR(valorTotalFiltrados)}`;
      if (qtdSemValorFiltrados > 0) {
        textoTotais += `  *(Parcial: ${qtdSemValorFiltrados} sem custo)`;
      }
    }
    doc.text(textoTotais, pageWidth - marginX - 4, 40, { align: 'right' });
  }

  // 3. Montagem da Tabela com as 11 ou 10 Colunas Oficiais
  // ORDEM EXATA DAS COLUNAS:
  // 1. CÓDIGO
  // 2. DIG
  // 3. DESCRIÇÃO
  // 4. EMBALAGEM
  // 5. ESTOQUE
  // 6. DIAS SEM VENDA
  // 7. IDADE
  // 8. INDÚSTRIA
  // 9. PROMOTOR
  // 10. AGÊNCIA
  // 11. VALOR DO ESTOQUE (opcional conforme exibirValor)

  const cabecalhosCompletos = [
    'CÓDIGO',
    'DIG',
    'DESCRIÇÃO',
    'EMBALAGEM',
    'ESTOQUE',
    'DIAS SEM VENDA',
    'IDADE',
    'INDÚSTRIA',
    'PROMOTOR',
    'AGÊNCIA',
    'VALOR DO ESTOQUE',
  ];

  const cabecalhosSemValor = cabecalhosCompletos.slice(0, 10);
  const cabecalhosFinais = exibirValor ? cabecalhosCompletos : cabecalhosSemValor;

  const linhasDados = itensProcessados.map((item) => {
    // 8. INDÚSTRIA: Formatação compacta no PDF A3 para evitar linhas gigantes
    let industriaTexto = 'Indústria não vinculada';
    if (item.industrias_nomes.length === 1) {
      industriaTexto = item.industrias_nomes[0];
    } else if (item.industrias_nomes.length > 1) {
      industriaTexto = `Múltiplas indústrias (${item.industrias_nomes.length})`;
    }

    // 9. PROMOTOR: Formatação compacta
    let promotorTexto = 'Sem promotor';
    if (item.promotores_nomes.length === 1) {
      promotorTexto = item.promotores_nomes[0];
    } else if (item.promotores_nomes.length > 1) {
      promotorTexto = `Múltiplos (${item.promotores_nomes.length})`;
    }

    // 10. AGÊNCIA: Formatação compacta
    let agenciaTexto = '-';
    if (item.agencias_nomes.length === 1) {
      agenciaTexto = item.agencias_nomes[0];
    } else if (item.agencias_nomes.length > 1) {
      agenciaTexto = `Múltiplas (${item.agencias_nomes.length})`;
    }

    const descTexto = item.setor_operacional
      ? `[${item.setor_operacional}] ${item.descricao}`
      : item.descricao;

    const embalagemTexto = item.embalagem_divergente
      ? `${item.embalagem || 'UN'} (DIVERG.)`
      : (item.embalagem || 'UN');

    const linhaBase = [
      item.codigo_interno,
      item.digito || '-',
      descTexto,
      embalagemTexto,
      item.estoque_formatado,
      String(item.dias_sem_venda),
      String(item.idade),
      industriaTexto,
      promotorTexto,
      agenciaTexto,
    ];

    if (exibirValor) {
      linhaBase.push(item.valor_estoque_formatado);
    }

    return linhaBase;
  });

  // Larguras das colunas proporcionais para A3 (largura útil ~392 mm)
  const columnStylesConfig: Record<number, any> = exibirValor
    ? {
        0: { cellWidth: 22, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
        1: { cellWidth: 14, halign: 'center', fontStyle: 'bold' }, // DIG
        2: { cellWidth: 92, halign: 'left' }, // DESCRIÇÃO
        3: { cellWidth: 32, halign: 'left' }, // EMBALAGEM
        4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
        5: { cellWidth: 26, halign: 'center', fontStyle: 'bold' }, // DIAS SEM VENDA
        6: { cellWidth: 20, halign: 'center' }, // IDADE
        7: { cellWidth: 48, halign: 'left' }, // INDÚSTRIA
        8: { cellWidth: 40, halign: 'left' }, // PROMOTOR
        9: { cellWidth: 36, halign: 'left' }, // AGÊNCIA
        10: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }, // VALOR DO ESTOQUE
      }
    : {
        0: { cellWidth: 24, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
        1: { cellWidth: 16, halign: 'center', fontStyle: 'bold' }, // DIG
        2: { cellWidth: 104, halign: 'left' }, // DESCRIÇÃO
        3: { cellWidth: 36, halign: 'left' }, // EMBALAGEM
        4: { cellWidth: 36, halign: 'right', fontStyle: 'bold' }, // ESTOQUE
        5: { cellWidth: 28, halign: 'center', fontStyle: 'bold' }, // DIAS SEM VENDA
        6: { cellWidth: 24, halign: 'center' }, // IDADE
        7: { cellWidth: 54, halign: 'left' }, // INDÚSTRIA
        8: { cellWidth: 44, halign: 'left' }, // PROMOTOR
        9: { cellWidth: 40, halign: 'left' }, // AGÊNCIA
      };

  autoTable(doc, {
    head: [cabecalhosFinais],
    body: linhasDados,
    startY: 47,
    margin: { left: marginX, right: marginX, bottom: 15 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252], // slate-50
    },
    columnStyles: columnStylesConfig,
    didDrawPage: (data) => {
      // Rodapé da página com numeração
      const pageNumber = data.pageNumber;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139); // slate-500

      doc.text(
        `Controle de Vencimentos • Filial 172 Cascavel — Relatório ISV Itens Sem Venda (A3)`,
        marginX,
        pageHeight - 7
      );

      doc.text(
        `Página ${pageNumber}`,
        pageWidth - marginX,
        pageHeight - 7,
        { align: 'right' }
      );
    },
  });

  // Nome do arquivo padronizado
  const dia = String(agora.getDate()).padStart(2, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const ano = agora.getFullYear();
  const hora = String(agora.getHours()).padStart(2, '0');
  const min = String(agora.getMinutes()).padStart(2, '0');

  const sufixoLimite = options.limiteQuantidade && options.limiteQuantidade !== 'TODOS' ? `TOP${options.limiteQuantidade}_` : '';
  const sufixoValor = exibirValor ? 'COM_VALOR' : 'SEM_VALOR';
  const nomeArquivo = `RELATORIO_ISV_A3_${sufixoLimite}${dia}-${mes}-${ano}_${hora}${min}_${sufixoValor}.pdf`;

  // Download do PDF
  doc.save(nomeArquivo);
}
