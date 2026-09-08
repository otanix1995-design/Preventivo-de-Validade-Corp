import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LoteVencimento, ProdutoSMG, RegistroSaeou060 } from '../types';
import { isProdutoPesavel, parseEmbalagem } from './codeParser';
import { productRepository } from './productRepository';
import { calcularProjecaoVencimento, formatarDataBR } from './projection';
import { getProdutos, getVencimentos } from './storage';

export interface PreventivoItem {
  codigo: string;
  digito: string;
  descricao: string;
  embalagem: string;
  comprador: string;
  quantidadeCadastrada?: number; // Qtd do lote que está vencendo (apontada/cadastrada)
  emb1: number | string;
  emb9: number | string;
  vencimento: string; // DD/MM/YYYY or YYYY-MM-DD
  preco?: number | string | null;
  diasRestantes?: number;
  setor?: string;
  unidade_medida?: string;
  enviarParaComprador?: boolean;
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
 * Desenha um ícone de alerta triangular (⚠) vetorizado e nítido em qualquer resolução/impressão.
 */
export function desenharIconeAlerta(
  doc: jsPDF,
  centerX: number,
  centerY: number,
  size: number = 2.4
) {
  const half = size / 2;
  // Fundo do triângulo de alerta em laranja/âmbar escuro com borda fina
  doc.setFillColor(215, 65, 0);
  doc.setDrawColor(160, 40, 0);
  doc.setLineWidth(0.12);
  doc.triangle(
    centerX,
    centerY - half,
    centerX - half,
    centerY + half,
    centerX + half,
    centerY + half,
    'FD'
  );
  // Exclamação branca nítida no centro
  doc.setFillColor(255, 255, 255);
  doc.rect(centerX - 0.15, centerY - half * 0.35, 0.3, half * 0.65, 'F');
  doc.circle(centerX, centerY + half * 0.65, 0.18, 'F');
}

/**
 * Formata a quantidade cadastrada/apontada do lote que está vencendo.
 * Mostra as unidades exatas e a equivalência em caixas quando aplicável.
 */
export function formatarQtdCadastradaPdf(
  qtd?: number | null,
  embalagem?: string | null,
  unidadeMedida?: string | null
): string {
  if (qtd === undefined || qtd === null || isNaN(qtd)) return '-';
  const num = Math.round(qtd);
  if (num <= 0) return '0 UN';

  const isPeso =
    (unidadeMedida && unidadeMedida.trim().toUpperCase() === 'KG') ||
    isProdutoPesavel(embalagem) ||
    /^(KG|QUILO|KILO|PESAVEL|PESO)\b/i.test((embalagem || '').trim());

  if (isPeso) {
    return `${num} KG`;
  }

  const embData = parseEmbalagem(embalagem || '');
  if (embData.fator && embData.fator > 1) {
    const cx = Math.floor(num / embData.fator);
    const un = num % embData.fator;
    if (cx > 0 && un > 0) {
      return `${num} UN (${cx}cx+${un})`;
    } else if (cx > 0) {
      return `${num} UN (${cx}cx)`;
    }
  }
  return `${num} UN`;
}

/**
 * Formata os valores de estoque EMB1 e EMB9 em uma única string comercial legível.
 * - Produtos pesáveis (KG): EMB1 = Quilos, EMB9 = Gramas (ex: "158 KG + 795 G", "158 KG", "795 G")
 * - Produtos unitários/caixas: EMB1 = Caixas (CX), EMB9 = Unidades avulsas (UN) (ex: "5 CX + 10 UN", "79 CX + 1 UN", "5 CX", "10 UN")
 * - Omite componentes zerados/vazios
 * - Não soma caixas com unidades nem quilos com gramas
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
    // CASO 1: PRODUTOS CONTROLADOS EM CAIXAS E UNIDADES (CX + UN)
    const parts: string[] = [];
    if (numEmb1 !== 0) {
      parts.push(`${numEmb1} CX`);
    }
    if (numEmb9 !== 0) {
      parts.push(`${numEmb9} UN`);
    }
    if (parts.length === 0) {
      return '0';
    }
    return parts.join(' + ');
  }
}

/**
 * Gera o PDF do Preventivo com o layout oficial e destaque para produtos enviados ao comprador:
 * - Cabeçalho Topo: Barra Laranja com Data | PREVENTIVO SETOR [SETOR] | LIDER [LIDER]
 * - Legenda discreta: [⚠] CRÍTICO = PRODUTO ENVIADO AO COMPRADOR
 * - Cabeçalho Colunas: Amarelo com CÓDIGO | DIG | DESCRIÇÃO MERCADORIA | EMBALAGEM | COMPRADOR | ESTOQUE | VENCIMENTO | PREÇO | STATUS
 * - Linha Crítica (enviar_ao_comprador): Fundo LARANJA CLARO ocupando 100% da linha de CÓDIGO até STATUS
 * - Coluna STATUS: "CRÍTICO" com ícone de alerta vetorizado para itens críticos, vazio para itens normais
 * - Grade 1px preta em todas as células sem espaços brancos
 * - Rodapé: Página X de Y — Preventivo Setor [Setor] + Legenda no rodapé
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
    const lotesMap = new Map<string, LoteVencimento>();
    lotes.forEach((l) => {
      lotesMap.set(l.id, l);
      lotesMap.set(`${l.codigo_interno}_${l.data_validade}`, l);
    });

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
          const linkedLote = reg.vencimento_id_vinculado
            ? lotesMap.get(reg.vencimento_id_vinculado)
            : lotesMap.get(`${reg.codigo_interno}_${reg.data_vencimento}`);
          const isEnviarComprador = Boolean(
            linkedLote?.enviar_ao_comprador || linkedLote?.status_customizado === 'ENVIAR_AO_COMPRADOR'
          );

          return {
            codigo: reg.codigo_interno,
            digito: reg.digito || prod?.digito || '',
            descricao: (prod?.descricao || reg.descricao || '').toUpperCase(),
            embalagem: reg.embalagem || prod?.embalagem || 'UN',
            comprador: compradorStr,
            quantidadeCadastrada: reg.quantidade,
            emb1: prod?.estoque_emb1 ?? 0,
            emb9: prod?.estoque_emb9 ?? 0,
            vencimento: formatarDataBR(reg.data_vencimento),
            preco: reg.preco_trabalhado || prod?.vendas_preco || null,
            diasRestantes: diasRest,
            setor: prod?.setor_fisico || prod?.setor_balanco || 'SETOR FRIOS',
            unidade_medida: prod?.unidade_medida,
            enviarParaComprador: isEnviarComprador,
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
        const isEnviarComprador = Boolean(
          lote.enviar_ao_comprador || lote.status_customizado === 'ENVIAR_AO_COMPRADOR'
        );

        return {
          codigo: lote.codigo_interno,
          digito: lote.digito || prod?.digito || '',
          descricao: (lote.descricao_produto || prod?.descricao || '').toUpperCase(),
          embalagem: lote.embalagem || prod?.embalagem || 'UN',
          comprador: compradorStr,
          quantidadeCadastrada: lote.quantidade_total_unidades,
          emb1: prod?.estoque_emb1 ?? 0,
          emb9: prod?.estoque_emb9 ?? 0,
          vencimento: formatarDataBR(lote.data_validade),
          preco: lote.preco_trabalhado || prod?.vendas_preco || null,
          diasRestantes: diasRest,
          setor: prod?.setor_fisico || prod?.setor_balanco || 'SETOR FRIOS',
          unidade_medida: prod?.unidade_medida,
          enviarParaComprador: isEnviarComprador,
        };
      });
    }
  }

  // Filtragem opcional por setor se especificado
  if (options.filtroSetor && options.filtroSetor !== 'TODOS') {
    const fs = options.filtroSetor.toUpperCase();
    itens = itens.filter((it) => (it.setor || '').toUpperCase().includes(fs) || (it.descricao || '').toUpperCase().includes(fs));
  }

  // Filtragem opcional por status se especificado
  if (options.filtroStatus && options.filtroStatus !== 'TODOS') {
    switch (options.filtroStatus) {
      case 'ENVIAR_AO_COMPRADOR':
        itens = itens.filter((it) => it.enviarParaComprador);
        break;
      case 'ATE_3_DIAS':
        itens = itens.filter((it) => (it.diasRestantes ?? 999) <= 3);
        break;
      case 'ATE_7_DIAS':
        itens = itens.filter((it) => (it.diasRestantes ?? 999) <= 7);
        break;
      case 'ATE_15_DIAS':
        itens = itens.filter((it) => (it.diasRestantes ?? 999) <= 15);
        break;
      case 'ATE_30_DIAS':
        itens = itens.filter((it) => (it.diasRestantes ?? 999) <= 30);
        break;
      case 'CRITICO':
        itens = itens.filter((it) => (it.diasRestantes ?? 999) <= 4 || it.enviarParaComprador);
        break;
      case 'NORMAL':
        itens = itens.filter((it) => (it.diasRestantes ?? 999) > 10 && !it.enviarParaComprador);
        break;
      default:
        break;
    }
  }

  // Ordenação por data de vencimento (dias restantes) preservada
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

  // Construção das linhas da tabela conforme estrutura exata:
  // CÓDIGO | DIG | DESCRIÇÃO MERCADORIA | EMBALAGEM | COMPRADOR | ESTOQUE | VENCIMENTO | PREÇO | STATUS
  const tableRows = itens.map((it) => {
    let precoFormatado = '-';
    if (it.preco !== null && it.preco !== undefined && it.preco !== '' && it.preco !== 0) {
      const pNum = typeof it.preco === 'number' ? it.preco : parseFloat(String(it.preco).replace(',', '.'));
      if (!isNaN(pNum) && pNum > 0) {
        precoFormatado = `R$ ${pNum.toFixed(2).replace('.', ',')}`;
      }
    }

    const estoqueLojaFormatado = formatarEstoquePdf(it.emb1, it.emb9, it.embalagem, it.unidade_medida);
    // Produto crítico: "CRÍTICO" (com ícone triangular vetorizado desenhado via didDrawCell)
    // Produto normal: vazio para manter o relatório limpo
    const statusText = it.enviarParaComprador ? 'CRÍTICO' : '';

    return [
      it.codigo,
      it.digito,
      it.descricao,
      it.embalagem,
      it.comprador,
      estoqueLojaFormatado,
      it.vencimento,
      precoFormatado,
      statusText,
    ];
  });

  const totalPagesExp = '{total_pages_count_string}';
  const setorRodape = setorNome.toUpperCase().replace('PREVENTIVO', '').replace('SETOR', '').trim();
  const rodapeTexto = `Preventivo Setor ${setorRodape || 'Frios'}`;

  // 1. Desenha o Cabeçalho Superior Laranja (Topo da Página 1)
  const bannerY = 7;
  const bannerHeight = 6.8;
  const bannerWidth = 281; // Largura total de margem a margem (8mm a 289mm)

  // 1.1 DESENHA UM ÚNICO RETÂNGULO LARANJA CONTÍNUO
  doc.setFillColor(245, 130, 32); // Laranja oficial (#F58220)
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.rect(8, bannerY, bannerWidth, bannerHeight, 'FD');

  // 1.2 DESENHA OS TEXTOS EM PRETO DENTRO DA BARRA
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);

  // Texto 1: Data de Referência (posicionada na esquerda)
  doc.setFontSize(8.5);
  doc.text(dataRefFormatada, 8 + 13, bannerY + 4.6, { align: 'center' });

  // Texto 2: Título do Preventivo (centralizado na barra)
  doc.setFontSize(9.5);
  doc.text(tituloHeader, 8 + bannerWidth / 2, bannerY + 4.6, { align: 'center' });

  // Texto 3: Líder Responsável (posicionado na direita)
  doc.setFontSize(8.5);
  doc.text(liderHeader, 289 - 28, bannerY + 4.6, { align: 'center' });

  // 1.3 LEGENDA DISCRETA ABAIXO DO CABEÇALHO NA PÁGINA 1
  const legendY = bannerY + bannerHeight + 1.2; // ~15mm
  const legendH = 4.0;

  // Fundo com a mesma cor Laranja Claro dos produtos críticos para associação visual imediata
  doc.setFillColor(254, 215, 170); // Laranja Claro (#FED7AA)
  doc.setDrawColor(215, 100, 20);
  doc.setLineWidth(0.18);
  doc.roundedRect(8, legendY, 78, legendH, 0.8, 0.8, 'FD');

  // Ícone vetorizado de alerta
  desenharIconeAlerta(doc, 8 + 3.2, legendY + 2.0, 2.3);

  // Texto da Legenda
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(140, 20, 0);
  doc.text('CRÍTICO = PRODUTO ENVIADO AO COMPRADOR', 8 + 5.8, legendY + 2.9);

  // Contador de itens críticos se houver
  const totalCriticos = itens.filter((it) => it.enviarParaComprador).length;
  if (totalCriticos > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.0);
    doc.setTextColor(160, 40, 0);
    doc.text(
      `ATENÇÃO: ${totalCriticos} ${totalCriticos === 1 ? 'PRODUTO CRÍTICO' : 'PRODUTOS CRÍTICOS'} NO RELATÓRIO`,
      289,
      legendY + 2.9,
      { align: 'right' }
    );
  }

  // 2. Cabeçalho das Colunas da Planilha (Amarelo vibrante)
  // Estrutura unificada: CÓDIGO | DIG | DESCRIÇÃO MERCADORIA | EMBALAGEM | COMPRADOR | ESTOQUE | VENCIMENTO | PREÇO | STATUS
  const head: any[] = [
    [
      { content: 'CÓDIGO', styles: { halign: 'center', valign: 'middle' } },
      { content: 'DIG', styles: { halign: 'center', valign: 'middle' } },
      { content: 'DESCRIÇÃO MERCADORIA', styles: { halign: 'left', valign: 'middle' } },
      { content: 'EMBALAGEM', styles: { halign: 'left', valign: 'middle' } },
      { content: 'COMPRADOR', styles: { halign: 'left', valign: 'middle' } },
      { content: 'ESTOQUE', styles: { halign: 'center', valign: 'middle' } },
      { content: 'VENCIMENTO', styles: { halign: 'center', valign: 'middle' } },
      { content: 'PREÇO', styles: { halign: 'center', valign: 'middle' } },
      { content: 'STATUS', styles: { halign: 'center', valign: 'middle' } },
    ],
  ];

  // A tabela começa após a barra de legenda com 1.4mm de respiro
  const tableStartY = legendY + legendH + 1.4;

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
      0: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, // CÓDIGO
      1: { cellWidth: 11, halign: 'center', fontStyle: 'bold' }, // DIG
      2: { cellWidth: 68, halign: 'left' },                      // DESCRIÇÃO MERCADORIA
      3: { cellWidth: 33, halign: 'left' },                      // EMBALAGEM
      4: { cellWidth: 43, halign: 'left' },                      // COMPRADOR
      5: { cellWidth: 33, halign: 'center', fontStyle: 'bold' }, // ESTOQUE
      6: { cellWidth: 28, halign: 'center', fontStyle: 'bold' }, // VENCIMENTO
      7: { cellWidth: 24, halign: 'center', fontStyle: 'bold' }, // PREÇO
      8: { cellWidth: 23, halign: 'center', fontStyle: 'bold' }, // STATUS
    },
    didParseCell: (data) => {
      // Garante borda preta sólida 0.2mm em todas as seções sem espaços brancos
      data.cell.styles.lineColor = [0, 0, 0];
      data.cell.styles.lineWidth = 0.2;

      if (data.section === 'head') {
        data.cell.styles.fillColor = [255, 235, 59]; // Fundo amarelo vibrante
        data.cell.styles.textColor = [0, 0, 0];       // Texto preto nítido
        data.cell.styles.fontStyle = 'bold';
      } else if (data.section === 'body') {
        const item = itens[data.row.index];
        const isCritico = Boolean(item?.enviarParaComprador);

        if (isCritico) {
          // REGRA OBRIGATÓRIA: PRODUTO ENVIADO AO COMPRADOR (CRÍTICO)
          // O fundo LARANJA CLARO deve ocupar TODA A LINHA HORIZONTAL contínua
          // Começando exatamente na primeira coluna (CÓDIGO) e terminando na última (STATUS)
          // Preenchendo toda a altura da linha, mesmo em caso de quebra de texto
          data.cell.styles.fillColor = [254, 215, 170]; // Laranja Claro equilibrado (#FED7AA)
          data.cell.styles.textColor = [0, 0, 0];

          // Coluna STATUS (índice 8) com texto em destaque de alta legibilidade
          if (data.column.index === 8) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [150, 20, 0]; // Vermelho/âmbar escuro para ênfase
          }
        } else {
          // PRODUTO NORMAL: Fundo padrão da tabela (branco)
          data.cell.styles.textColor = [0, 0, 0];

          // Destaque de cor de validade na coluna VENCIMENTO (índice 6) para produtos normais
          if (data.column.index === 6) {
            data.cell.styles.fontStyle = 'bold';
            const dias = rowDiasRestantesMap.get(data.row.index);

            if (dias !== undefined && dias !== null) {
              if (dias <= 4) {
                // Vermelho (vencido ou até 4 dias)
                data.cell.styles.fillColor = [218, 41, 28];
                data.cell.styles.textColor = [255, 255, 255];
              } else if (dias >= 5 && dias <= 10) {
                // Amarelo (alerta médio)
                data.cell.styles.fillColor = [254, 219, 0];
                data.cell.styles.textColor = [0, 0, 0];
              } else if (dias >= 11) {
                // Verde (controlado / normal)
                data.cell.styles.fillColor = [0, 138, 60];
                data.cell.styles.textColor = [255, 255, 255];
              }
            }
          }
        }
      }
    },
    didDrawCell: (data) => {
      // Desenha o ícone de alerta vetorizado (⚠) na coluna STATUS (índice 8) para produtos críticos
      if (data.section === 'body' && data.column.index === 8) {
        const item = itens[data.row.index];
        const isCritico = Boolean(item?.enviarParaComprador);

        if (isCritico) {
          const cell = data.cell;
          // Mede o texto "CRÍTICO" em Helvetica Bold 7.2pt (~10.4mm)
          const textW = 10.4;
          const iconSize = 2.4;
          const textStartX = cell.x + (cell.width - textW) / 2;
          const iconCenterX = textStartX - iconSize / 2 - 1.0;
          const iconCenterY = cell.y + cell.height / 2;

          desenharIconeAlerta(doc, iconCenterX, iconCenterY, iconSize);
        }
      }
    },
    didDrawPage: (data) => {
      // Rodapé: Legenda discreta na esquerda, paginação no centro e identificação na direita
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(140, 20, 0);
      desenharIconeAlerta(doc, 10, 204.0, 2.2);
      doc.text('CRÍTICO = PRODUTO ENVIADO AO COMPRADOR', 12.2, 204.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(80, 80, 80);
      const str = `Página ${data.pageNumber} de ${totalPagesExp} — ${rodapeTexto}`;
      doc.text(str, 148.5, 204.8, { align: 'center' });

      doc.setFontSize(7.0);
      doc.text('Controle de Vencimentos • Filial 172', 289, 204.8, { align: 'right' });
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

