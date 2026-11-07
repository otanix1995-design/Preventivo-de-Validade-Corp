/**
 * ISV — CLASSIFICAÇÃO OFICIAL DE MERCADORIAS SEM VENDA
 * Filial: 172 — Cascavel
 * 
 * Regras Obrigatórias e Centralizadas:
 * 1. 5 a 10 dias:   Giro normal -> Verde (#16A34A)
 * 2. 11 a 15 dias:  Atenção     -> Amarelo (#EAB308 / #CA8A04)
 * 3. 16 a 20 dias:  Alerta      -> Laranja (#EA580C)
 * 4. 21 ou mais:    Crítico     -> Vermelho (#DC2626)
 * 
 * Condições de Elegibilidade:
 * - Somente produtos com estoque estritamente positivo (estoque > 0).
 * - Produtos com menos de 5 dias sem venda (< 5) NÃO entram nos indicadores.
 * - Produtos com estoque zerado ou negativo (<= 0) NUNCA entram nos indicadores.
 * - Utilizar uma única coluna de ESTOQUE em todo o sistema e nos PDFs.
 * - Função centralizada compartilhada entre Gráficos, TOP 30 e Relatórios PDF.
 */

import { ItemIsv } from '../types';
import { isvService } from './isvService';

export type ClassificacaoDiasSemVenda = 'GIRO_NORMAL' | 'ATENCAO' | 'ALERTA' | 'CRITICO';

export interface InfoClassificacao {
  tipo: ClassificacaoDiasSemVenda;
  rotulo: 'Giro normal' | 'Atenção' | 'Alerta' | 'Crítico';
  corNome: 'Verde' | 'Amarelo' | 'Laranja' | 'Vermelho';
  faixaTexto: string;
  minDias: number;
  maxDias: number | null; // null para sem teto (21+)
  corHex: string;
  corRgb: [number, number, number];
  // Cores suaves para fundo em tabelas / badges
  bgHex: string;
  textHex: string;
  borderHex: string;
  // Classes Tailwind CSS consistentes
  tailwindBadge: string;
  tailwindBg: string;
  tailwindText: string;
  tailwindBorder: string;
  ordemPrioridade: number; // 1 = Crítico, 2 = Alerta, 3 = Atenção, 4 = Giro normal
}

export const DEFINICOES_CLASSIFICACAO: Record<ClassificacaoDiasSemVenda, InfoClassificacao> = {
  CRITICO: {
    tipo: 'CRITICO',
    rotulo: 'Crítico',
    corNome: 'Vermelho',
    faixaTexto: '21 ou mais dias',
    minDias: 21,
    maxDias: null,
    corHex: '#DC2626', // red-600
    corRgb: [220, 38, 38],
    bgHex: '#FEF2F2', // red-50
    textHex: '#B91C1C', // red-700
    borderHex: '#FECACA', // red-200
    tailwindBadge: 'bg-red-50 text-red-700 border-red-200',
    tailwindBg: 'bg-red-600',
    tailwindText: 'text-red-700',
    tailwindBorder: 'border-red-600',
    ordemPrioridade: 1,
  },
  ALERTA: {
    tipo: 'ALERTA',
    rotulo: 'Alerta',
    corNome: 'Laranja',
    faixaTexto: '16 a 20 dias',
    minDias: 16,
    maxDias: 20,
    corHex: '#EA580C', // orange-600
    corRgb: [234, 88, 12],
    bgHex: '#FFF7ED', // orange-50
    textHex: '#C2410C', // orange-700
    borderHex: '#FED7AA', // orange-200
    tailwindBadge: 'bg-orange-50 text-orange-700 border-orange-200',
    tailwindBg: 'bg-orange-600',
    tailwindText: 'text-orange-700',
    tailwindBorder: 'border-orange-600',
    ordemPrioridade: 2,
  },
  ATENCAO: {
    tipo: 'ATENCAO',
    rotulo: 'Atenção',
    corNome: 'Amarelo',
    faixaTexto: '11 a 15 dias',
    minDias: 11,
    maxDias: 15,
    corHex: '#CA8A04', // yellow-600
    corRgb: [202, 138, 4],
    bgHex: '#FEFCE8', // yellow-50
    textHex: '#854D0E', // yellow-800
    borderHex: '#FEF08A', // yellow-200
    tailwindBadge: 'bg-yellow-50 text-yellow-800 border-yellow-300',
    tailwindBg: 'bg-yellow-500',
    tailwindText: 'text-yellow-800',
    tailwindBorder: 'border-yellow-500',
    ordemPrioridade: 3,
  },
  GIRO_NORMAL: {
    tipo: 'GIRO_NORMAL',
    rotulo: 'Giro normal',
    corNome: 'Verde',
    faixaTexto: '5 a 10 dias',
    minDias: 5,
    maxDias: 10,
    corHex: '#16A34A', // green-600
    corRgb: [22, 163, 74],
    bgHex: '#F0FDF4', // green-50
    textHex: '#15803D', // green-700
    borderHex: '#BBF7D0', // green-200
    tailwindBadge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    tailwindBg: 'bg-emerald-600',
    tailwindText: 'text-emerald-700',
    tailwindBorder: 'border-emerald-600',
    ordemPrioridade: 4,
  },
};

