import {
  extrairSetorOperacionalIsv,
  FiltrosIsv,
  FornecedorSPCOI007,
  Industria,
  ItemIsv,
  ProdutoSMG,
  Promotor,
  PromotorVinculadoItem,
  RegistroPlanilhaIsv,
  ResponsaveisMercadoria,
  ResumoImportacaoIsv,
  ResumoImportacaoSPCOI007,
  SetorOperacionalIsv,
  SolicitacaoAjusteIsv,
  VinculoIndustriaItemIsv,
  VinculoPromotorIndustria,
} from '../types';
import { calcularPosicaoEstoque, isProdutoPesavel, parseEmbalagem } from './codeParser';
import { dbClear, dbGetAll, dbPut, dbPutAll, STORES } from './db';
import { formatarMoedaBR } from './deviceId';
import { productRepository } from './productRepository';
import { promotorService } from './promotorService';
import { formatarCnpj, normalizarCnpj } from './spcoi007Parser';
import { getProdutos } from './storage';

type IsvChangeListener = () => void;

export interface ParametrosCalculoFinanceiro {
  estoqueEmb1?: number | null;
  estoqueEmb9?: number | null;
  embalagem?: string | null;
  fatorEmbalagem?: number | null;
  tipoUnidade?: string | null;
  custoMedio?: number | null;
  unidadeReferenciaCusto?: 'CAIXA' | 'UNIDADE' | 'KG' | 'DESCONHECIDA' | string | null;
  estoqueConvertido?: number | null;
  valorEstoquePlanilha?: number | null;
  vendasPreco?: number | null;
}

export interface ResultadoCalculoFinanceiro {
  quantidadeFinanceira: number;
  unidadeFinanceira: string;
  custoUnitarioEquivalente: number | null;
  valorTotalEstoque: number | null;
  situacaoCalculo: 'CALCULADO' | 'OFICIAL_PLANILHA' | 'INDISPONIVEL' | 'ESTOQUE_ZERO';
  motivoIndisponibilidade?: string;
  isCustoPorCaixa: boolean;
  fatorUtilizado: number;
}

export interface DashboardData {
  indicadores: {
    valorTotal: number;
    totalSkus: number;
    totalIndustrias: number;
    totalAgencias: number;
  };
  top10Produtos: ItemIsv[];
  top10Industrias: {
    cnpj: string;
    nome: string;
    razaoSocial?: string;
    valorTotal: number;
    skusSet: Set<string>;
    itens: ItemIsv[];
  }[];
  top10Agencias: {
    nome: string;
    valorTotal: number;
    skusSet: Set<string>;
    industriasSet: Set<string>;
    promotoresSet: Set<string>;
    itens: ItemIsv[];
  }[];
}

export function isFiltrosPadrao(filtros?: FiltrosIsv | null): boolean {
  if (!filtros) return true;
  return (
    (!filtros.agencia || filtros.agencia === 'TODAS') &&
    (!filtros.industriaCnpj || filtros.industriaCnpj === 'TODAS') &&
    (!filtros.promotorId || filtros.promotorId === 'TODOS') &&
    (!filtros.termoBusca || !filtros.termoBusca.trim()) &&
    (!filtros.setorOperacional || filtros.setorOperacional === 'TODOS') &&
    (!filtros.setorFisico || filtros.setorFisico === 'TODOS') &&
    (!filtros.setorBalanco || filtros.setorBalanco === 'TODOS') &&
    (filtros.diasSemVenda === null || filtros.diasSemVenda === undefined) &&
    (filtros.idade === null || filtros.idade === undefined) &&
    (!filtros.filtroEstoque || filtros.filtroEstoque === 'TODOS') &&
    (!filtros.filtroValor || filtros.filtroValor === 'TODOS') &&
    (!filtros.situacaoVinculo || filtros.situacaoVinculo === 'TODOS')
  );
}

/**
 * FUNÇÃO CENTRALIZADA E OFICIAL DE CÁLCULO FINANCEIRO DO ISV:
 * Reutilizada rigorosamente pela interface, ordenação global e relatórios PDF A3.
 *
 * REGRA FUNDAMENTAL (REQUISITO 3 e 8):
 * - Se Custo Médio corresponder à embalagem completa (Caixa/Fardo):
 *     CUSTO UNITÁRIO = CUSTO MÉDIO DA EMBALAGEM ÷ QUANTIDADE DE UNIDADES DA EMBALAGEM
 *     VALOR DO ESTOQUE = ESTOQUE TOTAL EM UNIDADES × CUSTO UNITÁRIO
 *     (Não arredondar o custo unitário antes da multiplicação final)
 * - Se Custo Médio já for unitário:
 *     VALOR DO ESTOQUE = ESTOQUE TOTAL EM UNIDADES × CUSTO MÉDIO UNITÁRIO
 * - Se Produto for Pesável (KG e G):
 *     VALOR DO ESTOQUE = ESTOQUE EM KG × CUSTO MÉDIO POR KG
 * - Se Valor do Estoque já veio pré-calculado pelo ERP da filial (coluna oficial da planilha):
 *     Utiliza com prioridade absoluta o valor oficial do ERP.
 */
export function calcularValorEstoqueCentralizado(params: ParametrosCalculoFinanceiro): ResultadoCalculoFinanceiro {
  const emb = params.embalagem || '';
  const isPesavel = isProdutoPesavel(emb);
  const embData = parseEmbalagem(emb);
  const fator = params.fatorEmbalagem && params.fatorEmbalagem > 1
    ? params.fatorEmbalagem
    : (embData.fator && embData.fator > 1 ? embData.fator : 1);

  // 1. PRIORIDADE ABSOLUTA: Valor do estoque pré-calculado oficialmente pelo ERP SMG da filial
  if (
    params.valorEstoquePlanilha !== undefined &&
    params.valorEstoquePlanilha !== null &&
    !isNaN(params.valorEstoquePlanilha) &&
    params.valorEstoquePlanilha > 0
  ) {
    const valOficial = Number(params.valorEstoquePlanilha.toFixed(2));
    const qtdTotal = isPesavel
      ? (params.estoqueConvertido ?? (Number(params.estoqueEmb1 || 0) + Number(params.estoqueEmb9 || 0) / 1000))
      : (params.estoqueConvertido ?? (Number(params.estoqueEmb1 || 0) * fator + Number(params.estoqueEmb9 || 0)));

    return {
      quantidadeFinanceira: qtdTotal,
      unidadeFinanceira: isPesavel ? 'KG' : 'UN',
      custoUnitarioEquivalente: qtdTotal > 0 ? valOficial / qtdTotal : (params.custoMedio ?? null),
      valorTotalEstoque: valOficial,
      situacaoCalculo: 'OFICIAL_PLANILHA',
      isCustoPorCaixa: false,
      fatorUtilizado: fator,
    };
  }

  // 2. Custo Médio obrigatório: se ausente ou <= 0, retorna INDISPONÍVEL
  if (
    params.custoMedio === undefined ||
    params.custoMedio === null ||
    isNaN(params.custoMedio) ||
    params.custoMedio <= 0
  ) {
    return {
      quantidadeFinanceira: 0,
      unidadeFinanceira: isPesavel ? 'KG' : 'UN',
      custoUnitarioEquivalente: null,
      valorTotalEstoque: null,
      situacaoCalculo: 'INDISPONIVEL',
      motivoIndisponibilidade: 'Custo Médio ausente ou zerado na SMGOI013',
      isCustoPorCaixa: false,
      fatorUtilizado: fator,
    };
  }

  const custo = Number(params.custoMedio);

  // 3. PRODUTOS PESÁVEIS (KG e G)
  if (isPesavel) {
    const qtdKg = params.estoqueConvertido !== undefined && params.estoqueConvertido !== null && !isNaN(params.estoqueConvertido)
      ? Number(params.estoqueConvertido)
      : Number(params.estoqueEmb1 || 0) + (Number(params.estoqueEmb9 || 0) / 1000);

    if (qtdKg <= 0) {
      return {
        quantidadeFinanceira: 0,
        unidadeFinanceira: 'KG',
        custoUnitarioEquivalente: custo,
        valorTotalEstoque: 0,
        situacaoCalculo: 'ESTOQUE_ZERO',
        isCustoPorCaixa: false,
        fatorUtilizado: 1,
      };
    }

    const valorTotal = Number((qtdKg * custo).toFixed(2));
    return {
      quantidadeFinanceira: qtdKg,
      unidadeFinanceira: 'KG',
      custoUnitarioEquivalente: custo,
      valorTotalEstoque: valorTotal,
      situacaoCalculo: 'CALCULADO',
      isCustoPorCaixa: false,
      fatorUtilizado: 1,
    };
  }

  // 4. PRODUTOS CONTROLADOS POR CAIXA / UNIDADE
  let estTotal = params.estoqueConvertido !== undefined && params.estoqueConvertido !== null && !isNaN(params.estoqueConvertido)
    ? Number(params.estoqueConvertido)
    : (Number(params.estoqueEmb1 || 0) * fator) + Number(params.estoqueEmb9 || 0);

  if (estTotal <= 0 && ((params.estoqueEmb1 || 0) > 0 || (params.estoqueEmb9 || 0) > 0)) {
    const pos = calcularPosicaoEstoque(
      params.estoqueEmb1,
      params.estoqueEmb9,
      params.embalagem,
      fator
    );
    estTotal = pos.estoqueTotal;
  }

  if (estTotal <= 0) {
    return {
      quantidadeFinanceira: 0,
      unidadeFinanceira: 'UN',
      custoUnitarioEquivalente: custo,
      valorTotalEstoque: 0,
      situacaoCalculo: 'ESTOQUE_ZERO',
      isCustoPorCaixa: false,
      fatorUtilizado: fator,
    };
  }

  // Determinar com precisão cirúrgica se o custo médio refere-se à CAIXA ou à UNIDADE individual
  let isCustoPorCaixa = false;

  const refCusto = (params.unidadeReferenciaCusto || '').toUpperCase();
  if (refCusto === 'CAIXA' || refCusto === 'CX' || refCusto === 'EMBALAGEM') {
    isCustoPorCaixa = fator > 1;
  } else if (refCusto === 'UNIDADE' || refCusto === 'UN') {
    isCustoPorCaixa = false;
  } else if (fator > 1) {
    if (params.vendasPreco !== undefined && params.vendasPreco !== null && params.vendasPreco > 0) {
      if (custo > params.vendasPreco * 1.5) {
        isCustoPorCaixa = true;
      } else {
        isCustoPorCaixa = false;
      }
    } else {
      const unidadeCadastral = (params.tipoUnidade || embData.tipo || '').toUpperCase();
      if (
        unidadeCadastral.includes('CX') ||
        unidadeCadastral.includes('FD') ||
        unidadeCadastral.includes('PCT')
      ) {
        isCustoPorCaixa = true;
      }
    }
  }

  if (isCustoPorCaixa && fator > 1) {
    // REGRA OFICIAL (REQUISITO 3):
    // CUSTO UNITÁRIO = CUSTO MÉDIO DA EMBALAGEM ÷ QUANTIDADE DE UNIDADES DA EMBALAGEM
    // VALOR DO ESTOQUE = ESTOQUE TOTAL EM UNIDADES × CUSTO UNITÁRIO
    // (Não arredondar o custo unitário antes da multiplicação final)
    const custoUnitario = custo / fator;
    const valorCalculado = Number((estTotal * custoUnitario).toFixed(2));

    return {
      quantidadeFinanceira: estTotal,
      unidadeFinanceira: 'UN',
      custoUnitarioEquivalente: custoUnitario,
      valorTotalEstoque: valorCalculado,
      situacaoCalculo: 'CALCULADO',
      isCustoPorCaixa: true,
      fatorUtilizado: fator,
    };
  }

  // Custo já expresso por unidade individual:
  const valorCalculado = Number((estTotal * custo).toFixed(2));
  return {
    quantidadeFinanceira: estTotal,
    unidadeFinanceira: 'UN',
    custoUnitarioEquivalente: custo,
    valorTotalEstoque: valorCalculado,
    situacaoCalculo: 'CALCULADO',
    isCustoPorCaixa: false,
    fatorUtilizado: fator,
  };
}

