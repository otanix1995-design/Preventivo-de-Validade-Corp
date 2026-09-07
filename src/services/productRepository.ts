/**
 * Product Repository - Central Single Source of Truth
 * 
 * Manages all SMGOI013 products, EAN linkages, and operational data.
 * Backed by IndexedDB for durable, quota-free storage of 11,600+ records,
 * and maintains high-speed in-memory indices for sub-millisecond search & lookups.
 */

import {
  DivergenciaRegistro,
  LoteVencimento,
  MetadadosBase,
  ProdutoSMG,
  RegistroSaeou060,
  ResumoImportacao,
  StatusSaeou060,
  VinculoEan
} from '../types';
import { cleanEanCode, extractGramagem, isProdutoPesavel, normalizeCodigoSMGO } from './codeParser';
import {
  findDuplicateVencimento,
  formatDateBr,
  normalizeDateToIso,
  normalizeInternalCode
} from './duplicateValidator';
import { cloudSyncService } from './cloudSyncService';
import {
  dbClear,
  dbGetAll,
  dbGetMeta,
  dbPut,
  dbPutAll,
  dbSetMeta,
  STORES
} from './db';
import {
  DEMO_DIVERGENCIAS,
  DEMO_PRODUTOS,
  DEMO_SAEOU060,
  DEMO_VENCIMENTOS,
  DEMO_VINCULOS
} from './demoData';

type ListenerCallback = () => void;

function normalizeSearchText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

class ProductRepository {
  private _produtos: ProdutoSMG[] = [];
  private _vinculos: VinculoEan[] = [];
  private _vencimentos: LoteVencimento[] = [];
  private _saeou060: RegistroSaeou060[] = [];
  private _divergencias: DivergenciaRegistro[] = [];
  private _historico: ResumoImportacao[] = [];
  private _savingLoteKeys = new Set<string>();
  private _metadados: MetadadosBase = {
    filial_numero: '172',
    filial_nome: 'CASCAVEL',
    status_base: 'VAZIA',
    total_produtos: 0,
    total_vencimentos: 0,
    total_eans: 0,
    total_saeou060: 0,
  };

  private _isLoaded = false;
  private _initPromise: Promise<void> | null = null;
  private _listeners = new Set<ListenerCallback>();

  // Central Fast Index Maps
  private _byInternalCode = new Map<string, ProdutoSMG>();
  private _byFullCode = new Map<string, ProdutoSMG>();
  private _byOriginalCode = new Map<string, ProdutoSMG>();
  private _byBarcode = new Map<string, ProdutoSMG>();
  private _byNormalizedKey = new Map<string, ProdutoSMG>();

  // Sector indexes for high-performance classification
  private _bySectorFisico = new Map<string, ProdutoSMG[]>();
  private _bySectorBalanco = new Map<string, ProdutoSMG[]>();
  private _setoresFisicosList: string[] = [];
  private _setoresBalancoList: string[] = [];
  private _productSectorByCode = new Map<string, { setorFisico?: string; setorBalanco?: string }>();

  constructor() {
    // Start async initialization immediately
    this.init();
  }

  public subscribe(cb: ListenerCallback): () => void {
    this._listeners.add(cb);
    return () => {
      this._listeners.delete(cb);
    };
  }