/**
 * Função centralizada e única de classificação por dias sem venda.
 * 
 * @param diasSemVenda Quantidade de dias sem venda (da BASE RUB)
 * @param estoque Quantidade de estoque total (estoque > 0)
 * @returns InfoClassificacao com cor e rótulo, ou null se não elegível (< 5 dias ou estoque <= 0)
 */
export function classificarDiasSemVenda(
  diasSemVenda: number | null | undefined,
  estoque: number | null | undefined
): InfoClassificacao | null {
  const est = Number(estoque || 0);
  const dias = Number(diasSemVenda || 0);

  // 1. Estoque deve ser estritamente maior que zero
  if (est <= 0 || isNaN(est)) {
    return null;
  }

  // 2. Menos de 5 dias sem venda não entram nos indicadores
  if (dias < 5 || isNaN(dias)) {
    return null;
  }

  // 3. Faixas oficiais
  if (dias >= 5 && dias <= 10) {
    return DEFINICOES_CLASSIFICACAO.GIRO_NORMAL;
  }

  if (dias >= 11 && dias <= 15) {
    return DEFINICOES_CLASSIFICACAO.ATENCAO;
  }

  if (dias >= 16 && dias <= 20) {
    return DEFINICOES_CLASSIFICACAO.ALERTA;
  }

  // 21 ou mais
  return DEFINICOES_CLASSIFICACAO.CRITICO;
}

/**
 * Verifica se um produto é elegível para os indicadores/gráficos de mercadorias sem venda.
 */
export function isProdutoElegivelIndicadores(
  diasSemVenda: number | null | undefined,
  estoque: number | null | undefined
): boolean {
  return classificarDiasSemVenda(diasSemVenda, estoque) !== null;
}

export interface GrupoClassificacaoResultado {
  classificacao: InfoClassificacao;
  totalProdutos: number;
  porcentagemDoTotal: number;
  estoqueTotal: number;
  valorTotalEstoque: number;
  produtos: ItemIsv[];
}

export interface ResumoClassificacaoIsv {
  critico: GrupoClassificacaoResultado;
  alerta: GrupoClassificacaoResultado;
  atencao: GrupoClassificacaoResultado;
  giroNormal: GrupoClassificacaoResultado;
  totalElegiveis: number;
  totalEstoqueElegiveis: number;
  totalValorElegiveis: number;
  totalNaoElegiveisMenor5Dias: number;
  totalSemEstoque: number;
  itensElegiveis: ItemIsv[];
}

/**
 * Calcula os totais de produtos por classificação oficial, sem duplicações.
 */
