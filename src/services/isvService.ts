import {
  FiltrosIsv,
  FornecedorSPCOI007,
  Industria,
  ItemIsv,
  ProdutoSMG,
  Promotor,
  ResumoImportacaoSPCOI007,
  SolicitacaoAjusteIsv,
  VinculoPromotorIndustria,
} from '../types';
import { isProdutoPesavel, parseEmbalagem } from './codeParser';
import { dbGetAll, dbPut, dbPutAll, STORES } from './db';
import { formatarMoedaBR } from './deviceId';
import { promotorService } from './promotorService';
import { formatarCnpj, normalizarCnpj } from './spcoi007Parser';
import { getProdutos } from './storage';

type IsvChangeListener = () => void;

class IsvService {
  private _fornecedores: FornecedorSPCOI007[] = [];
  private _industrias: Industria[] = [];
  private _vinculos: VinculoPromotorIndustria[] = [];
  private _solicitacoesAjuste: SolicitacaoAjusteIsv[] = [];
  private _historicoSpcoi: ResumoImportacaoSPCOI007[] = [];
  private _listeners = new Set<IsvChangeListener>();
  private _isInitialized = false;

  public async init(): Promise<void> {
    if (this._isInitialized) return;

    try {
      const [fornec, indus, vincs, ajus, hist] = await Promise.all([
        dbGetAll<FornecedorSPCOI007>(STORES.SPCOI007_FORNECEDORES),
        dbGetAll<Industria>(STORES.INDUSTRIAS),
        dbGetAll<VinculoPromotorIndustria>(STORES.VINCULOS_PROMOTOR_INDUSTRIA),
        dbGetAll<SolicitacaoAjusteIsv>(STORES.ISV_SOLICITACOES_AJUSTE),
        dbGetAll<ResumoImportacaoSPCOI007>(STORES.HISTORICO_IMPORTACOES_SPCOI007),
      ]);

      this._fornecedores = fornec || [];
      this._industrias = indus || [];
      this._vinculos = vincs || [];
      this._solicitacoesAjuste = ajus || [];
      this._historicoSpcoi = hist || [];

      // Se a base de indústrias estiver vazia, inicializar com semente de teste operacional
      if (this._industrias.length === 0 && this._fornecedores.length === 0) {
        await this._seedInitialData();
      }

      this._isInitialized = true;
    } catch (err) {
      console.warn('Erro ao carregar dados do ISV do IndexedDB:', err);
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

    // 3. Persistir de forma atômica no IndexedDB
    await Promise.all([
      dbPutAll(STORES.SPCOI007_FORNECEDORES, fornecedores),
      dbPutAll(STORES.INDUSTRIAS, industriasAtualizadas),
      dbPutAll(STORES.HISTORICO_IMPORTACOES_SPCOI007, this._historicoSpcoi),
    ]);

    this._notify();
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
    const est = produto.estoque_total || 0;
    if (est <= 0) return '0 UN';

    const isPeso =
      (produto.unidade_medida && produto.unidade_medida.toUpperCase() === 'KG') ||
      isProdutoPesavel(produto.embalagem);

    if (isPeso) {
      const kg = Math.floor(est);
      const gramas = Math.round((est - kg) * 1000);
      const parts: string[] = [];
      if (kg > 0) parts.push(`${kg} KG`);
      if (gramas > 0) parts.push(`${gramas} G`);
      if (parts.length === 0) return '0 KG';
      return parts.join(' + ');
    }

    const embData = parseEmbalagem(produto.embalagem || '');
    if (embData.fator && embData.fator > 1) {
      const rounded = Math.round(est);
      const cx = Math.floor(rounded / embData.fator);
      const un = rounded % embData.fator;
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
    if (produto.custo_medio === undefined || produto.custo_medio === null || isNaN(produto.custo_medio)) {
      return null;
    }
    const custo = Number(produto.custo_medio);
    if (custo <= 0) return null;

    const est = produto.estoque_total || 0;
    if (est <= 0) return 0;

    return Number((est * custo).toFixed(2));
  }

  /**
   * Constrói e enriquece a lista de itens ISV com cruzamento de relacionamentos:
   * Produto (SMGOI013) ↔ Fornecedor/Indústria (SPCOI007) ↔ Promotor/Agência (Vínculos)
   */
  public getItensIsv(produtos?: ProdutoSMG[]): ItemIsv[] {
    const prods = produtos || getProdutos();

    // Mapas rápidos em memória
    // codigo_interno -> FornecedorSPCOI007[]
    const fornecedoresPorCodigo = new Map<string, FornecedorSPCOI007[]>();
    this._fornecedores.forEach((f) => {
      if (!fornecedoresPorCodigo.has(f.codigo_interno)) {
        fornecedoresPorCodigo.set(f.codigo_interno, []);
      }
      fornecedoresPorCodigo.get(f.codigo_interno)!.push(f);
    });

    // cnpj -> Industria
    const industriasMap = new Map<string, Industria>();
    this._industrias.forEach((i) => industriasMap.set(i.cnpj, i));

    // cnpj -> VinculoPromotorIndustria[]
    const vinculosPorCnpj = new Map<string, VinculoPromotorIndustria[]>();
    this._vinculos.forEach((v) => {
      if (!vinculosPorCnpj.has(v.cnpj)) {
        vinculosPorCnpj.set(v.cnpj, []);
      }
      vinculosPorCnpj.get(v.cnpj)!.push(v);
    });

    return prods.map((p) => {
      const forns = fornecedoresPorCodigo.get(p.codigo_interno) || [];
      const cnpjs = Array.from(new Set(forns.map((f) => f.cnpj)));

      const industriasNomes = cnpjs.map((cnpj) => {
        const ind = industriasMap.get(cnpj);
        return ind?.nome_exibicao || ind?.razao_social || cnpj;
      });

      const promotoresNomesSet = new Set<string>();
      const agenciasNomesSet = new Set<string>();

      cnpjs.forEach((cnpj) => {
        const vincs = vinculosPorCnpj.get(cnpj) || [];
        vincs.forEach((v) => {
          promotoresNomesSet.add(v.promotorNome);
          if (v.agenciaNome) agenciasNomesSet.add(v.agenciaNome);
        });
      });

      const promotoresNomes = Array.from(promotoresNomesSet);
      const agenciasNomes = Array.from(agenciasNomesSet);

      const valorEstoque = this.calcularValorEstoque(p);
      const estoqueFormatado = this.formatarEstoqueIsv(p);
      const multiplosCnpjs = cnpjs.length > 1;
      const temPromotor = promotoresNomes.length > 0;

      // Critério de elegibilidade para possíveis ajustes:
      // - Mais de 10 dias sem venda
      // - Valor total do estoque inferior a R$ 250 (ou valor indisponível com estoque > 0)
      // - Estoque físico registrado maior que zero
      const diasSemVenda = p.dias_sem_venda || 0;
      const estoquePositivo = (p.estoque_total || 0) > 0;
      const elegivelAjuste =
        diasSemVenda > 10 &&
        estoquePositivo &&
        (valorEstoque === null || valorEstoque < 250);

      return {
        produto: p,
        codigo_interno: p.codigo_interno,
        digito: p.digito,
        codigo_exibicao: p.codigo_exibicao,
        descricao: p.descricao,
        embalagem: p.embalagem,
        estoque_total: p.estoque_total || 0,
        estoque_formatado: estoqueFormatado,
        dias_sem_venda: diasSemVenda,
        idade: p.idade || 0,
        custo_medio: p.custo_medio !== undefined ? p.custo_medio : null,
        valor_estoque: valorEstoque,
        valor_estoque_formatado:
          valorEstoque !== null ? formatarMoedaBR(valorEstoque) : '-',
        cnpjs,
        industrias_nomes: industriasNomes,
        promotores_nomes: promotoresNomes,
        agencias_nomes: agenciasNomes,
        tem_promotor: temPromotor,
        multiplos_cnpjs: multiplosCnpjs,
        elegivel_ajuste: elegivelAjuste,
      };
    });
  }

  /**
   * Aplica filtros combináveis sobre a lista de itens ISV.
   */
  public filtrarItensIsv(itens: ItemIsv[], filtros: FiltrosIsv): ItemIsv[] {
    return itens
      .filter((item) => {
        // 1. Termo de busca (Código interno, dígito, código completo, descrição, EAN)
        if (filtros.termoBusca && filtros.termoBusca.trim()) {
          const q = filtros.termoBusca.trim().toUpperCase();
          const matchCod = item.codigo_interno.includes(q);
          const matchExib = item.codigo_exibicao.toUpperCase().includes(q);
          const matchDesc = item.descricao.toUpperCase().includes(q);
          const matchEan = (item.produto.eans || []).some((e) => e.includes(q));
          if (!matchCod && !matchExib && !matchDesc && !matchEan) {
            return false;
          }
        }

        // 2. Agência
        if (filtros.agencia && filtros.agencia !== 'TODAS') {
          if (!item.agencias_nomes.includes(filtros.agencia)) return false;
        }

        // 3. Indústria (por CNPJ)
        if (filtros.industriaCnpj && filtros.industriaCnpj !== 'TODAS') {
          const normCnpj = normalizarCnpj(filtros.industriaCnpj);
          if (!item.cnpjs.includes(normCnpj)) return false;
        }

        // 4. Promotor
        if (filtros.promotorId && filtros.promotorId !== 'TODOS') {
          // Localizar nome do promotor para cruzamento
          const promotor = promotorService
            .getPromotores()
            .find((pr) => pr.promotorId === filtros.promotorId);
          if (promotor && !item.promotores_nomes.includes(promotor.nome)) {
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
        if (filtros.ordenacao === 'MAIOR_VALOR') {
          const valA = a.valor_estoque !== null ? a.valor_estoque : -1;
          const valB = b.valor_estoque !== null ? b.valor_estoque : -1;
          return valB - valA;
        }
        if (filtros.ordenacao === 'MENOR_VALOR') {
          const valA = a.valor_estoque !== null ? a.valor_estoque : 999999999;
          const valB = b.valor_estoque !== null ? b.valor_estoque : 999999999;
          return valA - valB;
        }
        if (filtros.ordenacao === 'MAIS_DIAS_SEM_VENDA') {
          return b.dias_sem_venda - a.dias_sem_venda;
        }
        if (filtros.ordenacao === 'MAIOR_IDADE') {
          return b.idade - a.idade;
        }
        if (filtros.ordenacao === 'CODIGO') {
          return a.codigo_interno.localeCompare(b.codigo_interno, undefined, { numeric: true });
        }
        return 0;
      });
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
  } {
    const produtosUnicos = new Set<string>();
    let produtosComEstoque = 0;
    let valorTotalEstoque = 0;
    const industriasSet = new Set<string>();
    const promotoresSet = new Set<string>();
    let produtosSemResponsavel = 0;
    let candidatosAjuste = 0;

    itens.forEach((it) => {
      if (!produtosUnicos.has(it.codigo_interno)) {
        produtosUnicos.add(it.codigo_interno);

        if (it.estoque_total > 0) produtosComEstoque++;
        if (it.valor_estoque !== null) valorTotalEstoque += it.valor_estoque;
        if (!it.tem_promotor) produtosSemResponsavel++;
        if (it.elegivel_ajuste) candidatosAjuste++;
      }

      it.cnpjs.forEach((cnpj) => industriasSet.add(cnpj));
      it.promotores_nomes.forEach((pr) => promotoresSet.add(pr));
    });

    return {
      totalProdutos: produtosUnicos.size,
      produtosComEstoque,
      valorTotalEstoque: Number(valorTotalEstoque.toFixed(2)),
      totalIndustrias: industriasSet.size,
      totalPromotores: promotoresSet.size,
      produtosSemResponsavel,
      candidatosAjuste,
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