class IsvService {
  private _fornecedores: FornecedorSPCOI007[] = [];
  private _industrias: Industria[] = [];
  private _vinculos: VinculoPromotorIndustria[] = [];
  private _solicitacoesAjuste: SolicitacaoAjusteIsv[] = [];
  private _historicoSpcoi: ResumoImportacaoSPCOI007[] = [];
  private _registrosIsvOperacional: RegistroPlanilhaIsv[] = [];
  private _historicoIsv: ResumoImportacaoIsv[] = [];
  private _listeners = new Set<IsvChangeListener>();
  private _isInitialized = false;

  // --- ÍNDICES E CACHES DE ALTA VELOCIDADE (O(1)) ---
  private _regOpByCod = new Map<string, RegistroPlanilhaIsv>();
  private _regOpByKey = new Map<string, RegistroPlanilhaIsv>();
  private _fornecedoresByCod = new Map<string, FornecedorSPCOI007[]>();
  private _fornecedoresByCodDig = new Map<string, FornecedorSPCOI007[]>();
  private _industriasMap = new Map<string, Industria>();
  private _vinculosPorCnpj = new Map<string, VinculoPromotorIndustria[]>();
  private _embalagemCache = new Map<string, {
    embalagem: string;
    divergente: boolean;
    embalagensDistintas: string[];
    fonte: 'SPCOI007' | 'BASE_RUB' | 'SMGOI013' | 'PLANILHA_OPERACIONAL' | 'PENDENTE';
  }>();
  private _responsaveisCache = new Map<string, ResponsaveisMercadoria>();
  private _itensIsvCache: ItemIsv[] | null = null;
  private _baselineDashboard: DashboardData | null = null;

  constructor() {
    try {
      productRepository.subscribe(() => {
        this.invalidarCache();
      });
    } catch {
      // safe fallback
    }
  }

  /**
   * Invalida explicitamente os caches do ISV (chamado após novas importações ou alterações de dados)
   */
  public invalidarCache(): void {
    this._embalagemCache.clear();
    this._responsaveisCache.clear();
    this._itensIsvCache = null;
    this._baselineDashboard = null;
  }

  /**
   * Reconstrói todos os índices em memória em O(N) com tempos inferiores a 10ms.
   * Evita pesquisas lineares (O(N*M)) e gargalos de processamento.
   */
  private _rebuildIndices(): void {
    this._embalagemCache.clear();
    this._responsaveisCache.clear();
    this._itensIsvCache = null;
    this._baselineDashboard = null;

    // 1. Indexar registros operacionais (até 65.000 itens)
    this._regOpByCod.clear();
    this._regOpByKey.clear();
    for (let i = 0; i < this._registrosIsvOperacional.length; i++) {
      const reg = this._registrosIsvOperacional[i];
      const codClean = (reg.codigo_interno || '').toString().trim().replace(/^0+/, '');
      const digClean = (reg.digito || '').toString().trim().replace(/^0+/, '');
      if (codClean) {
        if (!this._regOpByCod.has(codClean)) {
          this._regOpByCod.set(codClean, reg);
        }
        if (digClean) {
          this._regOpByKey.set(`${codClean}-${digClean}`, reg);
        }
      }
    }

    // 2. Indexar fornecedores SPCOI007
    this._fornecedoresByCod.clear();
    this._fornecedoresByCodDig.clear();
    for (let i = 0; i < this._fornecedores.length; i++) {
      const f = this._fornecedores[i];
      const fCod = (f.codigo_interno || '').toString().trim().replace(/^0+/, '');
      const fDig = (f.digito || '').toString().trim().replace(/^0+/, '');
      if (fCod) {
        let listCod = this._fornecedoresByCod.get(fCod);
        if (!listCod) {
          listCod = [];
          this._fornecedoresByCod.set(fCod, listCod);
        }
        listCod.push(f);

        if (fDig) {
          const key = `${fCod}-${fDig}`;
          let listDig = this._fornecedoresByCodDig.get(key);
          if (!listDig) {
            listDig = [];
            this._fornecedoresByCodDig.set(key, listDig);
          }
          listDig.push(f);
        }
      }
    }

    // 3. Indexar indústrias por CNPJ
    this._industriasMap.clear();
    for (let i = 0; i < this._industrias.length; i++) {
      const ind = this._industrias[i];
      this._industriasMap.set(ind.cnpj, ind);
    }

    // 4. Indexar vínculos de promotores por CNPJ
    this._vinculosPorCnpj.clear();
    for (let i = 0; i < this._vinculos.length; i++) {
      const v = this._vinculos[i];
      let vList = this._vinculosPorCnpj.get(v.cnpj);
      if (!vList) {
        vList = [];
        this._vinculosPorCnpj.set(v.cnpj, vList);
      }
      vList.push(v);
    }
  }

  public async init(): Promise<void> {
    if (this._isInitialized) return;

    try {
      const [fornec, indus, vincs, ajus, hist, regIsv, histIsv] = await Promise.all([
        dbGetAll<FornecedorSPCOI007>(STORES.SPCOI007_FORNECEDORES),
        dbGetAll<Industria>(STORES.INDUSTRIAS),
        dbGetAll<VinculoPromotorIndustria>(STORES.VINCULOS_PROMOTOR_INDUSTRIA),
        dbGetAll<SolicitacaoAjusteIsv>(STORES.ISV_SOLICITACOES_AJUSTE),
        dbGetAll<ResumoImportacaoSPCOI007>(STORES.HISTORICO_IMPORTACOES_SPCOI007),
        dbGetAll<RegistroPlanilhaIsv>(STORES.ISV_REGISTROS_OPERACIONAIS),
        dbGetAll<ResumoImportacaoIsv>(STORES.HISTORICO_IMPORTACOES_ISV),
      ]);

      this._fornecedores = fornec || [];
      this._industrias = indus || [];
      this._vinculos = vincs || [];
      this._solicitacoesAjuste = ajus || [];
      this._historicoSpcoi = hist || [];
      this._registrosIsvOperacional = regIsv || [];
      this._historicoIsv = histIsv || [];

      // Se a base de indústrias estiver vazia, inicializar com semente de teste operacional
      if (this._industrias.length === 0 && this._fornecedores.length === 0) {
        await this._seedInitialData();
      }

      this._rebuildIndices();
      this._isInitialized = true;
    } catch (err) {
      console.warn('Erro ao carregar dados do ISV do IndexedDB:', err);
      this._rebuildIndices();
      this._isInitialized = true;
    }
  }