export function calcularTotaisClassificacao(itens: ItemIsv[]): ResumoClassificacaoIsv {
  // Deduplicação estrita por código interno
  const itensUnicos = new Map<string, ItemIsv>();
  for (const it of itens) {
    const cod = it.codigo_interno || it.produto?.codigo_interno;
    if (cod && !itensUnicos.has(cod)) {
      itensUnicos.set(cod, it);
    }
  }

  const criticoItens: ItemIsv[] = [];
  const alertaItens: ItemIsv[] = [];
  const atencaoItens: ItemIsv[] = [];
  const giroNormalItens: ItemIsv[] = [];

  let totalNaoElegiveisMenor5Dias = 0;
  let totalSemEstoque = 0;

  let estoqueTotalElegiveis = 0;
  let valorTotalElegiveis = 0;

  for (const item of itensUnicos.values()) {
    const estoque = item.estoque_total ?? item.produto?.estoque_total ?? 0;
    const dias = item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0;

    if (estoque <= 0) {
      totalSemEstoque++;
      continue;
    }

    if (dias < 5) {
      totalNaoElegiveisMenor5Dias++;
      continue;
    }

    const info = classificarDiasSemVenda(dias, estoque);
    if (!info) continue;

    estoqueTotalElegiveis += estoque;
    if (item.valor_estoque !== null && item.valor_estoque !== undefined) {
      valorTotalElegiveis += item.valor_estoque;
    }

    switch (info.tipo) {
      case 'CRITICO':
        criticoItens.push(item);
        break;
      case 'ALERTA':
        alertaItens.push(item);
        break;
      case 'ATENCAO':
        atencaoItens.push(item);
        break;
      case 'GIRO_NORMAL':
        giroNormalItens.push(item);
        break;
    }
  }

  const totalElegiveis =
    criticoItens.length + alertaItens.length + atencaoItens.length + giroNormalItens.length;

  const criarGrupo = (
    def: InfoClassificacao,
    produtos: ItemIsv[]
  ): GrupoClassificacaoResultado => {
    let est = 0;
    let val = 0;
    for (let i = 0; i < produtos.length; i++) {
      est += produtos[i].estoque_total || 0;
      if (produtos[i].valor_estoque !== null && produtos[i].valor_estoque !== undefined) {
        val += produtos[i].valor_estoque!;
      }
    }
    return {
      classificacao: def,
      totalProdutos: produtos.length,
      porcentagemDoTotal: totalElegiveis > 0 ? (produtos.length / totalElegiveis) * 100 : 0,
      estoqueTotal: est,
      valorTotalEstoque: val,
      produtos,
    };
  };

  const todosElegiveis = [
    ...criticoItens,
    ...alertaItens,
    ...atencaoItens,
    ...giroNormalItens,
  ];

  return {
    critico: criarGrupo(DEFINICOES_CLASSIFICACAO.CRITICO, criticoItens),
    alerta: criarGrupo(DEFINICOES_CLASSIFICACAO.ALERTA, alertaItens),
    atencao: criarGrupo(DEFINICOES_CLASSIFICACAO.ATENCAO, atencaoItens),
    giroNormal: criarGrupo(DEFINICOES_CLASSIFICACAO.GIRO_NORMAL, giroNormalItens),
    totalElegiveis,
    totalEstoqueElegiveis: estoqueTotalElegiveis,
    totalValorElegiveis: valorTotalElegiveis,
    totalNaoElegiveisMenor5Dias,
    totalSemEstoque,
    itensElegiveis: todosElegiveis,
  };
}

export interface ItemTop30Mercadoria {
  posicao: number;
  posicaoFormatada: string; // "1º", "2º", ... "30º"
  item: ItemIsv;
  classificacao: InfoClassificacao;
  codigoInterno: string;
  digito: string;
  descricao: string;
  embalagem: string;
  estoque: number;
  estoqueFormatado: string;
  idade: number;
  diasSemVenda: number;
  grupo: string;
  fornecedor: string;
  agencia: string;
  promotor: string;
  valorEstoque: number | null;
}

/**
 * Extrai o nome do Grupo/Classe a partir do produto na BASE RUB.
 */
export function extrairGrupoProduto(item: ItemIsv): string {
  const op = item.produto?.dados_operacionais;
  if (op?.classe_produto && op.classe_produto.trim() !== '') {
    return op.classe_produto.trim();
  }
  if (item.produto?.classe_produto && item.produto.classe_produto.trim() !== '') {
    return item.produto.classe_produto.trim();
  }
  if (item.produto?.setor_balanco && item.produto.setor_balanco.trim() !== '') {
    return item.produto.setor_balanco.trim();
  }
  if (item.produto?.setor_fisico && item.produto.setor_fisico.trim() !== '') {
    return item.produto.setor_fisico.trim();
  }
  if (item.setor_operacional) {
    return item.setor_operacional;
  }
  return '-';
}