  private notify(): void {
    this._listeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('Error in productRepository listener:', err);
      }
    });
  }

  /**
   * Initializes the repository by loading all stores from IndexedDB into memory.
   */
  public async init(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        const [
          produtos,
          vinculos,
          vencimentos,
          saeou060,
          divergencias,
          historico,
          metadados
        ] = await Promise.all([
          dbGetAll<ProdutoSMG>(STORES.PRODUTOS),
          dbGetAll<VinculoEan>(STORES.VINCULOS_EAN),
          dbGetAll<LoteVencimento>(STORES.VENCIMENTOS),
          dbGetAll<RegistroSaeou060>(STORES.SAEOU060),
          dbGetAll<DivergenciaRegistro>(STORES.DIVERGENCIAS),
          dbGetAll<ResumoImportacao>(STORES.HISTORICO_IMPORTACOES),
          dbGetMeta<MetadadosBase>('metadados_gerais', {
            filial_numero: '172',
            filial_nome: 'CASCAVEL',
            status_base: 'VAZIA',
            total_produtos: 0,
            total_vencimentos: 0,
            total_eans: 0,
            total_saeou060: 0,
          }),
        ]);

        if (produtos.length > 0 || saeou060.length > 0) {
          this._produtos = produtos;
          this._vinculos = vinculos;
          this._vencimentos = vencimentos;
          this._saeou060 = saeou060;
          this._divergencias = divergencias;
          this._historico = historico;
          this._metadados = {
            ...metadados,
            total_produtos: produtos.length,
            total_vencimentos: vencimentos.length,
            total_eans: vinculos.length,
            total_saeou060: saeou060.length,
          };
          this.rebuildIndices();
        } else {
          // Check if localStorage has existing demo/legacy data to migrate
          const legacyMetaRaw = localStorage.getItem('cv_metadados_v1');
          if (!legacyMetaRaw) {
            // First run: load initial demo data so application is ready for immediate test
            await this.loadDemoData();
          } else {
            // Empty state
            this._produtos = [];
            this._vinculos = vinculos;
            this._vencimentos = vencimentos;
            this._saeou060 = saeou060;
            this._divergencias = divergencias;
            this._historico = historico;
            this._metadados = {
              ...metadados,
              status_base: 'VAZIA',
              total_produtos: 0,
              total_vencimentos: vencimentos.length,
              total_eans: vinculos.length,
              total_saeou060: saeou060.length,
            };
            this.rebuildIndices();
          }
        }

        this._isLoaded = true;
        this.notify();

        // Configure real-time Cloud Synchronization (Firebase Firestore)
        cloudSyncService.registerCallbacks({
          onRemoteCatalogoReceived: async (remoteProdutos, meta) => {
            this._produtos = remoteProdutos;
            this._metadados = {
              ...this._metadados,
              ...meta,
              status_base: 'SMGOI013',
              total_produtos: remoteProdutos.length,
            };
            this.rebuildIndices();
            await dbPutAll(STORES.PRODUTOS, remoteProdutos, true);
            await dbSetMeta('metadados_gerais', this._metadados);
            this.notify();
          },
          onRemoteVinculosReceived: async (remoteVinculos) => {
            this._vinculos = remoteVinculos;
            this.rebuildIndices();
            await dbPutAll(STORES.VINCULOS_EAN, remoteVinculos, true);
            this.notify();
          },
          onRemoteSaeou060Received: async (remoteSaeou) => {
            this._saeou060 = remoteSaeou;
            await dbPutAll(STORES.SAEOU060, remoteSaeou, true);
            this.notify();
          },
          onRemoteVencimentosReceived: (remoteVencimentos) => {
            if (remoteVencimentos.length > 0 || this._vencimentos.length > 0) {
              this._vencimentos = remoteVencimentos;
              this._metadados.total_vencimentos = remoteVencimentos.length;
              dbPutAll(STORES.VENCIMENTOS, remoteVencimentos, true).catch(() => {});
              this.notify();
            }
          },
          onRemoteHistoricoReceived: (remoteHist) => {
            this._historico = remoteHist;
            dbPutAll(STORES.HISTORICO_IMPORTACOES, remoteHist, true).catch(() => {});
            this.notify();
          },
        });

        // Seed cloud sync service with local catalog version timestamp
        const localCatVersion = this._produtos.length > 0 ? (this._metadados.catalogo_version || 1) : 0;
        const localVincVersion = this._vinculos.length > 0 ? (this._metadados.vinculos_version || 1) : 0;
        const localSaeouVersion = this._saeou060.length > 0 ? (this._metadados.saeou060_version || 1) : 0;
        cloudSyncService.setLocalVersions({
          catalogoVersion: localCatVersion,
          vinculosVersion: localVincVersion,
          saeou060Version: localSaeouVersion,
        });

        // Initialize background cloud sync (subscribes to onSnapshot real-time events)
        cloudSyncService.init().catch((e) => console.warn('Cloud sync init error:', e));
      } catch (err) {
        console.error('Erro na inicialização do productRepository:', err);
        this._isLoaded = true;
        this.notify();
      }
    })();

    return this._initPromise;
  }

  public isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * Rebuilds all central index maps in memory for fast O(1) lookups and crosses vínculos.
   */
  public rebuildIndices(): void {
    this._byInternalCode.clear();
    this._byFullCode.clear();
    this._byOriginalCode.clear();
    this._byBarcode.clear();
    this._byNormalizedKey.clear();
    this._bySectorFisico.clear();
    this._bySectorBalanco.clear();
    this._productSectorByCode.clear();

    const produtos = this._produtos;
    const isBaseEmpty = produtos.length === 0;
    const setFisico = new Set<string>();
    const setBalanco = new Set<string>();

    // 1. Index all products and precompute search & gramagem properties
    for (let i = 0; i < produtos.length; i++) {
      const p = produtos[i];
      const norm = normalizeCodigoSMGO(
        p.codigo_original || p.codigo_exibicao || p.codigo_interno,
        p.digito
      );

      // Ensure normalized properties exist on the object
      p.codigo_interno = norm.codigoInterno;
      p.digito = norm.digito || p.digito || '';
      p.codigo_exibicao = norm.codigoExibicao;
      p.chave_normalizada = norm.chaveNormalizada;
      p.codigo_original = p.codigo_original || norm.codigoOriginal;

      // Precalculate normalized search & presentation fields for zero-lag filtering
      p.descricaoNormalizada = normalizeSearchText(p.descricao);
      p.codigoInternoNormalizado = norm.codigoInterno;
      p.codigoCompletoNormalizado = norm.codigoExibicao;

      const gram = extractGramagem(p.embalagem);
      p.gramagemTexto = gram?.texto || null;
      p.gramagemValorBase = gram?.valorBase || null;
      p.gramagemUnidadeBase = gram?.unidadeBase || null;
      p.gramagemChave = gram?.chaveEquivalencia || null;

      if (norm.codigoInterno) {
        this._byInternalCode.set(norm.codigoInterno, p);
      }
      if (norm.codigoExibicao) {
        this._byFullCode.set(norm.codigoExibicao, p);
      }
      if (p.codigo_original) {
        this._byOriginalCode.set(p.codigo_original.trim(), p);
      }
      if (norm.chaveNormalizada) {
        this._byNormalizedKey.set(norm.chaveNormalizada, p);
      }

      // Index direct EANs
      if (Array.isArray(p.eans)) {
        for (const ean of p.eans) {
          const cleanEan = cleanEanCode(ean);
          if (cleanEan) {
            this._byBarcode.set(cleanEan, p);
          }
        }
      }

      // Index Sectors (Setor Físico e Setor Balanço)
      const sf = p.setor_fisico?.trim();
      const sb = p.setor_balanco?.trim();

      if (sf) {
        setFisico.add(sf);
        let listFis = this._bySectorFisico.get(sf);
        if (!listFis) {
          listFis = [];
          this._bySectorFisico.set(sf, listFis);
        }
        listFis.push(p);
      }

      if (sb) {
        setBalanco.add(sb);
        let listBal = this._bySectorBalanco.get(sb);
        if (!listBal) {
          listBal = [];
          this._bySectorBalanco.set(sb, listBal);
        }
        listBal.push(p);
      }

      const secInfo = { setorFisico: sf, setorBalanco: sb };
      if (norm.codigoInterno) this._productSectorByCode.set(norm.codigoInterno, secInfo);
      if (norm.codigoExibicao) this._productSectorByCode.set(norm.codigoExibicao, secInfo);
      if (norm.chaveNormalizada) this._productSectorByCode.set(norm.chaveNormalizada, secInfo);
      if (p.codigo_original) this._productSectorByCode.set(p.codigo_original.trim(), secInfo);
    }

    this._setoresFisicosList = Array.from(setFisico).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    this._setoresBalancoList = Array.from(setBalanco).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    // 2. Cross-reference Vínculos EAN
    const eansVistos = new Set<string>();
    const vinculosAtualizados: VinculoEan[] = [];

    for (let i = 0; i < this._vinculos.length; i++) {
      const v = this._vinculos[i];
      const normVinc = normalizeCodigoSMGO(v.codigo_interno, v.digito);
      const codigoInterno = normVinc.codigoInterno;
      const digito = normVinc.digito;
      const ean = cleanEanCode(v.ean);

      // Find product by internal code, full key, or original code
      let prod: ProdutoSMG | undefined;
      if (codigoInterno && this._byInternalCode.has(codigoInterno)) {
        prod = this._byInternalCode.get(codigoInterno);
      } else if (normVinc.chaveNormalizada && this._byNormalizedKey.has(normVinc.chaveNormalizada)) {
        prod = this._byNormalizedKey.get(normVinc.chaveNormalizada);
      } else if (v.codigo_interno && this._byOriginalCode.has(String(v.codigo_interno).trim())) {
        prod = this._byOriginalCode.get(String(v.codigo_interno).trim());
      }

      let status_vinculo: VinculoEan['status_vinculo'] = 'VINCULADO';

      if (eansVistos.has(ean)) {
        status_vinculo = 'DUPLICADO';
      }
      eansVistos.add(ean);

      if (isBaseEmpty) {
        // Base SMGOI013 not loaded yet: DO NOT mark as "CÓDIGO NÃO ENCONTRADO"!
        status_vinculo = 'AGUARDANDO_BASE';
      } else if (!prod) {
        status_vinculo = 'CODIGO_NAO_ENCONTRADO';
      } else {
        if (status_vinculo !== 'DUPLICADO') {
          status_vinculo = 'VINCULADO';
        }
        // Link EAN to product
        if (!prod.eans) prod.eans = [];
        if (!prod.eans.includes(ean)) {
          prod.eans.push(ean);
        }
        if (ean) {
          this._byBarcode.set(ean, prod);
        }
      }

      vinculosAtualizados.push({
        ...v,
        codigo_interno: codigoInterno || v.codigo_interno,
        digito: digito || prod?.digito || v.digito || '',
        ean,
        descricao: prod?.descricao || v.descricao || '',
        status_vinculo,
      });
    }

    this._vinculos = vinculosAtualizados;

    // 3. Cross-reference SAEOU060 records
    const lotesMap = new Map<string, string>(); // "codigo_interno:data_validade" -> loteId
    this._vencimentos.forEach((v) => {
      lotesMap.set(`${v.codigo_interno}:${v.data_validade}`, v.id);
    });

    const hojeMid = new Date();
    hojeMid.setHours(0, 0, 0, 0);

    const saeouAtualizados: RegistroSaeou060[] = [];
    for (let i = 0; i < this._saeou060.length; i++) {
      const s = this._saeou060[i];
      const normSaeou = normalizeCodigoSMGO(s.codigo_interno || s.codigo_original, s.digito);
      const codigoInterno = normSaeou.codigoInterno || s.codigo_interno;
      const digito = normSaeou.digito || s.digito;

      let prod: ProdutoSMG | undefined;
      if (codigoInterno && this._byInternalCode.has(codigoInterno)) {
        prod = this._byInternalCode.get(codigoInterno);
      } else if (normSaeou.chaveNormalizada && this._byNormalizedKey.has(normSaeou.chaveNormalizada)) {
        prod = this._byNormalizedKey.get(normSaeou.chaveNormalizada);
      } else if (s.codigo_original && this._byOriginalCode.has(String(s.codigo_original).trim())) {
        prod = this._byOriginalCode.get(String(s.codigo_original).trim());
      }

      let status_saeou = s.status_saeou;
      let vencId = s.vencimento_id_vinculado;

      if (s.status_saeou === 'DESCONSIDERADO') {
        // Keep explicitly discarded status
        status_saeou = 'DESCONSIDERADO';
      } else if (isBaseEmpty) {
        status_saeou = 'AGUARDANDO_BASE';
      } else if (!prod) {
        status_saeou = 'NAO_LOCALIZADO';
      } else {
        // Product located in SMGOI013
        if (s.data_vencimento && lotesMap.has(`${codigoInterno}:${s.data_vencimento}`)) {
          status_saeou = 'JA_NO_CONTROLE';
          vencId = lotesMap.get(`${codigoInterno}:${s.data_vencimento}`);
        } else if (vencId && this._vencimentos.some((v) => v.id === vencId)) {
          status_saeou = 'JA_NO_CONTROLE';
        } else if (s.status_saeou === 'CONCLUIDO') {
          status_saeou = 'CONCLUIDO';
        } else {
          // Check if critical (<= 7 days)
          if (s.data_vencimento) {
            const vctoDate = new Date(s.data_vencimento + 'T00:00:00');
            const diffDays = Math.floor((vctoDate.getTime() - hojeMid.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 7) {
              status_saeou = 'PRECISA_DE_ACAO';
            } else {
              status_saeou = s.status_saeou === 'PRECISA_DE_ACAO' ? 'NOVO' : (s.status_saeou || 'NOVO');
            }
          } else {
            status_saeou = s.status_saeou || 'NOVO';
          }
        }
      }

      saeouAtualizados.push({
        ...s,
        codigo_interno: codigoInterno,
        digito: digito || prod?.digito || s.digito || '',
        codigo_exibicao: normSaeou.codigoExibicao || `${codigoInterno}${prod?.digito ? '-' + prod.digito : ''}`,
        chave_normalizada: normSaeou.chaveNormalizada || s.chave_normalizada,
        descricao: prod?.descricao || s.descricao || '',
        embalagem: prod?.embalagem || s.embalagem || '',
        status_saeou,
        vencimento_id_vinculado: vencId,
      });
    }

    this._saeou060 = saeouAtualizados;
  }

  // --- PRODUTOS ---

  public getAllProducts(): ProdutoSMG[] {
    return this._produtos;
  }

  public getProdutosCount(): number {
    return this._produtos.length;
  }

  public getSetoresFisicos(): string[] {
    return this._setoresFisicosList;
  }

  public getSetoresBalanco(): string[] {
    return this._setoresBalancoList;
  }

  public getSectorInfoByCode(codigoOuChave: string): { setorFisico?: string; setorBalanco?: string } | undefined {
    if (!codigoOuChave) return undefined;
    const clean = codigoOuChave.replace(/^0+/, '');
    return (
      this._productSectorByCode.get(codigoOuChave) ||
      this._productSectorByCode.get(clean) ||
      this._productSectorByCode.get(codigoOuChave.trim())
    );
  }

  public getProductByInternalCode(codigo: string): ProdutoSMG | undefined {
    if (!codigo) return undefined;
    const clean = codigo.replace(/^0+/, '');
    return this._byInternalCode.get(clean) || this._byInternalCode.get(codigo);
  }

  public getProductByCode(codigo: string): ProdutoSMG | undefined {
    return this.getProductByInternalCode(codigo) || this.findByCodeOrEan(codigo);
  }

  public getProductByFullCode(fullCode: string): ProdutoSMG | undefined {
    if (!fullCode) return undefined;
    return (
      this._byFullCode.get(fullCode) ||
      this._byNormalizedKey.get(fullCode) ||
      this._byOriginalCode.get(fullCode)
    );
  }

  public getProductByOriginalCode(origCode: string): ProdutoSMG | undefined {
    if (!origCode) return undefined;
    return this._byOriginalCode.get(origCode.trim());
  }

  public getProductByBarcode(ean: string): ProdutoSMG | undefined {
    if (!ean) return undefined;
    const clean = cleanEanCode(ean);
    return this._byBarcode.get(clean) || this._byBarcode.get(ean.trim());
  }

  public findByCodeOrEan(query: string): ProdutoSMG | undefined {
    if (!query || !query.trim()) return undefined;
    const raw = query.trim();

    // 1. Direct Barcode lookup
    const byEan = this.getProductByBarcode(raw);
    if (byEan) return byEan;

    // 2. Direct internal code lookup
    const norm = normalizeCodigoSMGO(raw);
    if (norm.codigoInterno) {
      const byInternal = this.getProductByInternalCode(norm.codigoInterno);
      if (byInternal) return byInternal;
    }

    // 3. Full / Original code lookup
    const byFull = this.getProductByFullCode(raw);
    if (byFull) return byFull;

    const byOrig = this.getProductByOriginalCode(raw);
    if (byOrig) return byOrig;

    return undefined;
  }

  /**
   * High-speed search across all ~11,630 products with precomputed indices,
   * strict relevance sorting, and presentation/gramagem filtering.
   * 
   * Relevance Order:
   * 1. Exact EAN match
   * 2. Exact Código Interno match
   * 3. Exact Código Completo match
   * 4. Description starting with query
   * 5. Description containing query
   * 6. Code containing query
   * 7. Other attributes (sector, buyer)
   */
  public searchProducts(
    query: string,
    options?: {
      gramagem?: string | null;
      limit?: number;
    }
  ): ProdutoSMG[] {
    const rawQ = (query || '').trim();
    const gramagemFilter = options?.gramagem?.trim();

    if (!rawQ && !gramagemFilter) {
      return [];
    }

    const normQ = normalizeSearchText(rawQ);
    const cleanEanQ = cleanEanCode(rawQ);
    const normSMG = normalizeCodigoSMGO(rawQ);
    const cleanCode = normSMG.codigoInterno;
    const chaveQ = normSMG.chaveNormalizada;

    // Direct O(1) optimization: If exact full barcode exists in index and no other search criteria
    if (cleanEanQ && !gramagemFilter && this._byBarcode.has(cleanEanQ)) {
      const exactProd = this._byBarcode.get(cleanEanQ)!;
      return [exactProd];
    }

    interface ScoredProduct {
      prod: ProdutoSMG;
      score: number;
    }

    const matches: ScoredProduct[] = [];

    for (let i = 0; i < this._produtos.length; i++) {
      const p = this._produtos[i];

      // Filter by Gramagem / Apresentação if specified
      if (gramagemFilter) {
        const isFilterPesavel = gramagemFilter === 'PESÁVEL / KG' || gramagemFilter === 'KG' || gramagemFilter === 'PESO';
        const matchesGramagem =
          p.gramagemTexto === gramagemFilter ||
          p.gramagemChave === gramagemFilter ||
          (isFilterPesavel && (p.gramagemChave === 'PESO_KG' || isProdutoPesavel(p.embalagem))) ||
          (p.embalagem && p.embalagem.toUpperCase().includes(gramagemFilter.toUpperCase()));
        if (!matchesGramagem) continue;
      }

      if (!rawQ) {
        matches.push({ prod: p, score: 1 });
        continue;
      }

      let score = 0;

      // 1. EAN match
      if (cleanEanQ && p.eans && p.eans.includes(cleanEanQ)) {
        score = Math.max(score, 10000);
      } else if (cleanEanQ && p.eans && p.eans.some((e) => e.includes(cleanEanQ))) {
        score = Math.max(score, 1500);
      }

      // 2. Exact Código Interno
      if (cleanCode && (p.codigo_interno === cleanCode || p.codigoInternoNormalizado === cleanCode)) {
        score = Math.max(score, 8000);
      } else if (cleanCode && p.codigo_interno.startsWith(cleanCode)) {
        score = Math.max(score, 6000);
      } else if (cleanCode && p.codigo_interno.includes(cleanCode)) {
        score = Math.max(score, 3000);
      }

      // 3. Exact Código Completo / Chave
      if (chaveQ && (p.chave_normalizada === chaveQ || p.codigo_exibicao === chaveQ)) {
        score = Math.max(score, 7000);
      } else if (p.codigo_exibicao && p.codigo_exibicao.includes(rawQ)) {
        score = Math.max(score, 3500);
      }

      // 4. Descrição Normalizada
      const descNorm = p.descricaoNormalizada || normalizeSearchText(p.descricao);
      if (descNorm) {
        if (descNorm === normQ) {
          score = Math.max(score, 5000);
        } else if (descNorm.startsWith(normQ)) {
          score = Math.max(score, 4000);
        } else if (descNorm.includes(normQ)) {
          // Bonus for earlier position in description
          const pos = descNorm.indexOf(normQ);
          score = Math.max(score, 2000 - Math.min(pos, 500));
        }
      }

      // 5. Original Code / Setor / Comprador fallback
      if (score === 0) {
        if (p.codigo_original && p.codigo_original.includes(rawQ)) {
          score = 1000;
        } else if (p.setor_fisico && normalizeSearchText(p.setor_fisico).includes(normQ)) {
          score = 500;
        } else if (p.setor_balanco && normalizeSearchText(p.setor_balanco).includes(normQ)) {
          score = 400;
        } else if (p.comprador_filial && normalizeSearchText(p.comprador_filial).includes(normQ)) {
          score = 300;
        }
      }

      if (score > 0) {
        matches.push({ prod: p, score });
      }
    }

    // Sort strictly by relevance score descending
    matches.sort((a, b) => b.score - a.score);

    const result = matches.map((m) => m.prod);
    if (options?.limit && options.limit > 0) {
      return result.slice(0, options.limit);
    }
    return result;
  }

  /**
   * Extracts available contextual Gramagem options dynamically from a list of products.
   */
  public getGramagensDisponiveis(produtos: ProdutoSMG[]): { texto: string; count: number }[] {
    const map = new Map<string, { texto: string; count: number; valorBase: number }>();

    for (let i = 0; i < produtos.length; i++) {
      const p = produtos[i];
      const gTexto = p.gramagemTexto;
      if (!gTexto) continue;

      const existing = map.get(gTexto);
      if (existing) {
        existing.count++;
      } else {
        map.set(gTexto, {
          texto: gTexto,
          count: 1,
          valorBase: p.gramagemValorBase || 0,
        });
      }
    }

    return Array.from(map.values())
      .sort((a, b) => {
        if (a.valorBase !== b.valorBase) {
          return a.valorBase - b.valorBase;
        }
        return a.texto.localeCompare(b.texto);
      })
      .map(({ texto, count }) => ({ texto, count }));
  }

  /**
   * Persists products to IndexedDB and rebuilds indices.
   */
  public async saveProducts(
    novosProdutos: ProdutoSMG[],
    onProgress?: (pct: number, msg: string) => void
  ): Promise<boolean> {
    this._produtos = novosProdutos;
    this.rebuildIndices();

    // Persist to IndexedDB
    await dbPutAll(STORES.PRODUTOS, novosProdutos, true);
    await dbPutAll(STORES.VINCULOS_EAN, this._vinculos, true);

    const newVersion = Date.now();
    const meta = {
      ...this._metadados,
      status_base: novosProdutos.length > 0 ? ('SMGOI013' as const) : ('VAZIA' as const),
      total_produtos: novosProdutos.length,
      total_eans: this._vinculos.length,
      ultima_atualizacao_smgoi013: new Date().toLocaleString('pt-BR'),
      catalogo_version: newVersion,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    // Track locally
    cloudSyncService.setLocalVersions({ catalogoVersion: newVersion });

    // Push catalog to Cloud (Firestore)
    let pushed = false;
    try {
      pushed = await cloudSyncService.pushCatalogoToCloud(novosProdutos, meta, onProgress);
    } catch (e) {
      console.warn('Erro ao sincronizar catálogo na nuvem:', e);
    }

    this.notify();
    return pushed;
  }

  // --- VINCULOS EAN ---

  public getVinculos(): VinculoEan[] {
    return this._vinculos;
  }

  public async saveVinculos(novosVinculos: VinculoEan[]): Promise<void> {
    this._vinculos = novosVinculos;
    this.rebuildIndices();

    await dbPutAll(STORES.VINCULOS_EAN, this._vinculos, true);
    await dbPutAll(STORES.PRODUTOS, this._produtos, true);

    const meta = {
      ...this._metadados,
      total_eans: this._vinculos.length,
      ultima_atualizacao_eans: new Date().toLocaleString('pt-BR'),
      vinculos_version: Date.now(),
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    // Push vínculos to Cloud
    cloudSyncService.pushVinculosToCloud(this._vinculos).catch((e) => {
      console.warn('Erro ao sincronizar vínculos na nuvem:', e);
    });

    this.notify();
  }

  public async vincularEanManualmente(
    eanRaw: string,
    codigoInternoOuOriginal: string,
    descricaoManual?: string
  ): Promise<{ success: boolean; produto?: ProdutoSMG; erro?: string }> {
    const cleanEan = cleanEanCode(eanRaw);
    if (!cleanEan) {
      return { success: false, erro: 'Código EAN inválido ou vazio.' };
    }

    const normCode = normalizeCodigoSMGO(codigoInternoOuOriginal);
    let targetProd =
      this.getProductByInternalCode(normCode.codigoInterno) ||
      this.getProductByFullCode(codigoInternoOuOriginal) ||
      this.getProductByOriginalCode(codigoInternoOuOriginal);

    if (!targetProd) {
      return {
        success: false,
        erro: `Produto com código "${codigoInternoOuOriginal}" não foi encontrado na base SMGOI013.`,
      };
    }

    // Check if EAN was linked to a different product
    for (const prod of this._produtos) {
      if (prod.codigo_interno !== targetProd.codigo_interno && prod.eans && prod.eans.includes(cleanEan)) {
        prod.eans = prod.eans.filter((e) => e !== cleanEan);
      }
    }

    // Add EAN to target product
    if (!targetProd.eans) targetProd.eans = [];
    if (!targetProd.eans.includes(cleanEan)) {
      targetProd.eans.push(cleanEan);
    }

    // Update or add VinculoEan
    const existingVincIndex = this._vinculos.findIndex((v) => cleanEanCode(v.ean) === cleanEan);
    const dataHoraStr = new Date().toLocaleDateString('pt-BR');

    if (existingVincIndex >= 0) {
      this._vinculos[existingVincIndex] = {
        ...this._vinculos[existingVincIndex],
        codigo_interno: targetProd.codigo_interno,
        digito: targetProd.digito || '',
        ean: cleanEan,
        descricao: targetProd.descricao || descricaoManual || '',
        status_vinculo: 'VINCULADO',
      };
    } else {
      const novoVinculo: VinculoEan = {
        id: `vinc-manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        codigo_interno: targetProd.codigo_interno,
        digito: targetProd.digito || '',
        ean: cleanEan,
        descricao: targetProd.descricao || descricaoManual || '',
        status_vinculo: 'VINCULADO',
        criado_em: dataHoraStr,
      };
      this._vinculos.unshift(novoVinculo);
    }

    this.rebuildIndices();

    await Promise.all([
      dbPutAll(STORES.VINCULOS_EAN, this._vinculos, true),
      dbPutAll(STORES.PRODUTOS, this._produtos, true),
    ]);

    const meta = {
      ...this._metadados,
      total_eans: this._vinculos.length,
      ultima_atualizacao_eans: new Date().toLocaleString('pt-BR'),
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    this.notify();
    return { success: true, produto: targetProd };
  }

  public async desvincularEan(eanRaw: string): Promise<boolean> {
    const cleanEan = cleanEanCode(eanRaw);
    if (!cleanEan) return false;

    // Remove from products
    for (const prod of this._produtos) {
      if (prod.eans && prod.eans.includes(cleanEan)) {
        prod.eans = prod.eans.filter((e) => e !== cleanEan);
      }
    }

    // Remove or update vínculo
    this._vinculos = this._vinculos.filter((v) => cleanEanCode(v.ean) !== cleanEan);

    this.rebuildIndices();

    await Promise.all([
      dbPutAll(STORES.VINCULOS_EAN, this._vinculos, true),
      dbPutAll(STORES.PRODUTOS, this._produtos, true),
    ]);

    const meta = {
      ...this._metadados,
      total_eans: this._vinculos.length,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    this.notify();
    return true;
  }

  public async reprocessarBases(): Promise<void> {
    this.rebuildIndices();
    await dbPutAll(STORES.VINCULOS_EAN, this._vinculos, true);
    await dbPutAll(STORES.PRODUTOS, this._produtos, true);
    this.notify();
  }

  // --- VENCIMENTOS ---

  public getVencimentos(): LoteVencimento[] {
    return this._vencimentos;
  }

  public async saveVencimentos(lotes: LoteVencimento[]): Promise<void> {
    this._vencimentos = lotes;
    await dbPutAll(STORES.VENCIMENTOS, lotes, true);

    const meta = {
      ...this._metadados,
      total_vencimentos: lotes.length,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    // Sync all lots to Cloud
    cloudSyncService.pushAllLotesToCloud(lotes).catch((e) => {
      console.warn('Erro ao salvar lotes na nuvem:', e);
    });

    this.notify();
  }

  public checkDuplicateVencimento(
    candidate: {
      codigo_interno?: string | null;
      digito?: string | null;
      codigo_exibicao?: string | null;
      descricao_produto?: string | null;
      data_validade?: string | Date | null;
    },
    ignoreLoteId?: string | null
  ) {
    return findDuplicateVencimento(candidate, this._vencimentos, ignoreLoteId);
  }

  public async addVencimento(
    novoLote: Omit<LoteVencimento, 'id' | 'criado_em' | 'atualizado_em'>
  ): Promise<LoteVencimento> {
    // 1. Obter Código Interno e Dígito
    const codNorm = normalizeInternalCode(novoLote.codigo_interno);
    const digNorm = (novoLote.digito || '').trim();

    // 2. Normalizar a data
    const dateIso = normalizeDateToIso(novoLote.data_validade);
    if (!codNorm || !dateIso) {
      throw new Error('Código interno e data de validade são obrigatórios.');
    }

    // 3. Proteger contra duplo clique simultâneo
    const lockKey = `${codNorm}_${digNorm}_${dateIso}`;
    if (this._savingLoteKeys.has(lockKey)) {
      throw new Error(`Gravação em andamento para este produto e data (${dateIso}).`);
    }
    this._savingLoteKeys.add(lockKey);

    try {
      // 4. Consultar os vencimentos existentes e verificar duplicidade (MESMO PRODUTO + MESMA DATA)
      const duplicateCheck = findDuplicateVencimento(
        {
          codigo_interno: novoLote.codigo_interno,
          digito: novoLote.digito,
          codigo_exibicao: novoLote.codigo_exibicao,
          descricao_produto: novoLote.descricao_produto,
          data_validade: dateIso,
        },
        this._vencimentos
      );

      // 5. Se já existir -> BLOQUEAR o salvamento (NÃO criar novo registro, não gravar no banco)
      if (duplicateCheck.isDuplicate && duplicateCheck.existingLote) {
        const err = new Error(
          duplicateCheck.message ||
            `Este produto já possui um vencimento cadastrado para ${formatDateBr(dateIso)}.`
        );
        (err as any).isDuplicate = true;
        (err as any).existingLote = duplicateCheck.existingLote;
        throw err;
      }

      // 6. Se não existir -> SALVAR normalmente
      const id = `venc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const agora = new Date().toISOString();

      const loteCriado: LoteVencimento = {
        ...novoLote,
        codigo_interno: codNorm,
        digito: digNorm,
        data_validade: dateIso,
        id,
        criado_em: agora,
        atualizado_em: agora,
      };

      this._vencimentos.push(loteCriado);
      await dbPut(STORES.VENCIMENTOS, loteCriado);

      const meta = {
        ...this._metadados,
        total_vencimentos: this._vencimentos.length,
      };
      this._metadados = meta;
      await dbSetMeta('metadados_gerais', meta);

      // Real-time push to Cloud
      cloudSyncService.pushLoteToCloud(loteCriado).catch((e) => {
        console.warn('Erro ao sincronizar lote na nuvem:', e);
      });

      this.notify();
      return loteCriado;
    } finally {
      this._savingLoteKeys.delete(lockKey);
    }
  }

  public async updateVencimento(
    id: string,
    updates: Partial<LoteVencimento>
  ): Promise<LoteVencimento | undefined> {
    const index = this._vencimentos.findIndex((l) => l.id === id);
    if (index === -1) return undefined;

    const current = this._vencimentos[index];
    const newDateIso = updates.data_validade
      ? normalizeDateToIso(updates.data_validade)
      : normalizeDateToIso(current.data_validade);
    const currentDateIso = normalizeDateToIso(current.data_validade);

    // Se estiver alterando a data de validade, verificar duplicidade com outro lote existente
    if (newDateIso && newDateIso !== currentDateIso) {
      const duplicateCheck = findDuplicateVencimento(
        {
          codigo_interno: updates.codigo_interno || current.codigo_interno,
          digito: updates.digito || current.digito,
          codigo_exibicao: updates.codigo_exibicao || current.codigo_exibicao,
          descricao_produto: updates.descricao_produto || current.descricao_produto,
          data_validade: newDateIso,
        },
        this._vencimentos,
        id
      );

      if (duplicateCheck.isDuplicate && duplicateCheck.existingLote) {
        const err = new Error(
          duplicateCheck.message ||
            `Este produto já possui um vencimento cadastrado para ${formatDateBr(newDateIso)}.`
        );
        (err as any).isDuplicate = true;
        (err as any).existingLote = duplicateCheck.existingLote;
        throw err;
      }
    }

    this._vencimentos[index] = {
      ...this._vencimentos[index],
      ...updates,
      data_validade: newDateIso || this._vencimentos[index].data_validade,
      atualizado_em: new Date().toISOString(),
    };

    await dbPut(STORES.VENCIMENTOS, this._vencimentos[index]);

    // Real-time update in Cloud
    cloudSyncService.pushLoteToCloud(this._vencimentos[index]).catch((e) => {
      console.warn('Erro ao atualizar lote na nuvem:', e);
    });

    this.notify();
    return this._vencimentos[index];
  }

  public async deleteVencimento(id: string): Promise<boolean> {
    const filtrados = this._vencimentos.filter((l) => l.id !== id);
    if (filtrados.length === this._vencimentos.length) return false;

    this._vencimentos = filtrados;
    await dbPutAll(STORES.VENCIMENTOS, filtrados, true);

    const meta = {
      ...this._metadados,
      total_vencimentos: this._vencimentos.length,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    // Real-time delete from Cloud
    cloudSyncService.deleteLoteFromCloud(id).catch((e) => {
      console.warn('Erro ao deletar lote da nuvem:', e);
    });

    this.notify();
    return true;
  }

  public getVencimentosByCodigoInterno(codigo_interno: string): LoteVencimento[] {
    const clean = codigo_interno.replace(/^0+/, '');
    return this._vencimentos.filter((l) => l.codigo_interno === clean);
  }

  // --- SAEOU060 REGISTROS ---

  public getSaeou060Registros(): RegistroSaeou060[] {
    return this._saeou060;
  }

  public async saveSaeou060Registros(registros: RegistroSaeou060[]): Promise<void> {
    this._saeou060 = registros;
    this.rebuildIndices();
    await dbPutAll(STORES.SAEOU060, this._saeou060, true);

    const meta = {
      ...this._metadados,
      total_saeou060: this._saeou060.length,
      ultima_atualizacao_saeou060: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      saeou060_version: Date.now(),
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    cloudSyncService.pushSaeou060ToCloud(this._saeou060).catch((e) => {
      console.warn('Erro ao sincronizar SAEOU060 na nuvem:', e);
    });

    this.notify();
  }

  public async addSaeou060Registros(novos: RegistroSaeou060[]): Promise<void> {
    const map = new Map<string, RegistroSaeou060>();
    // Existing records
    this._saeou060.forEach((r) => map.set(r.id, r));
    // Merge or append incoming
    novos.forEach((r) => map.set(r.id, r));

    this._saeou060 = Array.from(map.values());
    this.rebuildIndices();
    await dbPutAll(STORES.SAEOU060, this._saeou060, true);

    const meta = {
      ...this._metadados,
      total_saeou060: this._saeou060.length,
      ultima_atualizacao_saeou060: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      saeou060_version: Date.now(),
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    cloudSyncService.pushSaeou060ToCloud(this._saeou060).catch((e) => {
      console.warn('Erro ao sincronizar SAEOU060 na nuvem:', e);
    });

    this.notify();
  }

  public async desconsiderarSaeou060(saeouId: string, motivo?: string): Promise<boolean> {
    const reg = this._saeou060.find((r) => r.id === saeouId);
    if (!reg) return false;

    reg.status_saeou = 'DESCONSIDERADO';
    reg.motivo_desconsiderado = motivo || 'Desconsiderado pelo usuário na rotina operacional';
    reg.desconsiderado_em = new Date().toLocaleString('pt-BR');

    await dbPut(STORES.SAEOU060, reg);
    this.rebuildIndices();
    this.notify();
    return true;
  }

  public async restaurarSaeou060(saeouId: string): Promise<boolean> {
    const reg = this._saeou060.find((r) => r.id === saeouId);
    if (!reg) return false;

    reg.status_saeou = 'NOVO';
    reg.motivo_desconsiderado = undefined;
    reg.desconsiderado_em = undefined;

    await dbPut(STORES.SAEOU060, reg);
    this.rebuildIndices();
    this.notify();
    return true;
  }

  public async atualizarSaeou060Trabalho(
    saeouId: string,
    updates: {
      data_vencimento?: string;
      data_vencimento_exibicao?: string;
      quantidade?: number;
      preco_trabalhado?: number;
      data_preco?: string;
      observacao?: string;
      status_saeou?: StatusSaeou060;
    }
  ): Promise<RegistroSaeou060 | undefined> {
    const reg = this._saeou060.find((r) => r.id === saeouId);
    if (!reg) return undefined;

    if (updates.data_vencimento !== undefined) reg.data_vencimento = updates.data_vencimento;
    if (updates.data_vencimento_exibicao !== undefined) reg.data_vencimento_exibicao = updates.data_vencimento_exibicao;
    if (updates.quantidade !== undefined) reg.quantidade = updates.quantidade;
    if (updates.preco_trabalhado !== undefined) reg.preco_trabalhado = updates.preco_trabalhado;
    if (updates.data_preco !== undefined) reg.data_preco = updates.data_preco;
    if (updates.observacao !== undefined) reg.observacao = updates.observacao;
    if (updates.status_saeou !== undefined) reg.status_saeou = updates.status_saeou;
    reg.trabalhado_em = new Date().toLocaleString('pt-BR');

    await dbPut(STORES.SAEOU060, reg);
    this.rebuildIndices();
    this.notify();
    return reg;
  }

  public async adicionarSaeou060AoControle(
    saeouId: string,
    customData?: Partial<LoteVencimento>
  ): Promise<LoteVencimento | undefined> {
    const reg = this._saeou060.find((r) => r.id === saeouId);
    if (!reg) return undefined;

    // Get product from repository
    const prod = this.getProductByCode(reg.codigo_interno);
    const rawValidade = customData?.data_validade || reg.data_vencimento;
    const dataValidade = normalizeDateToIso(rawValidade) || new Date().toISOString().split('T')[0];
    const quantidade = customData?.quantidade_total_unidades ?? reg.quantidade ?? 1;

    // Check for existing duplicate in vencimentos using unified validator
    const duplicateCheck = findDuplicateVencimento(
      {
        codigo_interno: reg.codigo_interno,
        digito: reg.digito || prod?.digito,
        codigo_exibicao: reg.codigo_exibicao,
        descricao_produto: prod?.descricao || reg.descricao,
        data_validade: dataValidade,
      },
      this._vencimentos
    );

    if (duplicateCheck.isDuplicate && duplicateCheck.existingLote) {
      const existingLote = duplicateCheck.existingLote;
      // Link to existing lote
      reg.status_saeou = 'JA_NO_CONTROLE';
      reg.vencimento_id_vinculado = existingLote.id;
      reg.adicionado_ao_controle_em = new Date().toLocaleString('pt-BR');
      if (customData?.observacao) existingLote.observacao = customData.observacao;
      if (customData?.preco_trabalhado !== undefined) existingLote.preco_trabalhado = customData.preco_trabalhado;
      if (customData?.data_preco) existingLote.data_preco = customData.data_preco;
      existingLote.atualizado_em = new Date().toISOString();

      await Promise.all([
        dbPut(STORES.VENCIMENTOS, existingLote),
        dbPut(STORES.SAEOU060, reg),
      ]);

      this.rebuildIndices();
      this.notify();
      return existingLote;
    }

    const novoLote: LoteVencimento = {
      id: `venc-saeou-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      codigo_interno: reg.codigo_interno,
      digito: reg.digito || prod?.digito || '',
      codigo_exibicao: reg.codigo_exibicao || `${reg.codigo_interno}${prod?.digito ? '-' + prod.digito : ''}`,
      descricao_produto: prod?.descricao || reg.descricao || 'PRODUTO',
      embalagem: prod?.embalagem || reg.embalagem || 'UN 1',
      fator_embalagem: prod?.fator_embalagem || 1,
      data_validade: dataValidade,
      quantidade_total_unidades: quantidade,
      observacao:
        customData?.observacao ||
        reg.observacao ||
        (reg.promotor ? `Importado SAEOU060 - Promotor: ${reg.promotor}` : 'Importado via SAEOU060'),
      lote_identificador: reg.arquivo_origem ? `SAEOU-${reg.arquivo_origem.substring(0, 10)}` : 'SAEOU060',
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
      origem: 'SAEOU060',
      preco_trabalhado: customData?.preco_trabalhado !== undefined ? customData.preco_trabalhado : reg.preco_trabalhado,
      data_preco: customData?.data_preco || reg.data_preco,
      saeou060_id: reg.id,
      arquivo_origem: reg.arquivo_origem,
    };

    // Add to vencimentos
    this._vencimentos.unshift(novoLote);
    await dbPut(STORES.VENCIMENTOS, novoLote);

    // Update SAEOU060 record status
    reg.status_saeou = 'JA_NO_CONTROLE';
    reg.vencimento_id_vinculado = novoLote.id;
    reg.adicionado_ao_controle_em = new Date().toLocaleString('pt-BR');
    await dbPut(STORES.SAEOU060, reg);

    // Update metadata
    const meta = {
      ...this._metadados,
      total_vencimentos: this._vencimentos.length,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    this.rebuildIndices();
    this.notify();
    return novoLote;
  }

  public async adicionarTodosSaeou060AoControle(): Promise<number> {
    const pendentes = this._saeou060.filter(
      (r) => r.status_saeou === 'NOVO' || r.status_saeou === 'PRECISA_DE_ACAO'
    );

    if (pendentes.length === 0) return 0;

    let addedCount = 0;
    const nowStr = new Date().toLocaleString('pt-BR');
    const nowIso = new Date().toISOString();

    for (const reg of pendentes) {
      const prod = this.getProductByCode(reg.codigo_interno);
      const dataValidade = reg.data_vencimento || new Date().toISOString().split('T')[0];

      // Check for duplicate in existing and freshly added vencimentos
      const duplicateCheck = findDuplicateVencimento(
        {
          codigo_interno: reg.codigo_interno,
          digito: reg.digito || prod?.digito,
          codigo_exibicao: reg.codigo_exibicao,
          descricao_produto: prod?.descricao || reg.descricao,
          data_validade: dataValidade,
        },
        this._vencimentos
      );

      if (duplicateCheck.isDuplicate && duplicateCheck.existingLote) {
        // Link to existing lote without creating duplicate
        const existingLote = duplicateCheck.existingLote;
        reg.status_saeou = 'JA_NO_CONTROLE';
        reg.vencimento_id_vinculado = existingLote.id;
        reg.adicionado_ao_controle_em = nowStr;
        continue;
      }

      const novoLote: LoteVencimento = {
        id: `venc-saeou-${Date.now()}-${Math.random().toString(36).substring(2, 6)}-${addedCount}`,
        codigo_interno: reg.codigo_interno,
        digito: reg.digito || prod?.digito || '',
        codigo_exibicao: reg.codigo_exibicao || `${reg.codigo_interno}${prod?.digito ? '-' + prod.digito : ''}`,
        descricao_produto: prod?.descricao || reg.descricao || 'PRODUTO',
        embalagem: prod?.embalagem || reg.embalagem || 'UN 1',
        fator_embalagem: prod?.fator_embalagem || 1,
        data_validade: dataValidade,
        quantidade_total_unidades: reg.quantidade || 1,
        observacao: reg.observacao || (reg.promotor ? `Importado SAEOU060 - Promotor: ${reg.promotor}` : 'Importado via SAEOU060'),
        lote_identificador: reg.arquivo_origem ? `SAEOU-${reg.arquivo_origem.substring(0, 10)}` : 'SAEOU060',
        criado_em: nowIso,
        atualizado_em: nowIso,
        origem: 'SAEOU060',
        preco_trabalhado: reg.preco_trabalhado,
        data_preco: reg.data_preco,
        saeou060_id: reg.id,
        arquivo_origem: reg.arquivo_origem,
      };

      this._vencimentos.unshift(novoLote);
      reg.status_saeou = 'JA_NO_CONTROLE';
      reg.vencimento_id_vinculado = novoLote.id;
      reg.adicionado_ao_controle_em = nowStr;
      addedCount++;
    }

    await Promise.all([
      dbPutAll(STORES.VENCIMENTOS, this._vencimentos, true),
      dbPutAll(STORES.SAEOU060, this._saeou060, true),
    ]);

    const meta = {
      ...this._metadados,
      total_vencimentos: this._vencimentos.length,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    this.rebuildIndices();
    this.notify();
    return addedCount;
  }

  public async deleteSaeou060Registro(id: string): Promise<boolean> {
    const filtrados = this._saeou060.filter((r) => r.id !== id);
    if (filtrados.length === this._saeou060.length) return false;

    this._saeou060 = filtrados;
    await dbPutAll(STORES.SAEOU060, filtrados, true);

    const meta = {
      ...this._metadados,
      total_saeou060: this._saeou060.length,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    this.rebuildIndices();
    this.notify();
    return true;
  }

  public async clearSaeou060(): Promise<void> {
    this._saeou060 = [];
    await dbClear(STORES.SAEOU060);

    const meta = {
      ...this._metadados,
      total_saeou060: 0,
      ultima_atualizacao_saeou060: undefined,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    this.rebuildIndices();
    this.notify();
  }

  /**
   * Loads or updates SAEOU060 records with today's date for immediate testing.
   */
  public async carregarSaeou060Hoje(): Promise<number> {
    const hoje = new Date();
    const hojeStr = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
    const horaStr = `${String(hoje.getHours()).padStart(2, '0')}:${String(hoje.getMinutes()).padStart(2, '0')}`;

    if (this._saeou060.length > 0) {
      this._saeou060 = this._saeou060.map((r) => ({
        ...r,
        data_movimento: hojeStr,
        data_cadastro: hojeStr,
        data_importacao: hojeStr,
        hora_importacao: horaStr,
      }));
    } else {
      this._saeou060 = DEMO_SAEOU060.map((r, idx) => ({
        ...r,
        id: `saeou-hoje-${idx}-${Date.now()}`,
        data_movimento: hojeStr,
        data_cadastro: hojeStr,
        data_importacao: hojeStr,
        hora_importacao: horaStr,
      }));
    }

    this.rebuildIndices();
    await dbPutAll(STORES.SAEOU060, this._saeou060, true);

    const meta = {
      ...this._metadados,
      total_saeou060: this._saeou060.length,
      ultima_atualizacao_saeou060: `${hojeStr} ${horaStr}`,
    };
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);

    this.notify();
    return this._saeou060.length;
  }

  // --- DIVERGENCIAS ---

  public getDivergencias(): DivergenciaRegistro[] {
    return this._divergencias;
  }

  public async saveDivergencias(divs: DivergenciaRegistro[]): Promise<void> {
    this._divergencias = divs;
    await dbPutAll(STORES.DIVERGENCIAS, divs, true);
    this.notify();
  }

  public async addDivergencia(
    div: Omit<DivergenciaRegistro, 'id' | 'data_registro'>
  ): Promise<DivergenciaRegistro> {
    const registro: DivergenciaRegistro = {
      ...div,
      id: `div-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      data_registro: new Date().toLocaleString('pt-BR'),
    };
    this._divergencias.unshift(registro);
    await dbPut(STORES.DIVERGENCIAS, registro);
    this.notify();
    return registro;
  }

  public async deleteDivergencia(id: string): Promise<boolean> {
    const filtered = this._divergencias.filter((d) => d.id !== id);
    if (filtered.length === this._divergencias.length) return false;
    this._divergencias = filtered;
    await dbPutAll(STORES.DIVERGENCIAS, filtered, true);
    this.notify();
    return true;
  }

  public async clearDivergencias(): Promise<void> {
    this._divergencias = [];
    await dbClear(STORES.DIVERGENCIAS);
    this.notify();
  }

  // --- HISTORICO ---

  public getHistorico(): ResumoImportacao[] {
    return this._historico;
  }

  public async addHistorico(resumo: ResumoImportacao): Promise<void> {
    if (!resumo.id) {
      resumo.id = `imp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    }
    // Ensure all items in history have a unique id for IndexedDB
    this._historico.forEach((h, idx) => {
      if (!h.id) {
        h.id = `imp-hist-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;
      }
    });
    this._historico.unshift(resumo);
    if (this._historico.length > 30) {
      this._historico = this._historico.slice(0, 30);
    }
    await dbPutAll(STORES.HISTORICO_IMPORTACOES, this._historico, true);
    cloudSyncService.pushHistoricoToCloud(resumo).catch((e) => {
      console.warn('Erro ao salvar histórico na nuvem:', e);
    });
    this.notify();
  }

  public async clearHistorico(): Promise<void> {
    this._historico = [];
    await dbClear(STORES.HISTORICO_IMPORTACOES);
    this.notify();
  }

  // --- METADADOS ---

  public async syncWithCloud(): Promise<{ success: boolean; message: string }> {
    return await cloudSyncService.syncFull(
      this._produtos,
      this._metadados,
      this._vinculos,
      this._saeou060,
      this._vencimentos
    );
  }

  public getMetadados(): MetadadosBase {
    return this._metadados;
  }

  public async saveMetadados(meta: MetadadosBase): Promise<void> {
    this._metadados = meta;
    await dbSetMeta('metadados_gerais', meta);
    this.notify();
  }

  // --- ACTIONS ---

  public async loadDemoData(): Promise<void> {
    this._produtos = [...DEMO_PRODUTOS];
    this._vinculos = [...DEMO_VINCULOS];
    this._vencimentos = [...DEMO_VENCIMENTOS];
    this._saeou060 = [...DEMO_SAEOU060];
    this._divergencias = [...DEMO_DIVERGENCIAS];
    this._historico = [];

    this._metadados = {
      filial_numero: '172',
      filial_nome: 'CASCAVEL',
      ultima_atualizacao_smgoi013: '31/08/2026 08:00',
      ultima_atualizacao_eans: '31/08/2026 08:00',
      ultima_atualizacao_saeou060: '31/08/2026 08:00',
      status_base: 'DEMO',
      total_produtos: DEMO_PRODUTOS.length,
      total_vencimentos: DEMO_VENCIMENTOS.length,
      total_eans: DEMO_VINCULOS.length,
      total_saeou060: DEMO_SAEOU060.length,
    };

    this.rebuildIndices();

    await Promise.all([
      dbPutAll(STORES.PRODUTOS, this._produtos, true),
      dbPutAll(STORES.VINCULOS_EAN, this._vinculos, true),
      dbPutAll(STORES.VENCIMENTOS, this._vencimentos, true),
      dbPutAll(STORES.SAEOU060, this._saeou060, true),
      dbPutAll(STORES.DIVERGENCIAS, this._divergencias, true),
      dbClear(STORES.HISTORICO_IMPORTACOES),
      dbSetMeta('metadados_gerais', this._metadados),
    ]);

    this.notify();
  }

  public async clearAllData(): Promise<void> {
    this._produtos = [];
    this._vinculos = [];
    this._vencimentos = [];
    this._saeou060 = [];
    this._divergencias = [];
    this._historico = [];

    this._metadados = {
      filial_numero: '172',
      filial_nome: 'CASCAVEL',
      status_base: 'VAZIA',
      total_produtos: 0,
      total_vencimentos: 0,
      total_eans: 0,
      total_saeou060: 0,
    };

    this.rebuildIndices();

    await Promise.all([
      dbClear(STORES.PRODUTOS),
      dbClear(STORES.VINCULOS_EAN),
      dbClear(STORES.VENCIMENTOS),
      dbClear(STORES.SAEOU060),
      dbClear(STORES.DIVERGENCIAS),
      dbClear(STORES.HISTORICO_IMPORTACOES),
      dbSetMeta('metadados_gerais', this._metadados),
    ]);

    this.notify();
  }

  // --- DIAGNOSTIC METRICS ---

  public getDiagnosticoBase() {
    const totalPersistidos = this._produtos.length;
    const indiceInternoCount = this._byInternalCode.size;
    const totalVinculos = this._vinculos.length;
    const vinculosEncontrados = this._vinculos.filter((v) => v.status_vinculo === 'VINCULADO').length;
    const vinculosPendentes = this._vinculos.filter(
      (v) => v.status_vinculo === 'AGUARDANDO_BASE' || v.status_vinculo === 'CODIGO_NAO_ENCONTRADO'
    ).length;
    const vinculosDuplicados = this._vinculos.filter((v) => v.status_vinculo === 'DUPLICADO').length;

    const totalSaeou = this._saeou060.length;
    const saeouNoControle = this._saeou060.filter((s) => s.status_saeou === 'JA_NO_CONTROLE').length;
    const saeouNovos = this._saeou060.filter((s) => s.status_saeou === 'NOVO').length;
    const saeouPrecisaAcao = this._saeou060.filter((s) => s.status_saeou === 'PRECISA_DE_ACAO').length;
    const saeouNaoLocalizados = this._saeou060.filter((s) => s.status_saeou === 'NAO_LOCALIZADO').length;

    return {
      totalPersistidos,
      indiceInternoCount,
      totalVinculos,
      vinculosEncontrados,
      vinculosPendentes,
      vinculosDuplicados,
      totalSaeou,
      saeouNoControle,
      saeouNovos,
      saeouPrecisaAcao,
      saeouNaoLocalizados,
      statusBase: this._metadados.status_base,
    };
  }
}

// Singleton export
export const productRepository = new ProductRepository();