  public subscribe(listener: IsvChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    this._listeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('Erro em listener do ISV:', err);
      }
    });
  }

  /**
   * Inicializa dados de demonstração coerentes com a filial 172 caso o banco esteja limpo.
   */
  private async _seedInitialData(): Promise<void> {
    const prods = getProdutos();
    const iso = new Date().toISOString();
    const dataBr = new Date().toLocaleString('pt-BR');

    // 4 Indústrias reais de referência
    const indAmbev: Industria = {
      cnpj: '00000000000191',
      cnpj_formatado: '00.000.000/0001-91',
      razao_social: 'AMBEV BRASIL BEBIDAS S/A',
      nome_exibicao: 'AMBEV',
      ativo: true,
      total_produtos_loja: 0,
      promotores_responsaveis: [],
      criado_em: iso,
      atualizado_em: iso,
    };

    const indDanone: Industria = {
      cnpj: '01123456000188',
      cnpj_formatado: '01.123.456/0001-88',
      razao_social: 'DANONE LTDA',
      nome_exibicao: 'DANONE',
      ativo: true,
      total_produtos_loja: 0,
      promotores_responsaveis: [],
      criado_em: iso,
      atualizado_em: iso,
    };

    const indNestle: Industria = {
      cnpj: '02987654000122',
      cnpj_formatado: '02.987.654/0001-22',
      razao_social: 'NESTLE BRASIL ALIMENTOS S/A',
      nome_exibicao: 'NESTLÉ',
      ativo: true,
      total_produtos_loja: 0,
      promotores_responsaveis: [],
      criado_em: iso,
      atualizado_em: iso,
    };

    const indBRF: Industria = {
      cnpj: '03555444000133',
      cnpj_formatado: '03.555.444/0001-33',
      razao_social: 'BRF S.A. - SADIA / PERDIGAO',
      nome_exibicao: 'BRF (SADIA / PERDIGÃO)',
      ativo: true,
      total_produtos_loja: 0,
      promotores_responsaveis: [],
      criado_em: iso,
      atualizado_em: iso,
    };

    const industrias = [indAmbev, indDanone, indNestle, indBRF];
    const fornecedores: FornecedorSPCOI007[] = [];

    // Mapear produtos reais se existirem na SMGOI013
    if (prods.length > 0) {
      prods.slice(0, 40).forEach((p, idx) => {
        let indAlvo = indDanone;
        if (idx % 4 === 0) indAlvo = indAmbev;
        else if (idx % 4 === 1) indAlvo = indNestle;
        else if (idx % 4 === 2) indAlvo = indBRF;

        fornecedores.push({
          id: `${indAlvo.cnpj}_${p.codigo_interno}`,
          cnpj: indAlvo.cnpj,
          cnpj_formatado: indAlvo.cnpj_formatado,
          razao_social: indAlvo.razao_social,
          codigo_interno: p.codigo_interno,
          digito: p.digito,
          codigo_exibicao: p.codigo_exibicao,
          descricao_spcoi: p.descricao,
          criado_em: dataBr,
        });

        indAlvo.total_produtos_loja = (indAlvo.total_produtos_loja || 0) + 1;

        // Simular produto com múltiplos CNPJs para teste do requisito de integridade
        if (idx === 0) {
          fornecedores.push({
            id: `${indAmbev.cnpj}_${p.codigo_interno}`,
            cnpj: indAmbev.cnpj,
            cnpj_formatado: indAmbev.cnpj_formatado,
            razao_social: indAmbev.razao_social,
            codigo_interno: p.codigo_interno,
            digito: p.digito,
            codigo_exibicao: p.codigo_exibicao,
            descricao_spcoi: p.descricao,
            criado_em: dataBr,
          });
          indAmbev.total_produtos_loja = (indAmbev.total_produtos_loja || 0) + 1;
        }
      });
    }

    this._industrias = industrias;
    this._fornecedores = fornecedores;

    // Persistir no IndexedDB
    await Promise.all([
      dbPutAll(STORES.INDUSTRIAS, industrias),
      dbPutAll(STORES.SPCOI007_FORNECEDORES, fornecedores),
    ]);
  }

  // ==========================================
  // FORNECEDORES & IMPORTAÇÃO SPCOI007
  // ==========================================

  public getFornecedores(): FornecedorSPCOI007[] {
    return [...this._fornecedores];
  }

  public getHistoricoSpcoi(): ResumoImportacaoSPCOI007[] {
    return [...this._historicoSpcoi];
  }

  public async salvarImportacaoSpcoi(
    fornecedores: FornecedorSPCOI007[],
    industrias: Industria[],
    resumo: ResumoImportacaoSPCOI007
  ): Promise<void> {
    // 1. Preservar nomes comerciais de exibição já customizados pelo usuário
    const industriasExistentesMap = new Map<string, Industria>();
    this._industrias.forEach((i) => industriasExistentesMap.set(i.cnpj, i));

    const industriasAtualizadas = industrias.map((nova) => {
      const existente = industriasExistentesMap.get(nova.cnpj);
      if (existente) {
        return {
          ...nova,
          nome_exibicao: existente.nome_exibicao || nova.razao_social,
          ativo: existente.ativo !== undefined ? existente.ativo : true,
          promotores_responsaveis: existente.promotores_responsaveis || [],
        };
      }
      return nova;
    });

    // 2. Atualizar estado em memória
    this._fornecedores = fornecedores;
    this._industrias = industriasAtualizadas;
    this._historicoSpcoi = [resumo, ...this._historicoSpcoi.slice(0, 19)];
    this._rebuildIndices();

    // 3. Persistir de forma atômica no IndexedDB
    await Promise.all([
      dbPutAll(STORES.SPCOI007_FORNECEDORES, fornecedores),
      dbPutAll(STORES.INDUSTRIAS, industriasAtualizadas),
      dbPutAll(STORES.HISTORICO_IMPORTACOES_SPCOI007, this._historicoSpcoi),
    ]);

    this._notify();
  }

  // ==========================================
  // NOVA PLANILHA OPERACIONAL DO ISV (FONTE OFICIAL)
  // ==========================================

  public async salvarImportacaoPlanilhaIsv(
    registros: RegistroPlanilhaIsv[],
    resumo: ResumoImportacaoIsv
  ): Promise<void> {
    this._registrosIsvOperacional = registros;
    this._historicoIsv = [resumo, ...this._historicoIsv.slice(0, 19)];
    this._rebuildIndices();

    await Promise.all([
      dbPutAll(STORES.ISV_REGISTROS_OPERACIONAIS, registros),
      dbPutAll(STORES.HISTORICO_IMPORTACOES_ISV, this._historicoIsv),
    ]);

    this._notify();
  }

  public async limparPlanilhaIsv(): Promise<void> {
    this._registrosIsvOperacional = [];
    this._rebuildIndices();
    await dbClear(STORES.ISV_REGISTROS_OPERACIONAIS);
    this._notify();
  }

  public getRegistrosIsvOperacional(): RegistroPlanilhaIsv[] {
    return this._registrosIsvOperacional;
  }

  /**
   * Busca eficiente e limitada na planilha operacional (até 65.000 itens) sem congelar a UI.
   */
  public searchRegistrosOperacionais(termo: string, maxResults = 50): RegistroPlanilhaIsv[] {
    const q = (termo || '').trim().toUpperCase();
    if (!q) {
      return this._registrosIsvOperacional.slice(0, maxResults);
    }

    const qNorm = q.replace(/^0+/, '');
    const results: RegistroPlanilhaIsv[] = [];
    const keysVistas = new Set<string>();

    // 1. Busca rápida O(1) por chave exata ou código
    const opByKey = this._regOpByKey.get(qNorm) || this._regOpByKey.get(q);
    if (opByKey) {
      results.push(opByKey);
      keysVistas.add(opByKey.chave_normalizada || `${opByKey.codigo_interno}-${opByKey.digito}`);
    }

    const opByCod = this._regOpByCod.get(qNorm);
    if (opByCod) {
      const k = opByCod.chave_normalizada || `${opByCod.codigo_interno}-${opByCod.digito}`;
      if (!keysVistas.has(k)) {
        results.push(opByCod);
        keysVistas.add(k);
      }
    }

    // 2. Scan linear com saída antecipada assim que atinge maxResults
    for (let i = 0; i < this._registrosIsvOperacional.length; i++) {
      if (results.length >= maxResults) break;
      const reg = this._registrosIsvOperacional[i];
      const k = reg.chave_normalizada || `${reg.codigo_interno}-${reg.digito}`;
      if (keysVistas.has(k)) continue;

      const codMatch = reg.codigo_interno === qNorm ||
        (reg.codigo_exibicao && reg.codigo_exibicao.toUpperCase().includes(q)) ||
        (reg.codigo_original && reg.codigo_original.includes(q));
      const nomeMatch = reg.nome && reg.nome.toUpperCase().includes(q);

      if (codMatch || nomeMatch) {
        results.push(reg);
        keysVistas.add(k);
      }
    }

    return results;
  }

  public getHistoricoIsv(): ResumoImportacaoIsv[] {
    return [...this._historicoIsv];
  }

  public getResumoIsvAtual(): ResumoImportacaoIsv | null {
    return this._historicoIsv.length > 0 ? this._historicoIsv[0] : null;
  }

  public temPlanilhaIsv(): boolean {
    return this._registrosIsvOperacional.length > 0;
  }

  /**
   * Obtém o registro operacional completo (36 colunas) correspondente a um código interno / dígito
   * usando índices O(1) em memória.
   */
  public getRegistroOperacional(codigoInterno: string, digito?: string): RegistroPlanilhaIsv | undefined {
    if (!codigoInterno) return undefined;
    const codClean = codigoInterno.toString().trim().replace(/^0+/, '');
    const digClean = digito !== undefined && digito !== null ? digito.toString().trim().replace(/^0+/, '') : undefined;

    // 1. Busca direta por código + dígito via índice O(1)
    if (digClean) {
      const matchKey = this._regOpByKey.get(`${codClean}-${digClean}`);
      if (matchKey) return matchKey;
    }

    // 2. Busca por código raiz via índice O(1)
    const matchCod = this._regOpByCod.get(codClean);
    if (matchCod) return matchCod;

    // 3. Fallback código original se não encontrou
    return undefined;
  }

  /**
   * Obtém os responsáveis (indústrias, CNPJs, promotores e agências) vinculados via SPCOI007
   * com memoização O(1).
   */
  public getResponsaveisPorCodigoInterno(codigoInterno: string): ResponsaveisMercadoria {
    if (!codigoInterno) {
      return {
        cnpjs: [],
        industrias: [],
        promotores: [],
        agencias: [],
        tem_promotor: false,
        multiplos_cnpjs: false,
      };
    }

    const codNorm = codigoInterno.toString().trim().replace(/^0+/, '');
    const cached = this._responsaveisCache.get(codNorm);
    if (cached) return cached;

    const fornecedores = this._fornecedoresByCod.get(codNorm) || [];
    const cnpjs = Array.from(new Set(fornecedores.map((f) => f.cnpj)));
    const industrias = cnpjs.map((cnpj) => {
      const ind = this._industriasMap.get(cnpj);
      const nome = ind ? (ind.nome_exibicao || ind.razao_social) : cnpj;
      return {
        cnpj,
        cnpj_formatado: formatarCnpj(cnpj),
        nome,
      };
    });

    const promotoresSet = new Set<string>();
    const agenciasSet = new Set<string>();

    for (let i = 0; i < cnpjs.length; i++) {
      const vincs = this._vinculosPorCnpj.get(cnpjs[i]) || [];
      for (let j = 0; j < vincs.length; j++) {
        promotoresSet.add(vincs[j].promotorNome);
        if (vincs[j].agenciaNome) agenciasSet.add(vincs[j].agenciaNome);
      }
    }

    const promotores = Array.from(promotoresSet);
    const agencias = Array.from(agenciasSet);

    const result: ResponsaveisMercadoria = {
      cnpjs,
      industrias,
      promotores,
      agencias,
      tem_promotor: promotores.length > 0,
      multiplos_cnpjs: cnpjs.length > 1,
    };

    this._responsaveisCache.set(codNorm, result);
    return result;
  }

  /**
   * Resolve a embalagem comercial do produto a partir da base oficial SPCOI007 com cache O(1).
   */
  public resolverEmbalagemSpcoi(
    codigoInterno: string,
    digito?: string,
    fallbackEmbalagem?: string
  ): {
    embalagem: string;
    divergente: boolean;
    embalagensDistintas: string[];
    fonte: 'SPCOI007' | 'BASE_RUB' | 'SMGOI013' | 'PLANILHA_OPERACIONAL' | 'PENDENTE';
  } {
    if (!codigoInterno) {
      return {
        embalagem: fallbackEmbalagem || 'EMBALAGEM PENDENTE',
        divergente: false,
        embalagensDistintas: fallbackEmbalagem ? [fallbackEmbalagem] : [],
        fonte: fallbackEmbalagem ? 'BASE_RUB' : 'PENDENTE',
      };
    }

    const codNorm = codigoInterno.toString().trim().replace(/^0+/, '');
    const digNorm = digito !== undefined && digito !== null ? digito.toString().trim().replace(/^0+/, '') : undefined;
    const cacheKey = `${codNorm}__${digNorm || ''}__${fallbackEmbalagem || ''}`;

    const cached = this._embalagemCache.get(cacheKey);
    if (cached) return cached;

    let fornecedores: FornecedorSPCOI007[] = [];
    if (digNorm) {
      fornecedores = this._fornecedoresByCodDig.get(`${codNorm}-${digNorm}`) || [];
    }
    if (fornecedores.length === 0) {
      fornecedores = this._fornecedoresByCod.get(codNorm) || [];
    }

    const embalagensValidas: string[] = [];
    const chavesVistas = new Set<string>();

    for (let i = 0; i < fornecedores.length; i++) {
      const f = fornecedores[i];
      const emb = (f.embalagem || '').trim();
      if (
        emb &&
        emb.toUpperCase() !== 'EMBALAGEM PENDENTE' &&
        emb.toUpperCase() !== '-' &&
        emb.toUpperCase() !== 'NULL' &&
        emb.toUpperCase() !== 'UNDEFINED'
      ) {
        const chaveNorm = emb.toUpperCase().replace(/\s+/g, ' ');
        if (!chavesVistas.has(chaveNorm)) {
          chavesVistas.add(chaveNorm);
          embalagensValidas.push(emb);
        }
      }
    }

    let resultado: {
      embalagem: string;
      divergente: boolean;
      embalagensDistintas: string[];
      fonte: 'SPCOI007' | 'BASE_RUB' | 'SMGOI013' | 'PLANILHA_OPERACIONAL' | 'PENDENTE';
    };

    if (embalagensValidas.length === 1) {
      resultado = {
        embalagem: embalagensValidas[0],
        divergente: false,
        embalagensDistintas: embalagensValidas,
        fonte: 'SPCOI007',
      };
    } else if (embalagensValidas.length > 1) {
      resultado = {
        embalagem: embalagensValidas[0],
        divergente: true,
        embalagensDistintas: embalagensValidas,
        fonte: 'SPCOI007',
      };
    } else if (
      fallbackEmbalagem &&
      fallbackEmbalagem.trim() &&
      fallbackEmbalagem.toUpperCase() !== 'EMBALAGEM PENDENTE' &&
      fallbackEmbalagem.toUpperCase() !== '-'
    ) {
      resultado = {
        embalagem: fallbackEmbalagem.trim(),
        divergente: false,
        embalagensDistintas: [fallbackEmbalagem.trim()],
        fonte: 'BASE_RUB',
      };
    } else {
      resultado = {
        embalagem: 'EMBALAGEM PENDENTE',
        divergente: false,
        embalagensDistintas: [],
        fonte: 'PENDENTE',
      };
    }

    this._embalagemCache.set(cacheKey, resultado);
    return resultado;
  }

  // ==========================================
  // GESTÃO DE INDÚSTRIAS
  // ==========================================

  public getIndustrias(): Industria[] {
    return [...this._industrias];
  }

  public getIndustriaByCnpj(cnpj: string): Industria | undefined {
    const norm = normalizarCnpj(cnpj);
    return this._industrias.find((i) => i.cnpj === norm);
  }

  public async salvarIndustria(industria: Industria): Promise<void> {
    const norm = normalizarCnpj(industria.cnpj);
    const idx = this._industrias.findIndex((i) => i.cnpj === norm);
    const item: Industria = {
      ...industria,
      cnpj: norm,
      cnpj_formatado: formatarCnpj(norm),
      atualizado_em: new Date().toISOString(),
    };

    if (idx >= 0) {
      this._industrias[idx] = item;
    } else {
      this._industrias.push(item);
    }

    this._rebuildIndices();
    await dbPut(STORES.INDUSTRIAS, item);
    this._notify();
  }

  // ==========================================
  // VINCULAÇÃO PROMOTOR ↔ INDÚSTRIA
  // ==========================================

  public getVinculosPromotorIndustria(): VinculoPromotorIndustria[] {
    return [...this._vinculos];
  }

  public getIndustriasDoPromotor(promotorId: string): Industria[] {
    const cnpjs = this._vinculos
      .filter((v) => v.promotorId === promotorId)
      .map((v) => v.cnpj);
    return this._industrias.filter((i) => cnpjs.includes(i.cnpj));
  }

  public getPromotoresDaIndustria(cnpj: string): VinculoPromotorIndustria[] {
    const norm = normalizarCnpj(cnpj);
    return this._vinculos.filter((v) => v.cnpj === norm);
  }

  /**
   * Vincula um promotor a um CNPJ de indústria usando chave estável:
   * promotorId + cnpjNormalizado + filialId
   */
  public async vincularPromotorIndustria(
    promotor: Promotor,
    cnpj: string,
    filialId = '172'
  ): Promise<void> {
    const cnpjNorm = normalizarCnpj(cnpj);
    const id = `${promotor.promotorId}_${cnpjNorm}_${filialId}`;

    const jaExiste = this._vinculos.some((v) => v.id === id);
    if (jaExiste) return;

    const novoVinculo: VinculoPromotorIndustria = {
      id,
      promotorId: promotor.promotorId,
      promotorNome: promotor.nome,
      agenciaNome: promotor.agenciaNome || 'Agência não informada',
      cnpj: cnpjNorm,
      filialId,
      criado_em: new Date().toISOString(),
    };

    this._vinculos.push(novoVinculo);

    // Atualizar lista de promotores na indústria
    const ind = this._industrias.find((i) => i.cnpj === cnpjNorm);
    if (ind) {
      const resp = new Set(ind.promotores_responsaveis || []);
      resp.add(promotor.nome);
      ind.promotores_responsaveis = Array.from(resp);
      await dbPut(STORES.INDUSTRIAS, ind);
    }

    this._rebuildIndices();
    await dbPut(STORES.VINCULOS_PROMOTOR_INDUSTRIA, novoVinculo);
    this._notify();
  }

  /**
   * Desvincula um promotor de um CNPJ de indústria.
   */
  public async desvincularPromotorIndustria(
    promotorId: string,
    cnpj: string,
    filialId = '172'
  ): Promise<void> {
    const cnpjNorm = normalizarCnpj(cnpj);
    const id = `${promotorId}_${cnpjNorm}_${filialId}`;

    this._vinculos = this._vinculos.filter((v) => v.id !== id);

    // Atualizar indústria
    const ind = this._industrias.find((i) => i.cnpj === cnpjNorm);
    if (ind && ind.promotores_responsaveis) {
      const promotoresRestantes = this._vinculos
        .filter((v) => v.cnpj === cnpjNorm)
        .map((v) => v.promotorNome);
      ind.promotores_responsaveis = promotoresRestantes;
      await dbPut(STORES.INDUSTRIAS, ind);
    }

    this._rebuildIndices();
    await dbPutAll(STORES.VINCULOS_PROMOTOR_INDUSTRIA, this._vinculos);
    this._notify();
  }

  // ==========================================
  // CONSOLIDAÇÃO DO MÓDULO ISV (ITENS SEM VENDA)
  // ==========================================

  /**
   * Formata a quantidade em estoque no padrão operacional:
   * - CX/UN: "10 CX + 4 UN" ou "14 UN"
   * - KG/G: "12 KG + 500 G" ou "500 G"
   */
  public formatarEstoqueIsv(produto: ProdutoSMG): string {
    const isPeso =
      (produto.unidade_medida && produto.unidade_medida.toUpperCase() === 'KG') ||
      isProdutoPesavel(produto.embalagem);

    const est = produto.estoque_total || 0;
    if (est <= 0) return isPeso ? '0 KG' : '0 UN';

    if (isPeso) {
      const kg =
        produto.estoque_emb1 !== undefined && produto.estoque_emb1 > 0
          ? Math.floor(produto.estoque_emb1)
          : Math.floor(est);
      const gramas =
        produto.estoque_emb9 !== undefined && produto.estoque_emb9 > 0
          ? Math.round(produto.estoque_emb9)
          : Math.round((est - Math.floor(est)) * 1000);

      const parts: string[] = [];
      if (kg > 0) parts.push(`${kg} KG`);
      if (gramas > 0) parts.push(`${gramas} G`);
      if (parts.length === 0) return '0 KG';
      return parts.join(' + ');
    }

    const embData = parseEmbalagem(produto.embalagem || '');
    const fator =
      produto.fator_embalagem && produto.fator_embalagem > 1
        ? produto.fator_embalagem
        : embData.fator && embData.fator > 1
        ? embData.fator
        : 1;

    if (fator > 1) {
      const cx =
        produto.estoque_emb1 !== undefined && produto.estoque_emb1 > 0
          ? produto.estoque_emb1
          : Math.floor(est / fator);
      const un =
        produto.estoque_emb9 !== undefined && produto.estoque_emb9 > 0
          ? produto.estoque_emb9
          : est % fator;

      const parts: string[] = [];
      if (cx > 0) parts.push(`${cx} CX`);
      if (un > 0) parts.push(`${un} UN`);
      if (parts.length === 0) return '0 UN';
      return parts.join(' + ');
    }

    return `${est} UN`;
  }

  /**
   * Calcula o valor financeiro do estoque:
   * Valor = Estoque Total Convertido × Custo Médio Unitário
   * Respeita: Se custo médio ausente/inválido, retorna null (não inventa R$ 0,00).
   */
  public calcularValorEstoque(produto: ProdutoSMG): number | null {
    const res = calcularValorEstoqueCentralizado({
      estoqueEmb1: produto.estoque_emb1,
      estoqueEmb9: produto.estoque_emb9,
      embalagem: produto.embalagem,
      fatorEmbalagem: produto.fator_embalagem,
      tipoUnidade: produto.unidade_medida,
      custoMedio: produto.custo_medio,
      estoqueConvertido: produto.estoque_total,
      valorEstoquePlanilha: produto.valor_estoque_planilha,
      vendasPreco: produto.vendas_preco,
    });
    return res.valorTotalEstoque;
  }

  public calcularPosicaoFinanceira(produto: ProdutoSMG): ResultadoCalculoFinanceiro {
    return calcularValorEstoqueCentralizado({
      estoqueEmb1: produto.estoque_emb1,
      estoqueEmb9: produto.estoque_emb9,
      embalagem: produto.embalagem,
      fatorEmbalagem: produto.fator_embalagem,
      tipoUnidade: produto.unidade_medida,
      custoMedio: produto.custo_medio,
      estoqueConvertido: produto.estoque_total,
      valorEstoquePlanilha: produto.valor_estoque_planilha,
      vendasPreco: produto.vendas_preco,
    });
  }

  /**
   * Monta a estrutura detalhada de vínculos (Indústria ↔ CNPJ ↔ Promotor ↔ Agência),
   * preservando a correspondência exata de cada vínculo sem misturar promotores entre indústrias.
   */
  private _montarVinculosDetalhados(
    cnpjs: string[],
    forns: FornecedorSPCOI007[],
    industriasMap: Map<string, Industria>,
    vinculosPorCnpj: Map<string, VinculoPromotorIndustria[]>,
    fornecedorPlanilha?: string
  ): VinculoIndustriaItemIsv[] {
    const list: VinculoIndustriaItemIsv[] = [];

    cnpjs.forEach((cnpj) => {
      const ind = industriasMap.get(cnpj);
      const fornec = forns.find((f) => f.cnpj === cnpj);
      const nome = ind?.nome_exibicao || ind?.razao_social || fornec?.razao_social || cnpj;
      const vincs = vinculosPorCnpj.get(cnpj) || [];

      const promotoresUnicos: PromotorVinculadoItem[] = [];
      const chavesPromotores = new Set<string>();
      vincs.forEach((v) => {
        const chave = `${v.promotorNome}__${v.agenciaNome || ''}`;
        if (!chavesPromotores.has(chave)) {
          chavesPromotores.add(chave);
          promotoresUnicos.push({
            promotorId: v.promotorId,
            promotorNome: v.promotorNome,
            agenciaNome: v.agenciaNome,
          });
        }
      });

      list.push({
        cnpj,
        cnpj_formatado: formatarCnpj(cnpj),
        nome_industria: nome,
        razao_social: ind?.razao_social || fornec?.razao_social,
        promotores: promotoresUnicos,
      });
    });

    if (list.length === 0 && fornecedorPlanilha && fornecedorPlanilha.trim()) {
      list.push({
        cnpj: '',
        cnpj_formatado: 'Não informado',
        nome_industria: fornecedorPlanilha.trim(),
        promotores: [],
      });
    }

    return list;
  }

  /**
   * Obtém os vínculos comerciais detalhados sob demanda (lazy evaluation)
   * ao invés de pré-alocar centenas de milhares de objetos em memória para 65.000 itens.
   */
  public getVinculosDetalhados(item: ItemIsv): VinculoIndustriaItemIsv[] {
    if (item.vinculos_detalhados && item.vinculos_detalhados.length > 0) {
      return item.vinculos_detalhados;
    }

    const codNorm = item.codigo_interno.toString().trim().replace(/^0+/, '');
    const forns = this._fornecedoresByCod.get(codNorm) || [];
    const cnpjs = item.cnpjs && item.cnpjs.length > 0
      ? item.cnpjs
      : Array.from(new Set(forns.map((f) => f.cnpj)));

    return this._montarVinculosDetalhados(
      cnpjs,
      forns,
      this._industriasMap,
      this._vinculosPorCnpj,
      item.produto?.fornecedor_planilha
    );
  }

  /**
   * Constrói e enriquece a lista de itens ISV com cruzamento de relacionamentos:
   * Produto (SMGOI013) ↔ Fornecedor/Indústria (SPCOI007) ↔ Promotor/Agência (Vínculos)
   */
  public getItensIsv(produtos?: ProdutoSMG[]): ItemIsv[] {
    if (this._itensIsvCache) {
      return this._itensIsvCache;
    }

    const prods = produtos || getProdutos();

    // Reutilizar índices O(1) da classe
    const industriasMap = this._industriasMap;
    const vinculosPorCnpj = this._vinculosPorCnpj;
    const fornecedoresPorCodigo = this._fornecedoresByCod;

    // Mapa rápido de produtos da SMGOI013
    const smgPorCodigo = new Map<string, ProdutoSMG>();
    for (let i = 0; i < prods.length; i++) {
      smgPorCodigo.set(prods[i].codigo_interno, prods[i]);
    }

    let result: ItemIsv[] = [];

    // =========================================================================
    // CASO 1: NOVA PLANILHA OPERACIONAL DO ISV IMPORTADA (FONTE OFICIAL MÁXIMA)
    // =========================================================================
    if (this._registrosIsvOperacional.length > 0) {
      const regs = this._registrosIsvOperacional;
      result = new Array(regs.length);

      for (let i = 0; i < regs.length; i++) {
        const reg = regs[i];
        const p = smgPorCodigo.get(reg.codigo_interno);

        const codNorm = reg.codigo_interno.toString().trim().replace(/^0+/, '');
        const forns = fornecedoresPorCodigo.get(codNorm) || [];
        const cnpjs = Array.from(new Set(forns.map((f) => f.cnpj)));

        const industriasNomes = cnpjs.map((cnpj) => {
          const ind = industriasMap.get(cnpj);
          return ind?.nome_exibicao || ind?.razao_social || cnpj;
        });

        const promotoresNomesSet = new Set<string>();
        const agenciasNomesSet = new Set<string>();

        for (let j = 0; j < cnpjs.length; j++) {
          const vincs = vinculosPorCnpj.get(cnpjs[j]) || [];
          for (let k = 0; k < vincs.length; k++) {
            promotoresNomesSet.add(vincs[k].promotorNome);
            if (vincs[k].agenciaNome) agenciasNomesSet.add(vincs[k].agenciaNome);
          }
        }

        const promotoresNomes = Array.from(promotoresNomesSet);
        const agenciasNomes = Array.from(agenciasNomesSet);

        const setorOperacional = extrairSetorOperacionalIsv(reg.nome || reg.complemento || p?.descricao || '');
        const embRes = this.resolverEmbalagemSpcoi(
          reg.codigo_interno,
          reg.digito,
          p?.embalagem || reg.complemento || 'UN'
        );

        // Enriquecer produto preservando dados completos da SMGOI013
        const prodItem: ProdutoSMG = p
          ? {
              ...p,
              embalagem: embRes.embalagem,
              setor_operacional: setorOperacional,
              embalagem_divergente: embRes.divergente,
              embalagens_divergentes: embRes.embalagensDistintas,
              estoque_total: reg.estoque,
              dias_sem_venda: reg.dias_sem_venda,
              idade: reg.idade,
              valor_estoque_planilha: reg.valor_disponivel !== null ? reg.valor_disponivel : undefined,
            }
          : {
              id: reg.codigo_interno,
              codigo_original: reg.codigo_original,
              codigo_interno: reg.codigo_interno,
              digito: reg.digito,
              codigo_exibicao: reg.codigo_exibicao,
              descricao: reg.nome,
              setor_operacional: setorOperacional,
              embalagem: embRes.embalagem,
              embalagem_divergente: embRes.divergente,
              embalagens_divergentes: embRes.embalagensDistintas,
              fator_embalagem: 1,
              unidade_medida: 'UN',
              estoque_emb1: reg.estoque,
              estoque_emb9: 0,
              estoque_total: reg.estoque,
              vendas_qtde_30d: 0,
              dias_sem_venda: reg.dias_sem_venda,
              idade: reg.idade,
              valor_estoque_planilha: reg.valor_disponivel !== null ? reg.valor_disponivel : undefined,
              eans: [],
              atualizado_em: new Date().toISOString(),
            };

        const estoqueFormatado = this.formatarEstoqueIsv(prodItem);
        const valorEstoque = reg.valor_disponivel;
        const valorEstoqueFormatado =
          valorEstoque !== null ? formatarMoedaBR(valorEstoque) : 'VALOR INDISPONÍVEL';

        const multiplosCnpjs = cnpjs.length > 1;
        const temPromotor = promotoresNomes.length > 0;

        const elegivelAjuste =
          reg.dias_sem_venda > 10 &&
          reg.estoque > 0 &&
          (valorEstoque === null || valorEstoque < 250);

        result[i] = {
          produto: prodItem,
          codigo_interno: reg.codigo_interno,
          digito: reg.digito,
          codigo_exibicao: reg.codigo_exibicao,
          descricao: reg.nome,
          setor_operacional: setorOperacional,
          embalagem: embRes.embalagem,
          embalagem_divergente: embRes.divergente,
          embalagens_divergentes: embRes.embalagensDistintas,
          estoque_total: reg.estoque,
          estoque_formatado: estoqueFormatado,
          dias_sem_venda: reg.dias_sem_venda,
          idade: reg.idade,
          custo_medio: p?.custo_medio !== undefined ? p.custo_medio : null,
          valor_estoque: valorEstoque,
          valor_estoque_formatado: valorEstoqueFormatado,
          cnpjs,
          industrias_nomes: industriasNomes,
          promotores_nomes: promotoresNomes,
          agencias_nomes: agenciasNomes,
          tem_promotor: temPromotor,
          multiplos_cnpjs: multiplosCnpjs,
          elegivel_ajuste: elegivelAjuste,
          vinculos_detalhados: undefined,
        };
      }
    } else {
      // =========================================================================
      // CASO 2: SEM NOVA PLANILHA OPERACIONAL (FALLBACK PARA BASE SMGOI013)
      // =========================================================================
      result = prods.map((p) => {
        const codNorm = p.codigo_interno.toString().trim().replace(/^0+/, '');
        const forns = fornecedoresPorCodigo.get(codNorm) || [];
        const cnpjs = Array.from(new Set(forns.map((f) => f.cnpj)));

        const industriasNomes = cnpjs.map((cnpj) => {
          const ind = industriasMap.get(cnpj);
          return ind?.nome_exibicao || ind?.razao_social || cnpj;
        });

        const promotoresNomesSet = new Set<string>();
        const agenciasNomesSet = new Set<string>();

        for (let j = 0; j < cnpjs.length; j++) {
          const vincs = vinculosPorCnpj.get(cnpjs[j]) || [];
          for (let k = 0; k < vincs.length; k++) {
            promotoresNomesSet.add(vincs[k].promotorNome);
            if (vincs[k].agenciaNome) agenciasNomesSet.add(vincs[k].agenciaNome);
          }
        }

        const promotoresNomes = Array.from(promotoresNomesSet);
        const agenciasNomes = Array.from(agenciasNomesSet);

        const setorOperacional = extrairSetorOperacionalIsv(p.descricao || '');
        const embRes = this.resolverEmbalagemSpcoi(
          p.codigo_interno,
          p.digito,
          p.embalagem || 'UN'
        );

        const valorEstoque = this.calcularValorEstoque(p);
        const estoqueFormatado = this.formatarEstoqueIsv(p);
        const multiplosCnpjs = cnpjs.length > 1;
        const temPromotor = promotoresNomes.length > 0;

        const diasSemVenda = p.dias_sem_venda || 0;
        const estoquePositivo = (p.estoque_total || 0) > 0;
        const elegivelAjuste =
          diasSemVenda > 10 &&
          estoquePositivo &&
          (valorEstoque === null || valorEstoque < 250);

        const prodAtualizado: ProdutoSMG = {
          ...p,
          setor_operacional: setorOperacional,
          embalagem: embRes.embalagem,
          embalagem_divergente: embRes.divergente,
          embalagens_divergentes: embRes.embalagensDistintas,
        };

        return {
          produto: prodAtualizado,
          codigo_interno: p.codigo_interno,
          digito: p.digito,
          codigo_exibicao: p.codigo_exibicao,
          descricao: p.descricao,
          setor_operacional: setorOperacional,
          embalagem: embRes.embalagem,
          embalagem_divergente: embRes.divergente,
          embalagens_divergentes: embRes.embalagensDistintas,
          estoque_total: p.estoque_total || 0,
          estoque_formatado: estoqueFormatado,
          dias_sem_venda: diasSemVenda,
          idade: p.idade || 0,
          custo_medio: p.custo_medio !== undefined ? p.custo_medio : null,
          valor_estoque: valorEstoque,
          valor_estoque_formatado:
            valorEstoque !== null ? formatarMoedaBR(valorEstoque) : 'VALOR INDISPONÍVEL',
          cnpjs,
          industrias_nomes: industriasNomes,
          promotores_nomes: promotoresNomes,
          agencias_nomes: agenciasNomes,
          tem_promotor: temPromotor,
          multiplos_cnpjs: multiplosCnpjs,
          elegivel_ajuste: elegivelAjuste,
          vinculos_detalhados: undefined,
        };
      });
    }

    // Ordenação padrão inicial por MAIOR_VALOR para resposta imediata
    result.sort((a, b) => {
      const hasA = a.valor_estoque !== null && a.valor_estoque !== undefined;
      const hasB = b.valor_estoque !== null && b.valor_estoque !== undefined;
      if (hasA && !hasB) return -1;
      if (!hasA && hasB) return 1;
      if (hasA && hasB) {
        const diff = (b.valor_estoque as number) - (a.valor_estoque as number);
        if (Math.abs(diff) > 0.0001) return diff;
      }
      const diffDias = (b.dias_sem_venda || 0) - (a.dias_sem_venda || 0);
      if (diffDias !== 0) return diffDias;
      const diffIdade = (b.idade || 0) - (a.idade || 0);
      if (diffIdade !== 0) return diffIdade;
      const codA = parseInt(a.codigo_interno, 10) || 0;
      const codB = parseInt(b.codigo_interno, 10) || 0;
      if (codA !== codB) return codA - codB;
      return (a.digito || '').localeCompare(b.digito || '');
    });

    this._itensIsvCache = result;
    this._baselineDashboard = this._computeDashboardData(result);

    return result;
  }

  /**
   * Aplica filtros combináveis sobre a lista de itens ISV com variáveis pré-computadas.
   */
  public filtrarItensIsv(itens: ItemIsv[], filtros: FiltrosIsv): ItemIsv[] {
    // Atalho de altíssimo desempenho: Se os filtros forem os padrões e ordenação por maior valor,
    // retorna a lista íntegra já ordenada sem alocar novo array ou reexecutar filtros O(N)
    if (isFiltrosPadrao(filtros) && (filtros.ordenacao === 'MAIOR_VALOR' || !filtros.ordenacao)) {
      return itens;
    }

    const q = filtros.termoBusca ? filtros.termoBusca.trim().toUpperCase() : '';
    const temBusca = q.length > 0;
    const qDigits = temBusca ? q.replace(/\D/g, '') : '';
    const qDigitsSemZero = qDigits.replace(/^0+/, '');

    const promotorAlvo = (filtros.promotorId && filtros.promotorId !== 'TODOS')
      ? promotorService.getPromotores().find((pr) => pr.promotorId === filtros.promotorId)
      : undefined;
    const promotorNomeAlvo = promotorAlvo?.nome;

    const normFiltroCnpj = (filtros.industriaCnpj && filtros.industriaCnpj !== 'TODAS')
      ? normalizarCnpj(filtros.industriaCnpj)
      : undefined;

    return itens
      .filter((item) => {
        // 1. Termo de busca abrangente (Código raiz, código com dígito, descrição, EAN, Indústria, CNPJ)
        if (temBusca) {
          const matchCod = item.codigo_interno.includes(q) || (qDigitsSemZero.length > 0 && item.codigo_interno.includes(qDigitsSemZero));
          const codComDigito = `${item.codigo_interno}-${item.digito || ''}`.toUpperCase();
          const codComDigitoSemHifen = `${item.codigo_interno}${item.digito || ''}`.toUpperCase();
          const matchExib = item.codigo_exibicao.toUpperCase().includes(q) ||
            codComDigito.includes(q) ||
            (qDigits.length > 0 && codComDigitoSemHifen.includes(qDigits));
          const matchDesc = item.descricao.toUpperCase().includes(q);
          const matchEan = (item.produto.eans || []).some((e) => e.includes(q) || (qDigits.length > 0 && e.includes(qDigits)));
          const matchIndustria = (item.industrias_nomes || []).some((ind) => ind.toUpperCase().includes(q));
          const matchCnpj = (item.cnpjs || []).some((cnpj) => {
            if (cnpj.includes(q)) return true;
            if (qDigits.length >= 3) {
              const cnpjLimpo = cnpj.replace(/\D/g, '');
              const cnpjSemZero = cnpjLimpo.replace(/^0+/, '');
              if (cnpjLimpo.includes(qDigits) || cnpjSemZero.includes(qDigitsSemZero)) return true;
            }
            return false;
          });

          if (!matchCod && !matchExib && !matchDesc && !matchEan && !matchIndustria && !matchCnpj) {
            return false;
          }
        }

        // 1.1. Setor Operacional Oficial (FRIOS, ACOUGUE, HORTIFRUTI, LOJA)
        const setorFiltro = filtros.setorOperacional === 'CAFETERIA' ? 'LOJA' : filtros.setorOperacional;
        if (setorFiltro && setorFiltro !== 'TODOS') {
          if (item.setor_operacional !== setorFiltro) {
            return false;
          }
        }

        // 2. Agência
        if (filtros.agencia && filtros.agencia !== 'TODAS') {
          if (!item.agencias_nomes.includes(filtros.agencia)) return false;
        }

        // 3. Indústria (por CNPJ)
        if (normFiltroCnpj) {
          if (!item.cnpjs.includes(normFiltroCnpj)) return false;
        }

        // 4. Promotor
        if (promotorNomeAlvo) {
          if (!item.promotores_nomes.includes(promotorNomeAlvo)) {
            return false;
          }
        }

        // 5. Setor Físico
        if (filtros.setorFisico && filtros.setorFisico !== 'TODOS') {
          if (item.produto.setor_fisico !== filtros.setorFisico) return false;
        }

        // 6. Setor Balanço
        if (filtros.setorBalanco && filtros.setorBalanco !== 'TODOS') {
          if (item.produto.setor_balanco !== filtros.setorBalanco) return false;
        }

        // 7. Dias Sem Venda
        if (filtros.diasSemVenda !== null && filtros.diasSemVenda !== undefined) {
          if (filtros.modoDiasSemVenda === 'EXATO') {
            if (item.dias_sem_venda !== filtros.diasSemVenda) return false;
          } else {
            if (item.dias_sem_venda < filtros.diasSemVenda) return false;
          }
        }

        // 8. Idade da Mercadoria
        if (filtros.idade !== null && filtros.idade !== undefined) {
          if (filtros.modoIdade === 'EXATO') {
            if (item.idade !== filtros.idade) return false;
          } else {
            if (item.idade < filtros.idade) return false;
          }
        }

        // 9. Situação do Estoque
        if (filtros.filtroEstoque === 'COM_ESTOQUE' && item.estoque_total <= 0) {
          return false;
        }
        if (filtros.filtroEstoque === 'SEM_ESTOQUE' && item.estoque_total > 0) {
          return false;
        }

        // 10. Faixa de Valor Financeiro do Estoque
        if (filtros.filtroValor === 'ATE_250') {
          if (item.valor_estoque === null || item.valor_estoque > 250) return false;
        } else if (filtros.filtroValor === 'ACIMA_250') {
          if (item.valor_estoque === null || item.valor_estoque <= 250) return false;
        } else if (filtros.filtroValor === 'CUSTOM') {
          if (filtros.valorMin !== undefined && (item.valor_estoque === null || item.valor_estoque < filtros.valorMin)) {
            return false;
          }
          if (filtros.valorMax !== undefined && (item.valor_estoque === null || item.valor_estoque > filtros.valorMax)) {
            return false;
          }
        }

        // 11. Situação da Vinculação
        if (filtros.situacaoVinculo === 'COM_PROMOTOR' && !item.tem_promotor) {
          return false;
        }
        if (filtros.situacaoVinculo === 'SEM_PROMOTOR' && item.tem_promotor) {
          return false;
        }
        if (filtros.situacaoVinculo === 'MULTIPLOS_CNPJS' && !item.multiplos_cnpjs) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Ordenação padrão: MAIOR VALOR DO ESTOQUE
        // Regra obrigatória:
        // - Produtos sem valor calculável ficam no fim da classificação (nunca ocupam primeiras posições).
        // - Classificação numérica decrescente.
        // - Em caso de empate, utilizar código interno numérico e dígito como desempate estável.
        if (filtros.ordenacao === 'MAIOR_VALOR') {
          const hasA = a.valor_estoque !== null && a.valor_estoque !== undefined;
          const hasB = b.valor_estoque !== null && b.valor_estoque !== undefined;
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          if (hasA && hasB) {
            const diff = (b.valor_estoque as number) - (a.valor_estoque as number);
            if (Math.abs(diff) > 0.0001) return diff;
          }
          // Critério de desempate:
          // 1. Mais dias sem venda
          const diffDias = (b.dias_sem_venda || 0) - (a.dias_sem_venda || 0);
          if (diffDias !== 0) return diffDias;
          // 2. Maior idade
          const diffIdade = (b.idade || 0) - (a.idade || 0);
          if (diffIdade !== 0) return diffIdade;
          // 3. Código interno numérico e depois dígito
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          if (codA !== codB) return codA - codB;
          return (a.digito || '').localeCompare(b.digito || '');
        }

        if (filtros.ordenacao === 'MENOR_VALOR') {
          const hasA = a.valor_estoque !== null && a.valor_estoque !== undefined;
          const hasB = b.valor_estoque !== null && b.valor_estoque !== undefined;
          if (hasA && !hasB) return -1;
          if (!hasA && hasB) return 1;
          if (hasA && hasB) {
            const diff = (a.valor_estoque as number) - (b.valor_estoque as number);
            if (Math.abs(diff) > 0.0001) return diff;
          }
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          if (codA !== codB) return codA - codB;
          return (a.digito || '').localeCompare(b.digito || '');
        }

        if (filtros.ordenacao === 'MAIS_DIAS_SEM_VENDA') {
          const diff = b.dias_sem_venda - a.dias_sem_venda;
          if (diff !== 0) return diff;
          const valA = a.valor_estoque ?? -1;
          const valB = b.valor_estoque ?? -1;
          if (valB !== valA) return valB - valA;
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          return codA - codB;
        }

        if (filtros.ordenacao === 'MAIOR_IDADE') {
          const diff = b.idade - a.idade;
          if (diff !== 0) return diff;
          const valA = a.valor_estoque ?? -1;
          const valB = b.valor_estoque ?? -1;
          if (valB !== valA) return valB - valA;
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          return codA - codB;
        }

        if (filtros.ordenacao === 'CODIGO') {
          const codA = parseInt(a.codigo_interno, 10) || 0;
          const codB = parseInt(b.codigo_interno, 10) || 0;
          if (codA !== codB) return codA - codB;
          return (a.digito || '').localeCompare(b.digito || '');
        }

        return 0;
      });
  }

  /**
   * Obtém os indicadores e top 10 do Dashboard com retorno imediato O(1) quando
   * os filtros são os padrões, ou computação unificada em passagem única (single-pass O(N))
   * quando filtros estão ativos, eliminando múltiplos laços e cópias desnecessárias.
   */
  public getDashboardData(itensFiltrados: ItemIsv[], filtros: FiltrosIsv): DashboardData {
    if (isFiltrosPadrao(filtros) && this._baselineDashboard) {
      return this._baselineDashboard;
    }
    return this._computeDashboardData(itensFiltrados);
  }

  /**
   * Computa todos os agregados do Dashboard (Indicadores + Top 10 Produtos + Top 10 Indústrias + Top 10 Agências)
   * em um único percurso linear pelos registros (Single-pass O(N)).
   */
  private _computeDashboardData(itens: ItemIsv[]): DashboardData {
    let valorTotal = 0;
    const industriasSet = new Set<string>();
    const agenciasSet = new Set<string>();

    const mapaInd = new Map<string, {
      cnpj: string;
      nome: string;
      razaoSocial?: string;
      valorTotal: number;
      skusSet: Set<string>;
      itens: ItemIsv[];
    }>();

    const mapaAg = new Map<string, {
      nome: string;
      valorTotal: number;
      skusSet: Set<string>;
      industriasSet: Set<string>;
      promotoresSet: Set<string>;
      itens: ItemIsv[];
    }>();

    const produtosComValor: ItemIsv[] = [];

    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      const val = it.valor_estoque || 0;

      if (it.valor_estoque !== null && it.valor_estoque !== undefined) {
        valorTotal += it.valor_estoque;
        if (it.valor_estoque > 0) {
          produtosComValor.push(it);
        }
      }

      // Agregação de Indústrias
      const cnpjs = it.cnpjs && it.cnpjs.length > 0 ? it.cnpjs : ['SEM_CNPJ'];
      for (let j = 0; j < cnpjs.length; j++) {
        const cnpj = cnpjs[j];
        if (cnpj !== 'SEM_CNPJ') {
          industriasSet.add(cnpj);
        }

        let indEntry = mapaInd.get(cnpj);
        if (!indEntry) {
          const indObj = this.getIndustriaByCnpj(cnpj);
          const nome = cnpj === 'SEM_CNPJ'
            ? 'Indústria não informada'
            : (indObj?.nome_exibicao || indObj?.razao_social || cnpj);
          indEntry = {
            cnpj,
            nome,
            razaoSocial: indObj?.razao_social,
            valorTotal: 0,
            skusSet: new Set<string>(),
            itens: [],
          };
          mapaInd.set(cnpj, indEntry);
        }

        if (!indEntry.skusSet.has(it.codigo_interno)) {
          indEntry.skusSet.add(it.codigo_interno);
          indEntry.valorTotal += val;
          indEntry.itens.push(it);
        }
      }

      // Agregação de Agências
      const ags = it.agencias_nomes && it.agencias_nomes.length > 0 ? it.agencias_nomes : ['Sem Agência'];
      for (let k = 0; k < ags.length; k++) {
        const ag = ags[k];
        if (ag && ag.trim() && ag !== 'Sem Agência') {
          agenciasSet.add(ag.trim());
        }

        let agEntry = mapaAg.get(ag);
        if (!agEntry) {
          agEntry = {
            nome: ag,
            valorTotal: 0,
            skusSet: new Set<string>(),
            industriasSet: new Set<string>(),
            promotoresSet: new Set<string>(),
            itens: [],
          };
          mapaAg.set(ag, agEntry);
        }

        if (!agEntry.skusSet.has(it.codigo_interno)) {
          agEntry.skusSet.add(it.codigo_interno);
          agEntry.valorTotal += val;
          agEntry.itens.push(it);
        }

        for (let inIdx = 0; inIdx < it.industrias_nomes.length; inIdx++) {
          agEntry.industriasSet.add(it.industrias_nomes[inIdx]);
        }
        for (let prIdx = 0; prIdx < it.promotores_nomes.length; prIdx++) {
          agEntry.promotoresSet.add(it.promotores_nomes[prIdx]);
        }
      }
    }

    // Top 10 Produtos
    produtosComValor.sort((a, b) => (b.valor_estoque || 0) - (a.valor_estoque || 0));
    const top10Produtos = produtosComValor.slice(0, 10);

    // Top 10 Indústrias
    const top10Industrias = Array.from(mapaInd.values())
      .filter((ind) => ind.valorTotal > 0)
      .sort((a, b) => b.valorTotal - a.valorTotal)
      .slice(0, 10);

    // Top 10 Agências
    const top10Agencias = Array.from(mapaAg.values())
      .filter((ag) => ag.valorTotal > 0)
      .sort((a, b) => b.valorTotal - a.valorTotal)
      .slice(0, 10);

    return {
      indicadores: {
        valorTotal: Number(valorTotal.toFixed(2)),
        totalSkus: itens.length,
        totalIndustrias: industriasSet.size,
        totalAgencias: agenciasSet.size,
      },
      top10Produtos,
      top10Industrias,
      top10Agencias,
    };
  }

  /**
   * Consolida métricas resumidas do painel ISV garantindo que produtos com múltiplos
   * vínculos não dupliquem o valor financeiro ou a contagem geral.
   */
  public getIndicadoresIsv(itens: ItemIsv[]): {
    totalProdutos: number;
    produtosComEstoque: number;
    valorTotalEstoque: number;
    totalIndustrias: number;
    totalPromotores: number;
    produtosSemResponsavel: number;
    candidatosAjuste: number;
    qtdComValor: number;
    qtdSemValor: number;
  } {
    const produtosUnicos = new Set<string>();
    let produtosComEstoque = 0;
    let valorTotalEstoque = 0;
    const industriasSet = new Set<string>();
    const promotoresSet = new Set<string>();
    let produtosSemResponsavel = 0;
    let candidatosAjuste = 0;
    let qtdComValor = 0;
    let qtdSemValor = 0;

    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];

      if (it.valor_estoque !== null) {
        qtdComValor++;
      } else {
        qtdSemValor++;
      }

      if (!produtosUnicos.has(it.codigo_interno)) {
        produtosUnicos.add(it.codigo_interno);

        if (it.estoque_total > 0) produtosComEstoque++;
        if (it.valor_estoque !== null) valorTotalEstoque += it.valor_estoque;
        if (!it.tem_promotor) produtosSemResponsavel++;
        if (it.elegivel_ajuste) candidatosAjuste++;
      }

      for (let j = 0; j < it.cnpjs.length; j++) {
        industriasSet.add(it.cnpjs[j]);
      }
      for (let j = 0; j < it.promotores_nomes.length; j++) {
        promotoresSet.add(it.promotores_nomes[j]);
      }
    }

    return {
      totalProdutos: produtosUnicos.size,
      produtosComEstoque,
      valorTotalEstoque: Number(valorTotalEstoque.toFixed(2)),
      totalIndustrias: industriasSet.size,
      totalPromotores: promotoresSet.size,
      produtosSemResponsavel,
      candidatosAjuste,
      qtdComValor,
      qtdSemValor,
    };
  }

  // ==========================================
  // OCORRÊNCIAS / POSSÍVEIS AJUSTES
  // ==========================================

  public getSolicitacoesAjuste(): SolicitacaoAjusteIsv[] {
    return [...this._solicitacoesAjuste];
  }

  public async addSolicitacaoAjuste(
    dados: Omit<SolicitacaoAjusteIsv, 'id' | 'data_registro' | 'status'>
  ): Promise<SolicitacaoAjusteIsv> {
    const id = `ajuste_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const dataAtual = new Date().toLocaleString('pt-BR');

    const nova: SolicitacaoAjusteIsv = {
      ...dados,
      id,
      status: 'PENDENTE',
      data_registro: dataAtual,
      historico: [
        {
          data: dataAtual,
          acao: 'Ocorrência de divergência física registrada no ISV',
          usuario: dados.responsavel || 'Operador',
        },
      ],
    };

    this._solicitacoesAjuste = [nova, ...this._solicitacoesAjuste];
    await dbPut(STORES.ISV_SOLICITACOES_AJUSTE, nova);
    this._notify();
    return nova;
  }

  public async updateSolicitacaoAjuste(
    id: string,
    updates: Partial<SolicitacaoAjusteIsv>
  ): Promise<void> {
    const idx = this._solicitacoesAjuste.findIndex((s) => s.id === id);
    if (idx < 0) return;

    const item = {
      ...this._solicitacoesAjuste[idx],
      ...updates,
    };

    this._solicitacoesAjuste[idx] = item;
    await dbPut(STORES.ISV_SOLICITACOES_AJUSTE, item);
    this._notify();
  }
}

export const isvService = new IsvService();