/**
 * Extrai o Fornecedor do produto, representando EXCLUSIVAMENTE a RAZÃO SOCIAL DA INDÚSTRIA.
 * 
 * Regras Obrigatórias e Estritas:
 * - O campo FORNECEDOR deve representar exclusivamente a RAZÃO SOCIAL DA INDÚSTRIA.
 * - Utilizar a SPCOI007 como fonte auxiliar para identificar a indústria vinculada ao produto.
 * - Relacionar os registros utilizando as chaves existentes e confiáveis do sistema.
 * - Não utilizar nomes de compradores, promotores, representantes comerciais ou nomes fantasia como substitutos.
 * - Caso não exista vínculo válido, apresentar "NÃO IDENTIFICADO", sem inventar informações.
 */
export function extrairFornecedorProduto(item: ItemIsv): string {
  // 1. Razão social oficial já identificada na SPCOI007/Indústrias
  if (
    item.fornecedor_razao_social &&
    item.fornecedor_razao_social.trim() !== '' &&
    item.fornecedor_razao_social !== '-' &&
    item.fornecedor_razao_social !== 'NÃO IDENTIFICADO'
  ) {
    return item.fornecedor_razao_social.trim();
  }

  // 2. Consulta direta à SPCOI007 e cadastro de indústrias pelas chaves confiáveis
  const cod = item.codigo_interno || item.produto?.codigo_interno;
  const dig = item.digito || item.produto?.digito;
  if (cod) {
    const rz = isvService.getRazaoSocialIndustria(cod, dig);
    if (rz && rz !== 'NÃO IDENTIFICADO') {
      return rz;
    }
  }

  // 3. Fallback estrito para indústrias vinculadas ao ItemIsv
  if (item.industrias_nomes && item.industrias_nomes.length > 0) {
    const primeira = item.industrias_nomes[0].trim();
    if (
      primeira &&
      primeira !== '-' &&
      primeira !== 'NÃO IDENTIFICADO' &&
      !primeira.match(/^\d{14}$/)
    ) {
      return primeira;
    }
  }

  // 4. Caso não exista vínculo válido: apresentar NÃO IDENTIFICADO (NUNCA comprador ou promotor)
  return 'NÃO IDENTIFICADO';
}

/**
 * Extrai a Agência do produto.
 */
export function extrairAgenciaProduto(item: ItemIsv): string {
  if (item.agencias_nomes && item.agencias_nomes.length > 0) {
    return item.agencias_nomes[0];
  }
  return '-';
}

/**
 * Extrai o Promotor vinculado ao produto.
 */
export function extrairPromotorProduto(item: ItemIsv): string {
  if (item.promotores_nomes && item.promotores_nomes.length > 0) {
    return item.promotores_nomes[0];
  }
  return '-';
}

/**
 * Formata um valor de estoque em coluna única, preservando o padrão original da BASE RUB.
 * 
 * Regras Obrigatórias e Estritas:
 * - Manter uma única coluna ESTOQUE.
 * - Respeitar as unidades de medida e os formatos de quantidade da BASE RUB.
 * - Preservar a precisão decimal original.
 * - Não arredondar automaticamente quantidades fracionadas (não usar toFixed truncado).
 * - Não converter KG, G, caixas ou unidades sem seguir as regras já existentes do sistema.
 * - Não somar indiscriminadamente estoques de unidades de medida diferentes.
 * - Manter a embalagem em sua coluna própria.
 */
export function formatarEstoqueColunaUnica(item: ItemIsv): string {
  // 1. Tentar primeiro o texto operacional original da BASE RUB
  const op = item.produto?.dados_operacionais;
  if (op?.estoque_original_texto && op.estoque_original_texto.trim() !== '' && op.estoque_original_texto !== '-') {
    return op.estoque_original_texto.trim();
  }
  if (op?.estoque_formatado_extenso && op.estoque_formatado_extenso.trim() !== '' && op.estoque_formatado_extenso !== '-') {
    return op.estoque_formatado_extenso.trim();
  }
  if (item.produto?.estoque_original_erp && item.produto.estoque_original_erp.trim() !== '' && item.produto.estoque_original_erp !== '-') {
    return item.produto.estoque_original_erp.trim();
  }
  if (item.produto?.estoque_disponivel_texto && item.produto.estoque_disponivel_texto.trim() !== '' && item.produto.estoque_disponivel_texto !== '-') {
    return item.produto.estoque_disponivel_texto.trim();
  }
  if (item.estoque_formatado && item.estoque_formatado.trim() !== '' && item.estoque_formatado !== '-') {
    return item.estoque_formatado.trim();
  }

  // 2. Preservar a precisão decimal original sem arredondamento decimal forçado
  const est = item.estoque_total ?? item.produto?.estoque_total ?? 0;
  if (Number.isInteger(est)) {
    return String(est);
  }
  // Preserva todas as casas decimais originais (ex: 158.795 -> 158,795)
  return String(est).replace('.', ',');
}

