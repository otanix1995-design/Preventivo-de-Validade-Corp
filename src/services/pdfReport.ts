import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LoteVencimento, ProdutoSMG, RegistroSaeou060 } from '../types';
import { isProdutoPesavel } from './codeParser';
import { productRepository } from './productRepository';
import { calcularProjecaoVencimento, formatarDataBR } from './projection';
import { getProdutos, getVencimentos } from './storage';

export interface PreventivoItem {
  codigo: string;
  digito: string;
  descricao: string;
  embalagem: string;
  comprador: string;
  emb1: number | string;
  emb9: number | string;
  vencimento: string; // DD/MM/YYYY or YYYY-MM-DD
  preco?: number | string | null;
  diasRestantes?: number;
  setor?: string;
  unidade_medida?: string;
}

export interface PreventivoPdfOptions {
  setor?: string; // e.g. "SETOR FRIOS", "FRIOS", "GERAL"
  lider?: string; // e.g. "JOAO", "LIDER JOAO"
  dataReferencia?: Date | string;
  filtroStatus?: string;
  filtroSetor?: string;
  filtroPromotor?: string;
  sourceType?: 'TODOS' | 'VENCIMENTOS' | 'SAEOU060';
  customItems?: PreventivoItem[];
}

/**
 * Formata os valores de estoque EMB1 e EMB9 em uma única string comercial legível.
 * - Produtos pesáveis (KG): EMB1 = Quilos, EMB9 = Gramas (ex: "158 KG + 795 G", "158 KG", "795 G")
 * - Produtos unitários/caixas: EMB1 = Caixas, EMB9 = Unidades avulsas (ex: "5 caixas + 10 unidades", "79 caixas + 1 unidade", "5 caixas", "10 unidades")
 * - Trata singular e plural ("1 caixa", "2 caixas", "1 unidade", "2 unidades")
 * - Omite componentes zerados/vazios
 */
export function formatarEstoquePdf(
  emb1Raw: number | string | undefined | null,
  emb9Raw: number | string | undefined | null,
  embalagem?: string | null,
  unidadeMedida?: string | null
): string {
  const parseNum = (val: number | string | undefined | null): number => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val);
    const clean = String(val).trim().replace(',', '.');
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : Math.round(n);
  };

  const numEmb1 = parseNum(emb1Raw);
  const numEmb9 = parseNum(emb9Raw);

  const isPeso =
    (unidadeMedida && unidadeMedida.trim().toUpperCase() === 'KG') ||
    isProdutoPesavel(embalagem) ||
    /^(KG|QUILO|KILO|PESAVEL|PESO)\b/i.test((embalagem || '').trim());

  if (isPeso) {
    // CASO 2: PRODUTOS CONTROLADOS EM QUILOS E GRAMAS
    const parts: string[] = [];
    if (numEmb1 !== 0) {
      parts.push(`${numEmb1} KG`);
    }
    if (numEmb9 !== 0) {
      parts.push(`${numEmb9} G`);
    }
    if (parts.length === 0) {
      return '0 KG';
    }
    return parts.join(' + ');
  } else {
    // CASO 1: PRODUTOS CONTROLADOS EM CAIXAS E UNIDADES
    const parts: string[] = [];
    if (numEmb1 !== 0) {
      const rotulo = Math.abs(numEmb1) === 1 ? 'caixa' : 'caixas';
      parts.push(`${numEmb1} ${rotulo}`);
    }
    if (numEmb9 !== 0) {
      const rotulo = Math.abs(numEmb9) === 1 ? 'unidade' : 'unidades';
      parts.push(`${numEmb9} ${rotulo}`);
    }
    if (parts.length === 0) {
      return '0';
    }
    return parts.join(' + ');
  }
}

/**
 * Gera o PDF do Preventivo com o layout exato solicitado:
 * - Cabeçalho Topo: Barra Laranja com Data | PREVENTIVO SETOR [SETOR] | LIDER [LIDER]
 * - Cabeçalho Colunas: Amarelo com CÓDIGO | DIG | DESCRIÇÃO MERCADORIA | EMBALAGEM | COMPRADOR | ESTOQUE | VENCIMENTO | PRECO
 * - Grade 1px preta em todas as células
 * - Cores de Vencimento: Vermelho (<= 4 dias / Crítico), Amarelo (5-10 dias), Verde (>= 11 dias)
 * - Rodapé: Página X de Y — Preventivo Setor [Setor]
 */
