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
}

/**
 * Gera relatório oficial sob demanda do módulo ISV — ITENS SEM VENDA
 * no formato padrão aprovado A3 Horizontal (Paisagem).
 */
export function gerarRelatorioIsvA3Pdf(
  itens: ItemIsv[],
  options: IsvPdfOptions
): void {
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

  // Totalizadores garantindo unicidade de produtos
  const totalProdutos = itens.length;
  let valorTotal = 0;
  let temValorValido = false;

  itens.forEach((it) => {
    if (it.valor_estoque !== null) {
      valorTotal += it.valor_estoque;
      temValorValido = true;
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
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.3);
  doc.rect(marginX, 33, pageWidth - marginX * 2, 11, 'FD');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  const textoFiltro = options.tituloFiltro ? `FILTRO ATIVO: ${options.tituloFiltro.toUpperCase()}` : 'FILTRO ATIVO: GERAL DA LOJA';
  doc.text(textoFiltro, marginX + 4, 40);

  // Totais na barra
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  let textoTotais = `TOTAL DE PRODUTOS: ${totalProdutos}`;
  if (exibirValor) {
    textoTotais += `   |   VALOR TOTAL DO ESTOQUE PARADO: ${temValorValido ? formatarMoedaBR(valorTotal) : '-'}`;
  }
  doc.text(textoTotais, pageWidth - marginX - 4, 40, { align: 'right' });

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

  const linhasDados = itens.map((item) => {
    const industriaTexto = item.industrias_nomes.length > 0 ? item.industrias_nomes.join(' • ') : '-';
    const promotorTexto = item.promotores_nomes.length > 0 ? item.promotores_nomes.join(' • ') : '-';
    const agenciaTexto = item.agencias_nomes.length > 0 ? item.agencias_nomes.join(' • ') : '-';

    const linhaBase = [
      item.codigo_interno,
      item.digito || '-',
      item.descricao,
      item.embalagem || 'UN',
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

  const sufixoValor = exibirValor ? 'COM_VALOR' : 'SEM_VALOR';
  const nomeArquivo = `RELATORIO_ISV_A3_${dia}-${mes}-${ano}_${hora}${min}_${sufixoValor}.pdf`;

  // Download do PDF
  doc.save(nomeArquivo);
}