/**
 * SELEÇÃO OFICIAL DO TOP 30 — MERCADORIAS COM MAIS DIAS SEM VENDA
 * 
 * Critérios estritos:
 * 1. Estoque maior que zero (estoque > 0).
 * 2. Mínimo de 5 dias sem venda (dias_sem_venda >= 5).
 * 3. Ordenação decrescente por dias sem venda (b.dias_sem_venda - a.dias_sem_venda).
 * 4. Prioriza automaticamente os produtos críticos (21+ dias) pela própria ordenação decrescente.
 * 5. Em caso de empate, critério estável de desempate por código interno.
 * 6. Se houver menos de 30 produtos elegíveis, retorna apenas os disponíveis.
 * 7. Sem duplicatas de produtos.
 */
export function obterTop30Mercadorias(itens: ItemIsv[]): ItemTop30Mercadoria[] {
  // 1. Deduplicação estrita
  const unicosMap = new Map<string, ItemIsv>();
  for (const it of itens) {
    const cod = it.codigo_interno || it.produto?.codigo_interno;
    if (cod && !unicosMap.has(cod)) {
      unicosMap.set(cod, it);
    }
  }

  // 2. Filtro de elegibilidade (estoque > 0 e dias >= 5)
  const elegiveis: ItemIsv[] = [];
  for (const it of unicosMap.values()) {
    const est = it.estoque_total ?? it.produto?.estoque_total ?? 0;
    const dias = it.dias_sem_venda ?? it.produto?.dias_sem_venda ?? 0;
    if (est > 0 && dias >= 5) {
      elegiveis.push(it);
    }
  }

  // 3. Ordenação decrescente por dias sem venda com desempate estável por código interno
  elegiveis.sort((a, b) => {
    const diasA = a.dias_sem_venda ?? a.produto?.dias_sem_venda ?? 0;
    const diasB = b.dias_sem_venda ?? b.produto?.dias_sem_venda ?? 0;

    // Maior número de dias sem venda primeiro
    if (diasB !== diasA) {
      return diasB - diasA;
    }

    // Desempate estável por código interno (numérico/alfanumérico)
    const codA = (a.codigo_interno || '').toString().trim();
    const codB = (b.codigo_interno || '').toString().trim();
    return codA.localeCompare(codB, undefined, { numeric: true });
  });

  // 4. Selecionar até 30 produtos
  const top30 = elegiveis.slice(0, 30);

  // 5. Mapear estrutura rica para tela e PDF
  return top30.map((item, idx) => {
    const posicao = idx + 1;
    const est = item.estoque_total ?? item.produto?.estoque_total ?? 0;
    const dias = item.dias_sem_venda ?? item.produto?.dias_sem_venda ?? 0;
    const classif = classificarDiasSemVenda(dias, est)!;

    return {
      posicao,
      posicaoFormatada: `${posicao}º`,
      item,
      classificacao: classif,
      codigoInterno: item.codigo_interno,
      digito: item.digito || '-',
      descricao: item.descricao,
      embalagem: item.embalagem || 'UN',
      estoque: est,
      estoqueFormatado: formatarEstoqueColunaUnica(item),
      idade: item.idade ?? item.produto?.idade ?? 0,
      diasSemVenda: dias,
      grupo: extrairGrupoProduto(item),
      fornecedor: extrairFornecedorProduto(item),
      agencia: extrairAgenciaProduto(item),
      promotor: extrairPromotorProduto(item),
      valorEstoque: item.valor_estoque ?? null,
    };
  });
}