export function gerarPdfPreventivo(options: PreventivoPdfOptions = {}) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const hoje = options.dataReferencia
    ? (typeof options.dataReferencia === 'string' ? new Date(options.dataReferencia) : options.dataReferencia)
    : new Date();

  const dataRefFormatada = formatarDataBR(hoje.toISOString().slice(0, 10));

  const setorNome = options.setor || 'SETOR FRIOS';
  const liderNome = options.lider || 'LIDER JOAO';
  const tituloHeader = setorNome.toUpperCase().startsWith('PREVENTIVO')
    ? setorNome.toUpperCase()
    : (setorNome.toUpperCase().startsWith('SETOR') ? `PREVENTIVO ${setorNome.toUpperCase()}` : `PREVENTIVO SETOR ${setorNome.toUpperCase()}`);

  const liderHeader = liderNome.toUpperCase().startsWith('LIDER')
    ? liderNome.toUpperCase()
    : `LIDER ${liderNome.toUpperCase()}`;

  // Coleta de itens
  let itens: PreventivoItem[] = [];

  if (options.customItems && options.customItems.length > 0) {
    itens = [...options.customItems];
  } else {
    const produtos = getProdutos();
    const produtosMap = new Map<string, ProdutoSMG>();
    produtos.forEach((p) => {
      produtosMap.set(p.codigo_interno, p);
      if (p.codigo_original) produtosMap.set(p.codigo_original, p);
      if (p.codigo_exibicao) produtosMap.set(p.codigo_exibicao, p);
    });

    const saeouRegistros = productRepository.getSaeou060Registros();
    const lotes = getVencimentos();

    if (options.sourceType === 'SAEOU060' || (saeouRegistros.length > 0 && lotes.length === 0)) {
      // Usar base SAEOU060
      itens = saeouRegistros
        .filter((r) => r.status_saeou !== 'DESCONSIDERADO')
        .map((reg) => {
          const prod = produtosMap.get(reg.codigo_interno) || productRepository.getProductByCode(reg.codigo_interno);
          let diasRest: number | undefined = undefined;
          if (reg.data_vencimento) {
            const vcto = new Date(reg.data_vencimento + 'T00:00:00');
            diasRest = Math.floor((vcto.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
          }

          const compradorStr = prod?.comprador_filial || prod?.comprador_matriz || '0204 - DOUGLAS COMACHIO';

          return {
            codigo: reg.codigo_interno,
            digito: reg.digito || prod?.digito || '',
            descricao: (prod?.descricao || reg.descricao || '').toUpperCase(),
            embalagem: reg.embalagem || prod?.embalagem || 'UN',
            comprador: compradorStr,
            emb1: prod?.estoque_emb1 ?? 0,
            emb9: prod?.estoque_emb9 ?? 0,
            vencimento: formatarDataBR(reg.data_vencimento),
            preco: reg.preco_trabalhado || prod?.vendas_preco || null,
            diasRestantes: diasRest,
            setor: prod?.setor_fisico || prod?.setor_balanco || 'SETOR FRIOS',
            unidade_medida: prod?.unidade_medida,
          };
        });
    } else {
      // Usar lotes cadastrados no controle
      itens = lotes.map((lote) => {
        const prod = produtosMap.get(lote.codigo_interno) || productRepository.getProductByCode(lote.codigo_interno);
        let diasRest: number | undefined = undefined;
        if (lote.data_validade) {
          const vcto = new Date(lote.data_validade + 'T00:00:00');
          diasRest = Math.floor((vcto.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
        }

        const compradorStr = prod?.comprador_filial || prod?.comprador_matriz || '0204 - DOUGLAS COMACHIO';

        return {
          codigo: lote.codigo_interno,
          digito: lote.digito || prod?.digito || '',
          descricao: (lote.descricao_produto || prod?.descricao || '').toUpperCase(),
          embalagem: lote.embalagem || prod?.embalagem || 'UN',
          comprador: compradorStr,
          emb1: prod?.estoque_emb1 ?? 0,
          emb9: prod?.estoque_emb9 ?? 0,
          vencimento: formatarDataBR(lote.data_validade),
          preco: lote.preco_trabalhado || prod?.vendas_preco || null,
          diasRestantes: diasRest,
          setor: prod?.setor_fisico || prod?.setor_balanco || 'SETOR FRIOS',
          unidade_medida: prod?.unidade_medida,
        };
      });
    }
  }

  // Filtragem opcional por setor se especificado
  if (options.filtroSetor && options.filtroSetor !== 'TODOS') {
    const fs = options.filtroSetor.toUpperCase();
    itens = itens.filter((it) => (it.setor || '').toUpperCase().includes(fs) || (it.descricao || '').toUpperCase().includes(fs));
  }

  // Ordenação por data de vencimento (dias restantes)
  itens.sort((a, b) => {
    const da = a.diasRestantes ?? 9999;
    const db = b.diasRestantes ?? 9999;
    return da - db;
  });

  // Mapeamento dos dias restantes por linha para estilização exata de cores
  const rowDiasRestantesMap = new Map<number, number | undefined>();
  itens.forEach((it, idx) => {
    rowDiasRestantesMap.set(idx, it.diasRestantes);
  });

  const tableRows = itens.map((it) => {
    let precoFormatado = '-';
    if (it.preco !== null && it.preco !== undefined && it.preco !== '' && it.preco !== 0) {
      const pNum = typeof it.preco === 'number' ? it.preco : parseFloat(String(it.preco).replace(',', '.'));
      if (!isNaN(pNum) && pNum > 0) {
        precoFormatado = `R$ ${pNum.toFixed(2).replace('.', ',')}`;
      }
    }

    const estoqueFormatado = formatarEstoquePdf(it.emb1, it.emb9, it.embalagem, it.unidade_medida);

    return [
      it.codigo,
      it.digito,
      it.descricao,
      it.embalagem,
      it.comprador,
      estoqueFormatado,
      it.vencimento,
      precoFormatado,
    ];
  });

  const totalPagesExp = '{total_pages_count_string}';
  const setorRodape = setorNome.toUpperCase().replace('PREVENTIVO', '').replace('SETOR', '').trim();
  const rodapeTexto = `Preventivo Setor ${setorRodape || 'Frios'}`;

  // 1. Desenha o Cabeçalho Superior Laranja (Topo da Página 1)
  // Conforme solicitado: UMA ÚNICA BARRA LARANJA CONTÍNUA SEM LINHAS DE COLUNAS DIVIDINDO
  // Apenas a borda preta externa ao redor de toda a barra
  const bannerY = 8;
  const bannerHeight = 7.2;
  const bannerWidth = 281; // Largura total de margem a margem (8mm a 289mm)
  const bannerGap = 1.6; // Pequeno espaço entre o cabeçalho laranja e a tabela amarela

  // 1.1 DESENHA UM ÚNICO RETÂNGULO LARANJA CONTÍNUO (SEM LINHAS VERTICAIS INTERNAS)
  doc.setFillColor(245, 130, 32); // Laranja oficial (#F58220)
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.rect(8, bannerY, bannerWidth, bannerHeight, 'FD');

  // 1.2 DESENHA OS TEXTOS EM PRETO DENTRO DA BARRA
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);

  // Texto 1: Data de Referência (posicionada na esquerda)
  doc.setFontSize(8.5);
  doc.text(dataRefFormatada, 8 + 13, bannerY + 4.8, { align: 'center' });

  // Texto 2: Título do Preventivo (centralizado na barra)
  doc.setFontSize(9.5);
  doc.text(tituloHeader, 8 + (bannerWidth / 2), bannerY + 4.8, { align: 'center' });

  // Texto 3: Líder Responsável (posicionado na direita)
  doc.setFontSize(8.5);
  doc.text(liderHeader, 289 - 28, bannerY + 4.8, { align: 'center' });

  // 2. Cabeçalho das Colunas da Planilha (Amarelo vibrante)
  // Unifica EMB1 e EMB9 na coluna única ESTOQUE
  const head: any[] = [
    [
      { content: 'CÓDIGO', styles: { halign: 'center', valign: 'middle' } },
      { content: 'DIG', styles: { halign: 'center', valign: 'middle' } },
      { content: 'DESCRIÇÃO MERCADORIA', styles: { halign: 'left', valign: 'middle' } },
      { content: 'EMBALAGEM', styles: { halign: 'left', valign: 'middle' } },
      { content: 'COMPRADOR', styles: { halign: 'left', valign: 'middle' } },
      { content: 'ESTOQUE', styles: { halign: 'center', valign: 'middle' } },
      { content: 'VENCIMENTO', styles: { halign: 'center', valign: 'middle' } },
      { content: 'PRECO', styles: { halign: 'center', valign: 'middle' } },
    ],
  ];

  // A tabela começa após a barra laranja + espaçamento de 1.6mm na Página 1
  const tableStartY = bannerY + bannerHeight + bannerGap;

  autoTable(doc, {
    startY: tableStartY,
    margin: { top: 8, bottom: 12, left: 8, right: 8 },
    head,
    body: tableRows,
    theme: 'grid', // Grade oficial completa com linhas pretas finas em todas as células
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: { top: 1.4, bottom: 1.4, left: 1.5, right: 1.5 },
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [255, 235, 59], // Amarelo oficial (#FFEB3B)
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 7.8,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 },
    },
    columnStyles: {
      0: { cellWidth: 15, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
      1: { cellWidth: 9, halign: 'center', fontStyle: 'bold' },  // DIG
      2: { cellWidth: 78, halign: 'left' },                      // DESCRIÇÃO MERCADORIA
      3: { cellWidth: 36, halign: 'left' },                      // EMBALAGEM
      4: { cellWidth: 50, halign: 'left' },                      // COMPRADOR
      5: { cellWidth: 36, halign: 'center' },                    // ESTOQUE (unificado)
      6: { cellWidth: 31, halign: 'center', fontStyle: 'bold' }, // VENCIMENTO
      7: { cellWidth: 26, halign: 'center', fontStyle: 'bold' }, // PRECO
    },
    didParseCell: (data) => {
      // Garante borda preta sólida 0.2mm em todas as seções
      data.cell.styles.lineColor = [0, 0, 0];
      data.cell.styles.lineWidth = 0.2;

      if (data.section === 'head') {
        data.cell.styles.fillColor = [255, 235, 59]; // Fundo amarelo vibrante
        data.cell.styles.textColor = [0, 0, 0];       // Texto preto nítido
        data.cell.styles.fontStyle = 'bold';
      } else if (data.section === 'body') {
        data.cell.styles.textColor = [0, 0, 0];

        // Destaque de cor na coluna VENCIMENTO (agora índice 6 após a unificação do ESTOQUE)
        if (data.column.index === 6) {
          data.cell.styles.fontStyle = 'bold';
          const dias = rowDiasRestantesMap.get(data.row.index);

          if (dias !== undefined && dias !== null) {
            if (dias <= 4) {
              // Vermelho (vencido ou até 4 dias - crítico: ex. 01/09 a 04/09)
              data.cell.styles.fillColor = [218, 41, 28];
              data.cell.styles.textColor = [255, 255, 255];
            } else if (dias >= 5 && dias <= 10) {
              // Amarelo (alerta médio: ex. 05/09 a 10/09)
              data.cell.styles.fillColor = [254, 219, 0];
              data.cell.styles.textColor = [0, 0, 0];
            } else if (dias >= 11) {
              // Verde (controlado / normal: 11/09 em diante)
              data.cell.styles.fillColor = [0, 138, 60];
              data.cell.styles.textColor = [255, 255, 255];
            }
          }
        }
      }
    },
    didDrawPage: (data) => {
      // Rodapé centralizado: Página X de Y — Preventivo Setor Frios
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(80, 80, 80);
      const str = `Página ${data.pageNumber} de ${totalPagesExp} — ${rodapeTexto}`;
      doc.text(str, 148.5, 204, { align: 'center' });
    },
  });

  if (typeof (doc as any).putTotalPages === 'function') {
    (doc as any).putTotalPages(totalPagesExp);
  }

  const cleanSetor = setorNome.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Preventivo_${cleanSetor}_${hoje.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

export function gerarPdfVencimentos(
  filtroStatus?: string,
  tituloPersonalizado = 'Relatório de Controle de Vencimentos'
) {
  // Redireciona para gerarPdfPreventivo para garantir layout oficial unificado
  gerarPdfPreventivo({
    setor: 'SETOR FRIOS',
    lider: 'LIDER JOAO',
    filtroStatus,
  });
}

export function exportarCsvVencimentos() {
  const lotes = getVencimentos();
  const produtos = getProdutos();
  const produtosMap = new Map<string, ProdutoSMG>();
  produtos.forEach((p) => produtosMap.set(p.codigo_interno, p));
  const hoje = new Date();

  const headers = [
    'Codigo_Original',
    'Codigo_Interno',
    'Digito',
    'Codigo_Exibicao',
    'Descricao',
    'Embalagem',
    'Data_Validade',
    'Dias_Restantes',
    'Qtde_Lote_Unidades',
    'Vendas_30_Dias',
    'Media_Diaria',
    'Dias_Sem_Venda',
    'Saida_Projetada',
    'Sobra_Projetada',
    'Status',
    'Enviar_Comprador',
    'Observacao',
  ];

  const rows = lotes.map((lote) => {
    const produto = produtosMap.get(lote.codigo_interno);
    const projecao = calcularProjecaoVencimento(lote, produto, hoje);

    return [
      `"${produto?.codigo_original || lote.codigo_interno}"`,
      `"${lote.codigo_interno}"`,
      `"${lote.digito || ''}"`,
      `"${lote.codigo_exibicao || lote.codigo_interno}"`,
      `"${(lote.descricao_produto || produto?.descricao || '').replace(/"/g, '""')}"`,
      `"${lote.embalagem || produto?.embalagem || ''}"`,
      `"${lote.data_validade}"`,
      projecao.dias_restantes,
      lote.quantidade_total_unidades,
      produto?.vendas_qtde_30d ?? 0,
      projecao.media_diaria_30d,
      produto?.dias_sem_venda ?? 0,
      projecao.saida_projetada,
      projecao.sobra_projetada,
      `"${projecao.status}"`,
      lote.enviar_ao_comprador ? 'SIM' : 'NAO',
      `"${(lote.observacao || '').replace(/"/g, '""')}"`,
    ].join(';');
  });

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Vencimentos_Filial172_${hoje.toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

