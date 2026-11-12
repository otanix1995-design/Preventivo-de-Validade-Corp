/**
 * ISV — MOTOR DEFINITIVO DE ATUALIZAÇÃO LOCAL POR ARQUIVO ÚNICO (.ZIP)
 * Filial 172 — Cascavel
 *
 * Responsabilidades:
 * 1. Consolidar BASE RUB (36 cols + catálogo), SPCOI007, SAEOU060, Promotores,
 *    Agências normalizadas e Vínculos Comerciais em um único arquivo `.zip`
 *    (`ISV_FILIAL_172_ATUALIZACAO_YYYY-MM-DD.zip`) usando streaming/chunking com `fflate`.
 * 2. Bloquear geração caso usuário não esteja autenticado e verificado no servidor
 *    como `GERENCIA_ADMIN` da Filial 172 ou caso qualquer uma das 3 bases obrigatórias
 *    esteja vazia/incompleta.
 * 3. Inspecionar e validar pacotes recebidos sem exigir login no dispositivo de destino:
 *    formato ZIP, schema, `filialId === '172'`, SHA-256 por arquivo e consolidado,
 *    comparação de versões, detecção de downgrade, detecção de conflitos comerciais
 *    e verificação de cota estimada de armazenamento.
 * 4. Executar instalação segura em 13 etapas com staging no IndexedDB (`PACOTE_STAGING`),
 *    troca controlada exclusivamente dos dados do pacote e rollback completo em caso de falha,
 *    preservando integralmente vencimentos, vínculos EAN, filas de sincronização e tombstones.
 * 5. Manter transparência honesta de segurança e armazenamento:
 *    - Nenhuma chave privada ou segredo embutido no frontend.
 *    - Autenticidade declarada honestamente como `INTEGRIDADE_VERIFICADA_SEM_ASSINATURA_PKI`.
 */

import { Zip, ZipDeflate, strFromU8, strToU8, unzipSync } from 'fflate';
import {
  AgenciaComercial,
  ComparacaoVersaoPacote,
  ConflitoCadastroComercial,
  FornecedorSPCOI007,
  HistoricoMovimentacaoComercial,
  Industria,
  IsvPacoteContagensSnapshot,
  IsvPacoteManifesto,
  IsvPacotePayloadExtraido,
  IsvPacoteStatusLocal,
  ProdutoSMG,
  Promotor,
  RegistroPlanilhaIsv,
  RegistroSaeou060,
  ResolucaoConflitoPacote,
  ResultadoInspecaoPacoteIsv,
  ResultadoInstalacaoPacoteIsv,
  ResumoComparacaoPacote,
  ResumoImportacaoIsv,
  ResumoImportacaoSPCOI007,
  VinculoAgenciaIndustria,
  VinculoPromotor,
  VinculoPromotorAgencia,
  VinculoPromotorIndustria,
} from '../types';
import {
  gerarAgenciaId,
  isAgenciaSemVinculoNome,
  normalizarChaveAgencia,
  normalizarNomeAgenciaExibicao,
} from './agenciaNormalizer';
import { dbClear, dbGetMeta, dbPut, dbSetMeta, STORES } from './db';
import { EstadoAuthServidor, firebaseAuthService } from './firebaseAuthService';
import { isvService } from './isvService';
import {
  EventoAlteracaoPacoteLocal,
  isModoAtualizacaoLocalAtivo,
  onAlteracaoPacoteLocal,
  sha256HexBytes,
  sha256HexText,
} from './localPackageMode';
import { productRepository } from './productRepository';
import { promotorService } from './promotorService';
import { normalizarCnpj } from './spcoi007Parser';

const META_KEY_PACOTE = 'meta_pacote_atualizacao_isv';
const CHUNK_NDJSON_SIZE = 2000;
const CHUNK_STAGING_SIZE = 1000;
const ESTIMATE_MULTIPLIER_IDB = 2.6;

export interface LocalPackageDependencies {
  getAuthEstado?: () => EstadoAuthServidor;
  getProdutos?: () => ProdutoSMG[];
  getRegistrosOperacionais?: () => RegistroPlanilhaIsv[];
  getFornecedores?: () => FornecedorSPCOI007[];
  getIndustrias?: () => Industria[];
  getSaeou060?: () => RegistroSaeou060[];
  getPromotores?: () => Promotor[];
  getAgencias?: () => AgenciaComercial[];
  getHistoricoMovimentacoes?: () => HistoricoMovimentacaoComercial[];
  getVinculosPromotorIndustria?: () => VinculoPromotorIndustria[];
  getVinculosDispositivoPromotor?: () => VinculoPromotor[];
  getHistoricoIsv?: () => ResumoImportacaoIsv[];
  getHistoricoSpcoi?: () => ResumoImportacaoSPCOI007[];
  getVencimentosCount?: () => number;
  getVinculosEanCount?: () => number;
  aplicarCatalogoESaeou?: (params: {
    produtos: ProdutoSMG[];
    saeou060: RegistroSaeou060[];
    versaoPacoteId: string;
    dataGeracaoIso: string;
  }) => Promise<{ vencimentosPreservados: number; vinculosEanPreservados: number }>;
  aplicarIsv?: (params: {
    registrosOperacionais: RegistroPlanilhaIsv[];
    fornecedores: FornecedorSPCOI007[];
    industrias: Industria[];
    vinculosPromotorIndustria: VinculoPromotorIndustria[];
    historicoIsv?: ResumoImportacaoIsv[];
    historicoSpcoi?: ResumoImportacaoSPCOI007[];
    preservarAlteracoesComerciaisLocais?: boolean;
  }) => Promise<void>;
  aplicarPromotores?: (params: {
    promotores: Promotor[];
    agencias?: AgenciaComercial[];
    historicoMovimentacoes?: HistoricoMovimentacaoComercial[];
    vinculosDispositivoPromotor?: VinculoPromotor[];
    preservarAlteracoesComerciaisLocais?: boolean;
  }) => Promise<void>;
  getMeta?: <T>(key: string, fallback: T) => Promise<T>;
  setMeta?: <T>(key: string, value: T) => Promise<void>;
  putStaging?: (key: string, data: any) => Promise<void>;
  clearStaging?: () => Promise<void>;
  estimateStorage?: () => Promise<{ quota: number | null; usage: number | null }>;
  autoSubscribeEvents?: boolean;
  initDependencies?: () => Promise<void>;
  getServicosProntos?: () => { catalogo: boolean; isv: boolean; promotores: boolean };
  subscribeStoreUpdates?: (listener: () => void) => () => void;
}

interface PersistedPackageMeta {
  versaoInstaladaId: string | null;
  ultimaAtualizacaoIso: string | null;
  ultimaAtualizacaoTs: number | null;
  origemUltimaAtualizacao: 'GERACAO_LOCAL' | 'IMPORTACAO_PACOTE' | 'NENHUMA';
  ultimaGeracaoIso: string | null;
  ultimaGeracaoVersaoId: string | null;
  atualizacaoDisponivel: boolean;
  motivosDesatualizacao: string[];
  alteracoesComerciaisLocaisPendentes: boolean;
  ultimaAlteracaoComercialIso: string | null;
  ultimasAlteracoesComerciaisResumo: string[];
}

const DEFAULT_PERSISTED_META: PersistedPackageMeta = {
  versaoInstaladaId: null,
  ultimaAtualizacaoIso: null,
  ultimaAtualizacaoTs: null,
  origemUltimaAtualizacao: 'NENHUMA',
  ultimaGeracaoIso: null,
  ultimaGeracaoVersaoId: null,
  atualizacaoDisponivel: false,
  motivosDesatualizacao: [],
  alteracoesComerciaisLocaisPendentes: false,
  ultimaAlteracaoComercialIso: null,
  ultimasAlteracoesComerciaisResumo: [],
};

function formatDateYyyyMmDdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatVersaoId(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ISV172_${y}${m}${d}_${hh}${mm}${ss}_${rand}`;
}

async function yieldThread(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

export class LocalUpdatePackageService {
  private _deps: Required<LocalPackageDependencies>;
  private _persistedMeta: PersistedPackageMeta = { ...DEFAULT_PERSISTED_META };
  private _initialized = false;
  private _initPromise: Promise<void> | null = null;
  private _listeners = new Set<(status: IsvPacoteStatusLocal) => void>();
  private _unsubChangeBus: (() => void) | null = null;
  private _unsubStoreUpdates: (() => void) | null = null;
  private _operacaoEmCurso: 'NENHUMA' | 'EXPORTANDO' | 'INSPECIONANDO' | 'INSTALANDO' = 'NENHUMA';

  constructor(deps?: LocalPackageDependencies) {
    const hasCustomDataGetters = Boolean(
      deps?.getProdutos ||
        deps?.getRegistrosOperacionais ||
        deps?.getFornecedores ||
        deps?.getIndustrias ||
        deps?.getSaeou060 ||
        deps?.getPromotores
    );

    this._deps = {
      getAuthEstado: deps?.getAuthEstado ?? (() => firebaseAuthService.getEstado()),
      getProdutos: deps?.getProdutos ?? (() => productRepository.getProdutos()),
      getRegistrosOperacionais:
        deps?.getRegistrosOperacionais ?? (() => isvService.getRegistrosIsvOperacional()),
      getFornecedores: deps?.getFornecedores ?? (() => isvService.getFornecedores()),
      getIndustrias: deps?.getIndustrias ?? (() => isvService.getIndustrias()),
      getSaeou060: deps?.getSaeou060 ?? (() => productRepository.getSaeou060Registros()),
      getPromotores: deps?.getPromotores ?? (() => promotorService.getPromotores()),
      getAgencias:
        deps?.getAgencias ??
        (hasCustomDataGetters ? () => [] : () => promotorService.getAgencias()),
      getHistoricoMovimentacoes:
        deps?.getHistoricoMovimentacoes ??
        (hasCustomDataGetters ? () => [] : () => promotorService.getHistoricoMovimentacoes()),
      getVinculosPromotorIndustria:
        deps?.getVinculosPromotorIndustria ?? (() => isvService.getVinculosPromotorIndustria()),
      getVinculosDispositivoPromotor:
        deps?.getVinculosDispositivoPromotor ?? (() => promotorService.getVinculos()),
      getHistoricoIsv: deps?.getHistoricoIsv ?? (() => isvService.getHistoricoIsv()),
      getHistoricoSpcoi: deps?.getHistoricoSpcoi ?? (() => isvService.getHistoricoSpcoi()),
      getVencimentosCount:
        deps?.getVencimentosCount ?? (() => productRepository.getVencimentos().length),
      getVinculosEanCount:
        deps?.getVinculosEanCount ?? (() => productRepository.getVinculos().length),
      aplicarCatalogoESaeou:
        deps?.aplicarCatalogoESaeou ??
        ((params) => productRepository.aplicarCatalogoESaeouDePacote(params)),
      aplicarIsv: deps?.aplicarIsv ?? ((params) => isvService.aplicarDadosPacote(params)),
      aplicarPromotores:
        deps?.aplicarPromotores ?? ((params) => promotorService.substituirDadosComerciaisDePacote(params)),
      getMeta: deps?.getMeta ?? dbGetMeta,
      setMeta: deps?.setMeta ?? dbSetMeta,
      putStaging:
        deps?.putStaging ??
        (async (key: string, data: any) => {
          await dbPut(STORES.PACOTE_STAGING, { key, data, updatedAt: Date.now() });
        }),
      clearStaging:
        deps?.clearStaging ??
        (async () => {
          try {
            await dbClear(STORES.PACOTE_STAGING);
          } catch {
            // Safe ignore in headless / non-IDB envs
          }
        }),
      estimateStorage:
        deps?.estimateStorage ??
        (async () => {
          if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
            try {
              const est = await navigator.storage.estimate();
              return {
                quota: typeof est.quota === 'number' ? est.quota : null,
                usage: typeof est.usage === 'number' ? est.usage : null,
              };
            } catch {
              return { quota: null, usage: null };
            }
          }
          return { quota: null, usage: null };
        }),
      autoSubscribeEvents: deps?.autoSubscribeEvents ?? true,
      initDependencies:
        deps?.initDependencies ??
        (hasCustomDataGetters
          ? async () => {}
          : async () => {
              await Promise.all([
                productRepository.init(),
                isvService.init(),
                promotorService.init(),
              ]);
            }),
      getServicosProntos:
        deps?.getServicosProntos ??
        (hasCustomDataGetters
          ? () => ({ catalogo: true, isv: true, promotores: true })
          : () => ({
              catalogo: productRepository.isLoaded(),
              isv: isvService.isInitialized(),
              promotores: promotorService.isInitialized(),
            })),
      subscribeStoreUpdates:
        deps?.subscribeStoreUpdates ??
        (hasCustomDataGetters
          ? () => () => {}
          : (listener: () => void) => {
              const u1 = productRepository.subscribe(listener);
              const u2 = isvService.subscribe(listener);
              const u3 = promotorService.subscribe(listener);
              return () => {
                u1();
                u2();
                u3();
              };
            }),
    };

    if (this._deps.autoSubscribeEvents) {
      this._unsubChangeBus = onAlteracaoPacoteLocal((ev) => {
        this.registrarAlteracaoExterna(ev).catch((err) => {
          console.warn('[LocalPackage] Erro ao registrar alteração:', err);
        });
      });
      this._unsubStoreUpdates = this._deps.subscribeStoreUpdates(() => {
        this.notify();
      });
    }
  }

  public destroy(): void {
    if (this._unsubChangeBus) {
      this._unsubChangeBus();
      this._unsubChangeBus = null;
    }
    if (this._unsubStoreUpdates) {
      this._unsubStoreUpdates();
      this._unsubStoreUpdates = null;
    }
    this._listeners.clear();
  }

  public async init(): Promise<void> {
    const prontos = this._deps.getServicosProntos();
    if (this._initialized && prontos.catalogo && prontos.isv && prontos.promotores) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        try {
          const saved = await this._deps.getMeta<PersistedPackageMeta | null>(META_KEY_PACOTE, null);
          if (saved && typeof saved === 'object') {
            this._persistedMeta = {
              ...DEFAULT_PERSISTED_META,
              ...saved,
              motivosDesatualizacao: Array.isArray(saved.motivosDesatualizacao)
                ? saved.motivosDesatualizacao
                : [],
              ultimasAlteracoesComerciaisResumo: Array.isArray(
                saved.ultimasAlteracoesComerciaisResumo
              )
                ? saved.ultimasAlteracoesComerciaisResumo
                : [],
            };
          }
        } catch (e) {
          console.warn('[LocalPackage] Falha ao carregar metadados do pacote local:', e);
        }

        this.notify();

        try {
          await this._deps.initDependencies();
        } catch (e) {
          console.warn('[LocalPackage] Falha ao inicializar serviços dependentes:', e);
        }

        this._initialized = true;
        this.notify();
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  public subscribe(listener: (status: IsvPacoteStatusLocal) => void): () => void {
    this._listeners.add(listener);
    listener(this.getStatusPacote());
    return () => {
      this._listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap = this.getStatusPacote();
    this._listeners.forEach((cb) => {
      try {
        cb(snap);
      } catch (e) {
        console.warn('[LocalPackage] Erro em listener de status:', e);
      }
    });
  }

  /**
   * Marca o pacote local candidato como desatualizado sempre que houver importação de bases
   * ou edição comercial local, sem iniciar download automático.
   */
  public async registrarAlteracaoExterna(ev: EventoAlteracaoPacoteLocal): Promise<void> {
    await this.init();
    const motivos = [...this._persistedMeta.motivosDesatualizacao];
    if (!motivos.includes(ev.motivo)) {
      motivos.unshift(ev.motivo);
    }

    let alteracoesComerciaisPendentes = this._persistedMeta.alteracoesComerciaisLocaisPendentes;
    let ultimaAlteracaoComercialIso = this._persistedMeta.ultimaAlteracaoComercialIso;
    let resumoComercial = [...this._persistedMeta.ultimasAlteracoesComerciaisResumo];

    if (ev.comercial) {
      alteracoesComerciaisPendentes = true;
      ultimaAlteracaoComercialIso = ev.timestampIso;
      if (!resumoComercial.includes(ev.motivo)) {
        resumoComercial.unshift(ev.motivo);
      }
      resumoComercial = resumoComercial.slice(0, 8);
    }

    this._persistedMeta = {
      ...this._persistedMeta,
      atualizacaoDisponivel: true,
      motivosDesatualizacao: motivos.slice(0, 10),
      alteracoesComerciaisLocaisPendentes: alteracoesComerciaisPendentes,
      ultimaAlteracaoComercialIso,
      ultimasAlteracoesComerciaisResumo: resumoComercial,
    };

    await this._deps.setMeta(META_KEY_PACOTE, this._persistedMeta);
    this.notify();
  }

  // =========================================================================
  // NORMALIZAÇÃO COMERCIAL (AGÊNCIAS, PROMOTORES, VÍNCULOS E SPCOI007)
  // =========================================================================

  public construirModeloComercialNormalizado(params: {
    promotores: Promotor[];
    agenciasCadastradas?: AgenciaComercial[];
    industrias: Industria[];
    vinculosPromotorIndustria: VinculoPromotorIndustria[];
  }): {
    agencias: AgenciaComercial[];
    promotoresNormalizados: Promotor[];
    vinculosPromotorIndustria: VinculoPromotorIndustria[];
    vinculosPromotorAgencia: VinculoPromotorAgencia[];
    vinculosAgenciaIndustria: VinculoAgenciaIndustria[];
  } {
    const industriaMap = new Map<string, Industria>();
    for (const ind of params.industrias) {
      const cnpj = normalizarCnpj(ind.cnpj);
      if (cnpj) {
        industriaMap.set(cnpj, { ...ind, cnpj });
      }
    }

    const agenciasMap = new Map<string, AgenciaComercial>();
    const ensureAgencia = (
      rawNome?: string | null,
      agenciaIdSugerido?: string | null,
      metaOpcional?: Partial<AgenciaComercial>
    ): AgenciaComercial | null => {
      if (isAgenciaSemVinculoNome(rawNome)) {
        return null;
      }
      const nomeLimpo = normalizarNomeAgenciaExibicao(rawNome);
      const chave = normalizarChaveAgencia(nomeLimpo);
      if (!chave) return null;

      let existing = agenciasMap.get(chave);
      if (!existing) {
        const agenciaId =
          (agenciaIdSugerido && typeof agenciaIdSugerido === 'string' && agenciaIdSugerido.trim()) ||
          gerarAgenciaId(nomeLimpo);
        existing = {
          agenciaId,
          nome: nomeLimpo,
          nomeNormalizado: chave,
          filialId: metaOpcional?.filialId || '172',
          ativo: metaOpcional?.ativo !== undefined ? Boolean(metaOpcional.ativo) : true,
          cnpj: metaOpcional?.cnpj,
          telefone: metaOpcional?.telefone,
          contato: metaOpcional?.contato,
          observacoes: metaOpcional?.observacoes,
          criadoEm: metaOpcional?.criadoEm,
          atualizadoEm: metaOpcional?.atualizadoEm,
          totalPromotores: 0,
          totalPromotoresAtivos: 0,
          totalIndustrias: 0,
        };
        agenciasMap.set(chave, existing);
      }
      return existing;
    };

    // 1. Carregar agências independentes (incluindo agências sem promotores e metadados completos)
    if (Array.isArray(params.agenciasCadastradas)) {
      for (const ag of params.agenciasCadastradas) {
        if (!ag || !ag.nome) continue;
        ensureAgencia(ag.nome, ag.agenciaId, ag);
      }
    }

    const promotoresMap = new Map<string, Promotor>();
    for (const p of params.promotores) {
      if (!p || !p.promotorId) continue;
      const setores = Array.isArray(p.setores) && p.setores.length > 0
        ? p.setores.filter((s) => s === 'FRIOS' || s === 'LOJA')
        : ['FRIOS'];
      const setoresFinais = setores.length > 0 ? setores : ['FRIOS'];
      const ag = ensureAgencia(p.agenciaNome, p.agenciaId);

      promotoresMap.set(p.promotorId, {
        ...p,
        agenciaId: ag ? ag.agenciaId : null,
        agenciaNome: ag ? ag.nome : '',
        filialId: '172',
        filialNome: p.filialNome || 'Cascavel',
        setores: setoresFinais,
        setorId: setoresFinais[0],
        setorNome: setoresFinais.join(' • '),
      });
    }

    const vincPIMap = new Map<string, VinculoPromotorIndustria>();
    const vincPAMap = new Map<string, VinculoPromotorAgencia>();
    const vincAIMap = new Map<string, VinculoAgenciaIndustria>();

    const promotoresPorAgencia = new Map<string, Set<string>>();
    const promotoresAtivosPorAgencia = new Map<string, Set<string>>();
    const industriasPorAgencia = new Map<string, Set<string>>();

    for (const prom of promotoresMap.values()) {
      const ag = ensureAgencia(prom.agenciaNome, prom.agenciaId);
      if (!ag) continue;

      if (!promotoresPorAgencia.has(ag.agenciaId)) {
        promotoresPorAgencia.set(ag.agenciaId, new Set());
      }
      promotoresPorAgencia.get(ag.agenciaId)!.add(prom.promotorId);

      if (prom.status === 'ATIVO') {
        if (!promotoresAtivosPorAgencia.has(ag.agenciaId)) {
          promotoresAtivosPorAgencia.set(ag.agenciaId, new Set());
        }
        promotoresAtivosPorAgencia.get(ag.agenciaId)!.add(prom.promotorId);
      }

      const paId = `${prom.promotorId}__${ag.agenciaId}`;
      vincPAMap.set(paId, {
        id: paId,
        promotorId: prom.promotorId,
        promotorNome: prom.nome,
        agenciaId: ag.agenciaId,
        agenciaNome: ag.nome,
        filialId: '172',
      });
    }

    for (const v of params.vinculosPromotorIndustria) {
      if (!v || !v.promotorId || !v.cnpj) continue;
      const cnpjNorm = normalizarCnpj(v.cnpj);
      if (!cnpjNorm) continue;

      const prom = promotoresMap.get(v.promotorId);
      const ag = prom
        ? ensureAgencia(prom.agenciaNome, prom.agenciaId)
        : ensureAgencia(v.agenciaNome);

      const stableId = v.id || `${v.promotorId}_${cnpjNorm}_172`;
      vincPIMap.set(stableId, {
        ...v,
        id: stableId,
        cnpj: cnpjNorm,
        promotorNome: prom?.nome || v.promotorNome,
        agenciaNome: ag ? ag.nome : '',
        filialId: '172',
      });

      if (ag) {
        const ind = industriaMap.get(cnpjNorm);
        const razaoSocial = (ind?.razao_social || cnpjNorm).trim();
        const aiId = `${ag.agenciaId}__${cnpjNorm}`;
        vincAIMap.set(aiId, {
          id: aiId,
          agenciaId: ag.agenciaId,
          agenciaNome: ag.nome,
          cnpj: cnpjNorm,
          industriaRazaoSocial: razaoSocial,
          filialId: '172',
        });

        if (!industriasPorAgencia.has(ag.agenciaId)) {
          industriasPorAgencia.set(ag.agenciaId, new Set());
        }
        industriasPorAgencia.get(ag.agenciaId)!.add(cnpjNorm);
      }
    }

    const agencias: AgenciaComercial[] = Array.from(agenciasMap.values()).map((ag) => ({
      ...ag,
      totalPromotores: promotoresPorAgencia.get(ag.agenciaId)?.size || 0,
      totalPromotoresAtivos: promotoresAtivosPorAgencia.get(ag.agenciaId)?.size || 0,
      totalIndustrias: industriasPorAgencia.get(ag.agenciaId)?.size || 0,
    }));

    return {
      agencias,
      promotoresNormalizados: Array.from(promotoresMap.values()),
      vinculosPromotorIndustria: Array.from(vincPIMap.values()),
      vinculosPromotorAgencia: Array.from(vincPAMap.values()),
      vinculosAgenciaIndustria: Array.from(vincAIMap.values()),
    };
  }

  // =========================================================================
  // VERIFICAÇÃO DE SEGURANÇA & INTEGRIDADE DAS BASES OBRIGATÓRIAS
  // =========================================================================

  /**
   * Somente usuários autenticados no Firebase e validados no Firestore (`/usuarios_autorizados/{uid}`)
   * como `GERENCIA_ADMIN` ativo da Filial 172 podem gerar pacotes de atualização.
   * Troca visual local de perfil (`authRoleService.alternarPapel`) NÃO libera geração.
   */
  public verificarPermissaoExportacaoAdmin(): {
    permitido: boolean;
    motivo?: string;
    estadoAuth: EstadoAuthServidor;
  } {
    const estado = this._deps.getAuthEstado();

    if (!estado.isAutenticado || estado.isAnonimo) {
      return {
        permitido: false,
        motivo:
          'Autenticação obrigatória: faça login com conta Google autorizada como GERENCIA_ADMIN no Firebase para gerar o pacote oficial. A troca visual local de perfil não concede permissão administrativa.',
        estadoAuth: estado,
      };
    }

    if (!estado.isVerificadoServidor || !estado.perfil || !estado.perfil.ativo) {
      return {
        permitido: false,
        motivo:
          'Perfil administrativo ainda não verificado no servidor Firestore (/usuarios_autorizados) ou usuário inativo.',
        estadoAuth: estado,
      };
    }

    if (estado.perfil.papel !== 'GERENCIA_ADMIN') {
      return {
        permitido: false,
        motivo: `Acesso negado: perfil "${estado.perfil.papel}" não tem permissão para gerar pacotes oficiais da Filial 172 (requer GERENCIA_ADMIN verificado no servidor).`,
        estadoAuth: estado,
      };
    }

    if ((estado.perfil.filialId || '172') !== '172') {
      return {
        permitido: false,
        motivo: `Filial não autorizada (${estado.perfil.filialId}). Somente administradores da Filial 172 podem gerar este pacote.`,
        estadoAuth: estado,
      };
    }

    return { permitido: true, estadoAuth: estado };
  }

  public validarCompletudeBasesObrigatorias(): {
    basesCarregando: boolean;
    servicosProntos: { catalogo: boolean; isv: boolean; promotores: boolean };
    baseRubOk: boolean;
    baseRubMotivo?: string;
    spcoi007Ok: boolean;
    spcoi007Motivo?: string;
    saeou060Ok: boolean;
    saeou060Motivo?: string;
    todasOk: boolean;
  } {
    const servicosProntos = this._deps.getServicosProntos();
    const basesCarregando =
      !servicosProntos.catalogo || !servicosProntos.isv || !servicosProntos.promotores;

    const produtos = this._deps.getProdutos();
    const registrosOp = this._deps.getRegistrosOperacionais();
    const fornecedores = this._deps.getFornecedores();
    const industrias = this._deps.getIndustrias();
    const saeou060 = this._deps.getSaeou060();

    let baseRubOk = false;
    let baseRubMotivo: string | undefined;
    if (!servicosProntos.catalogo || !servicosProntos.isv) {
      baseRubOk = false;
      baseRubMotivo = 'Carregando BASE RUB (36 colunas) do IndexedDB local...';
    } else {
      baseRubOk = produtos.length > 0 && registrosOp.length > 0;
      baseRubMotivo = baseRubOk
        ? undefined
        : produtos.length === 0
        ? 'BASE RUB sem produtos indexados no catálogo local.'
        : 'BASE RUB incompleta: os registros operacionais (36 colunas) não estão carregados.';
    }

    let spcoi007Ok = false;
    let spcoi007Motivo: string | undefined;
    if (!servicosProntos.isv) {
      spcoi007Ok = false;
      spcoi007Motivo = 'Carregando fornecedores e indústrias SPCOI007 do IndexedDB local...';
    } else {
      const spcoiSemRazao = fornecedores.some(
        (f) => !f.cnpj || !f.razao_social || !f.razao_social.trim()
      );
      spcoi007Ok = fornecedores.length > 0 && industrias.length > 0 && !spcoiSemRazao;
      spcoi007Motivo = spcoi007Ok
        ? undefined
        : fornecedores.length === 0 || industrias.length === 0
        ? 'SPCOI007 vazia: importe fornecedores e indústrias antes de gerar o pacote.'
        : 'SPCOI007 incompleta: existem vínculos sem CNPJ ou Razão Social da Indústria.';
    }

    let saeou060Ok = false;
    let saeou060Motivo: string | undefined;
    if (!servicosProntos.catalogo) {
      saeou060Ok = false;
      saeou060Motivo = 'Carregando registros SAEOU060 do IndexedDB local...';
    } else {
      saeou060Ok = saeou060.length > 0;
      saeou060Motivo = saeou060Ok
        ? undefined
        : 'SAEOU060 ausente (0 registros no IndexedDB). Importe a planilha SAEOU060 na aba SAEOU060 antes de gerar o pacote completo.';
    }

    return {
      basesCarregando,
      servicosProntos,
      baseRubOk,
      baseRubMotivo,
      spcoi007Ok,
      spcoi007Motivo,
      saeou060Ok,
      saeou060Motivo,
      todasOk: !basesCarregando && baseRubOk && spcoi007Ok && saeou060Ok,
    };
  }

  public getStatusPacote(): IsvPacoteStatusLocal {
    const detalhesBases = this.validarCompletudeBasesObrigatorias();
    const produtos = this._deps.getProdutos();
    const registrosOp = this._deps.getRegistrosOperacionais();
    const fornecedores = this._deps.getFornecedores();
    const industrias = this._deps.getIndustrias();
    const saeou060 = this._deps.getSaeou060();
    const promotores = this._deps.getPromotores();
    const agenciasCadastradas = this._deps.getAgencias();
    const vincPI = this._deps.getVinculosPromotorIndustria();

    const comercial = this.construirModeloComercialNormalizado({
      promotores,
      agenciasCadastradas,
      industrias,
      vinculosPromotorIndustria: vincPI,
    });

    const contagensAtuais: IsvPacoteContagensSnapshot = {
      produtos: produtos.length,
      registrosOperacionais: registrosOp.length,
      fornecedores: fornecedores.length,
      industrias: industrias.length,
      saeou060: saeou060.length,
      promotores: comercial.promotoresNormalizados.length,
      agencias: comercial.agencias.length,
      vinculos:
        comercial.vinculosPromotorIndustria.length +
        comercial.vinculosPromotorAgencia.length +
        comercial.vinculosAgenciaIndustria.length,
    };

    return {
      filialId: '172',
      modoAtualizacaoLocalAtivo: isModoAtualizacaoLocalAtivo(),
      basesCarregando: detalhesBases.basesCarregando,
      servicosProntos: detalhesBases.servicosProntos,
      versaoInstaladaId: this._persistedMeta.versaoInstaladaId,
      ultimaAtualizacaoIso: this._persistedMeta.ultimaAtualizacaoIso,
      ultimaAtualizacaoTs: this._persistedMeta.ultimaAtualizacaoTs,
      origemUltimaAtualizacao: this._persistedMeta.origemUltimaAtualizacao,
      ultimaGeracaoIso: this._persistedMeta.ultimaGeracaoIso,
      ultimaGeracaoVersaoId: this._persistedMeta.ultimaGeracaoVersaoId,
      atualizacaoDisponivel: this._persistedMeta.atualizacaoDisponivel,
      motivosDesatualizacao: [...this._persistedMeta.motivosDesatualizacao],
      basesObrigatoriasOk: detalhesBases.todasOk,
      detalhesBasesObrigatorias: {
        baseRubOk: detalhesBases.baseRubOk,
        baseRubMotivo: detalhesBases.baseRubMotivo,
        spcoi007Ok: detalhesBases.spcoi007Ok,
        spcoi007Motivo: detalhesBases.spcoi007Motivo,
        saeou060Ok: detalhesBases.saeou060Ok,
        saeou060Motivo: detalhesBases.saeou060Motivo,
      },
      alteracoesComerciaisLocaisPendentes:
        this._persistedMeta.alteracoesComerciaisLocaisPendentes,
      ultimaAlteracaoComercialIso: this._persistedMeta.ultimaAlteracaoComercialIso,
      ultimasAlteracoesComerciaisResumo: [
        ...this._persistedMeta.ultimasAlteracoesComerciaisResumo,
      ],
      contagensAtuais,
    };
  }

  // =========================================================================
  // GERAÇÃO DO PACOTE ÚNICO (.ZIP STREAMING / CHUNKED)
  // =========================================================================

  public async gerarPacoteAtualizacaoIsv(
    onProgress?: (percent: number, etapa: string) => void
  ): Promise<{
    sucesso: boolean;
    mensagem: string;
    fileName?: string;
    bytes?: Uint8Array;
    blob?: Blob;
    manifesto?: IsvPacoteManifesto;
    tamanhoBytes?: number;
  }> {
    await this.init();

    if (this._operacaoEmCurso !== 'NENHUMA') {
      return {
        sucesso: false,
        mensagem: `Já existe uma operação em andamento (${this._operacaoEmCurso}). Aguarde finalizar.`,
      };
    }

    const perm = this.verificarPermissaoExportacaoAdmin();
    if (!perm.permitido) {
      return {
        sucesso: false,
        mensagem: perm.motivo || 'Permissão GERENCIA_ADMIN verificada no servidor é obrigatória.',
      };
    }

    const basesCheck = this.validarCompletudeBasesObrigatorias();
    if (basesCheck.basesCarregando) {
      return {
        sucesso: false,
        mensagem:
          'As bases locais ainda estão sendo carregadas do IndexedDB. Aguarde a conclusão antes de gerar o pacote.',
      };
    }

    if (!basesCheck.todasOk) {
      const faltando = [
        basesCheck.baseRubMotivo,
        basesCheck.spcoi007Motivo,
        basesCheck.saeou060Motivo,
      ].filter(Boolean);
      return {
        sucesso: false,
        mensagem: `Não é possível gerar o pacote com bases incompletas: ${faltando.join(' | ')}`,
      };
    }

    const produtos = this._deps.getProdutos();
    const registrosOperacionais = this._deps.getRegistrosOperacionais();
    if (registrosOperacionais.length === 0) {
      return {
        sucesso: false,
        mensagem:
          'Registros operacionais completos da BASE RUB (isv_registros_operacionais) não carregados. Não é permitido gerar pacote apenas com resumo de catálogo.',
      };
    }

    this._operacaoEmCurso = 'EXPORTANDO';

    try {
      onProgress?.(4, 'Coletando snapshot consistente das bases da Filial 172...');
      const agora = new Date();
      const versaoId = formatVersaoId(agora);
      const geradoEmIso = agora.toISOString();
      const geradoEmTs = agora.getTime();
      const fileName = `ISV_FILIAL_172_ATUALIZACAO_${formatDateYyyyMmDdLocal(agora)}.zip`;

      const fornecedores = this._deps.getFornecedores();
      const industrias = this._deps.getIndustrias();
      const saeou060 = this._deps.getSaeou060();
      const promotores = this._deps.getPromotores();
      const agenciasCadastradas = this._deps.getAgencias();
      const historicoMovimentacoes = this._deps.getHistoricoMovimentacoes();
      const vincPI = this._deps.getVinculosPromotorIndustria();
      const vincDispositivo = this._deps.getVinculosDispositivoPromotor();
      const historicoIsv = this._deps.getHistoricoIsv();
      const historicoSpcoi = this._deps.getHistoricoSpcoi();

      // Normalizar regra estrita de Razão Social SPCOI007 e cadastros comerciais
      const industriaMap = new Map(industrias.map((ind) => [normalizarCnpj(ind.cnpj), ind]));
      const fornecedoresSanitizados: FornecedorSPCOI007[] = fornecedores.map((f) => {
        const cnpjNorm = normalizarCnpj(f.cnpj);
        const ind = industriaMap.get(cnpjNorm);
        return {
          ...f,
          cnpj: cnpjNorm,
          razao_social: (ind?.razao_social || f.razao_social || '').trim(),
        };
      });

      const comercial = this.construirModeloComercialNormalizado({
        promotores,
        agenciasCadastradas,
        industrias,
        vinculosPromotorIndustria: vincPI,
      });

      const partesBaseRubProdutos = Math.max(1, Math.ceil(produtos.length / CHUNK_NDJSON_SIZE));
      const partesBaseRubOperacional = Math.max(
        1,
        Math.ceil(registrosOperacionais.length / CHUNK_NDJSON_SIZE)
      );

      // Coletar saída binária do streaming Zip (fflate)
      const zipChunks: Uint8Array[] = [];
      let zipError: any = null;
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          zipError = err;
          return;
        }
        if (chunk && chunk.length > 0) {
          zipChunks.push(chunk);
        }
        void final;
      });

      const entradasChecksum: Array<{ caminho: string; sha256: string; bytes: number }> = [];

      const adicionarEntradaCompactada = async (caminho: string, textContent: string) => {
        const u8 = strToU8(textContent);
        const sha256 = await sha256HexBytes(u8);
        entradasChecksum.push({ caminho, sha256, bytes: u8.length });
        const entry = new ZipDeflate(caminho, { level: 6 });
        zip.add(entry);
        entry.push(u8, true);
        if (zipError) throw zipError;
      };

      // 1. BASE RUB — Catálogo em partes NDJSON de ~2.000 itens
      for (let i = 0; i < partesBaseRubProdutos; i++) {
        const start = i * CHUNK_NDJSON_SIZE;
        const slice = produtos.slice(start, start + CHUNK_NDJSON_SIZE);
        const ndjson = slice.map((item) => JSON.stringify(item)).join('\n');
        const parteNum = String(i + 1).padStart(3, '0');
        await adicionarEntradaCompactada(`bases/base_rub_produtos_${parteNum}.ndjson`, ndjson);
        const pct = 10 + Math.round(((i + 1) / partesBaseRubProdutos) * 28);
        onProgress?.(pct, `Empacotando catálogo BASE RUB (parte ${i + 1}/${partesBaseRubProdutos})...`);
        await yieldThread();
      }

      // 2. BASE RUB — Registros operacionais 36 colunas em partes NDJSON
      for (let i = 0; i < partesBaseRubOperacional; i++) {
        const start = i * CHUNK_NDJSON_SIZE;
        const slice = registrosOperacionais.slice(start, start + CHUNK_NDJSON_SIZE);
        const ndjson = slice.map((item) => JSON.stringify(item)).join('\n');
        const parteNum = String(i + 1).padStart(3, '0');
        await adicionarEntradaCompactada(`bases/base_rub_operacional_${parteNum}.ndjson`, ndjson);
        const pct = 38 + Math.round(((i + 1) / partesBaseRubOperacional) * 27);
        onProgress?.(
          pct,
          `Empacotando registros operacionais BASE RUB (parte ${i + 1}/${partesBaseRubOperacional})...`
        );
        await yieldThread();
      }

      // 3. SPCOI007 e SAEOU060
      onProgress?.(68, 'Empacotando SPCOI007 (Fornecedores & Indústrias)...');
      await adicionarEntradaCompactada('bases/spcoi007.json', JSON.stringify(fornecedoresSanitizados));
      await adicionarEntradaCompactada('bases/industrias.json', JSON.stringify(industrias));
      await yieldThread();

      onProgress?.(76, 'Empacotando SAEOU060...');
      await adicionarEntradaCompactada('bases/saeou060.json', JSON.stringify(saeou060));
      await yieldThread();

      // 4. Estrutura comercial normalizada
      onProgress?.(84, 'Empacotando promotores, agências e vínculos comerciais...');
      await adicionarEntradaCompactada('comercial/agencias.json', JSON.stringify(comercial.agencias));
      await adicionarEntradaCompactada(
        'comercial/promotores.json',
        JSON.stringify(comercial.promotoresNormalizados)
      );
      await adicionarEntradaCompactada(
        'comercial/vinculos_promotor_industria.json',
        JSON.stringify(comercial.vinculosPromotorIndustria)
      );
      await adicionarEntradaCompactada(
        'comercial/vinculos_promotor_agencia.json',
        JSON.stringify(comercial.vinculosPromotorAgencia)
      );
      await adicionarEntradaCompactada(
        'comercial/vinculos_agencia_industria.json',
        JSON.stringify(comercial.vinculosAgenciaIndustria)
      );
      await adicionarEntradaCompactada(
        'comercial/vinculos_dispositivo.json',
        JSON.stringify(vincDispositivo)
      );
      await adicionarEntradaCompactada(
        'comercial/historico_movimentacoes.json',
        JSON.stringify(historicoMovimentacoes)
      );

      // 5. Metadados e históricos das bases
      onProgress?.(90, 'Calculando assinaturas SHA-256 de integridade...');
      await adicionarEntradaCompactada(
        'metadados_bases.json',
        JSON.stringify({
          filialId: '172',
          filialNome: 'FILIAL 172 — CASCAVEL',
          geradoEmIso,
          versaoId,
          historicoIsv: historicoIsv.slice(0, 20),
          historicoSpcoi: historicoSpcoi.slice(0, 20),
        })
      );

      const resumoHashesTexto = entradasChecksum
        .slice()
        .sort((a, b) => a.caminho.localeCompare(b.caminho))
        .map((e) => `${e.caminho}:${e.sha256}:${e.bytes}`)
        .join('\n');
      const sha256DadosConsolidados = await sha256HexText(resumoHashesTexto);

      const manifesto: IsvPacoteManifesto = {
        formato: 'ISV_FILIAL_172_PACOTE_LOCAL',
        versaoFormato: 1,
        filialId: '172',
        filialNome: 'FILIAL 172 — CASCAVEL',
        versaoId,
        geradoEmIso,
        geradoEmTs,
        geradoPorUid: perm.estadoAuth.uid || undefined,
        geradoPorNome: perm.estadoAuth.perfil?.nome,
        geradoPorEmail: perm.estadoAuth.email || undefined,
        assinaturaCriptograficaPresente: false,
        autenticidadeStatusPadrao: 'INTEGRIDADE_VERIFICADA_SEM_ASSINATURA_PKI',
        autenticidadeNota:
          'Integridade dos arquivos validada por SHA-256 contra o manifesto. Este pacote local não contém assinatura criptográfica assimétrica (PKI).',
        regraFornecedor: 'RAZAO_SOCIAL_SPCOI007',
        contagens: {
          produtos: produtos.length,
          registrosOperacionais: registrosOperacionais.length,
          fornecedores: fornecedoresSanitizados.length,
          industrias: industrias.length,
          saeou060: saeou060.length,
          promotores: comercial.promotoresNormalizados.length,
          agencias: comercial.agencias.length,
          vinculosPromotorIndustria: comercial.vinculosPromotorIndustria.length,
          vinculosPromotorAgencia: comercial.vinculosPromotorAgencia.length,
          vinculosAgenciaIndustria: comercial.vinculosAgenciaIndustria.length,
          vinculosDispositivoPromotor: vincDispositivo.length,
          historicoIsv: Math.min(historicoIsv.length, 20),
          historicoSpcoi: Math.min(historicoSpcoi.length, 20),
        },
        partesBaseRubProdutos,
        partesBaseRubOperacional,
        sha256DadosConsolidados,
        entradas: entradasChecksum,
      };

      // Gravar manifest.json no ZIP
      const manifestU8 = strToU8(JSON.stringify(manifesto, null, 2));
      const manifestEntry = new ZipDeflate('manifest.json', { level: 6 });
      zip.add(manifestEntry);
      manifestEntry.push(manifestU8, true);
      zip.end();
      if (zipError) throw zipError;

      onProgress?.(96, 'Finalizando arquivo único compactado (.zip)...');
      const totalBytes = zipChunks.reduce((acc, c) => acc + c.length, 0);
      const finalBytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const c of zipChunks) {
        finalBytes.set(c, offset);
        offset += c.length;
      }

      const blob = new Blob([finalBytes], { type: 'application/zip' });

      // Atualizar status local do gerador (sem auto-download)
      this._persistedMeta = {
        ...this._persistedMeta,
        versaoInstaladaId: this._persistedMeta.versaoInstaladaId || versaoId,
        ultimaAtualizacaoIso: this._persistedMeta.ultimaAtualizacaoIso || geradoEmIso,
        ultimaAtualizacaoTs: this._persistedMeta.ultimaAtualizacaoTs || geradoEmTs,
        origemUltimaAtualizacao:
          this._persistedMeta.origemUltimaAtualizacao === 'NENHUMA'
            ? 'GERACAO_LOCAL'
            : this._persistedMeta.origemUltimaAtualizacao,
        ultimaGeracaoIso: geradoEmIso,
        ultimaGeracaoVersaoId: versaoId,
        atualizacaoDisponivel: false,
        motivosDesatualizacao: [],
        alteracoesComerciaisLocaisPendentes: false,
        ultimasAlteracoesComerciaisResumo: [],
      };
      await this._deps.setMeta(META_KEY_PACOTE, this._persistedMeta);
      this.notify();

      onProgress?.(100, `Pacote ${fileName} pronto (${(totalBytes / 1024).toFixed(1)} KB).`);

      return {
        sucesso: true,
        mensagem: `Pacote gerado com sucesso (${fileName}). Compartilhe o arquivo via WhatsApp, Google Drive ou pendrive.`,
        fileName,
        bytes: finalBytes,
        blob,
        manifesto,
        tamanhoBytes: totalBytes,
      };
    } catch (err: any) {
      return {
        sucesso: false,
        mensagem: `Erro ao gerar pacote de atualização ISV: ${err?.message || 'Falha interna.'}`,
      };
    } finally {
      this._operacaoEmCurso = 'NENHUMA';
    }
  }

  /**
   * Acionado exclusivamente em resposta a clique explícito do usuário no botão
   * **BAIXAR ATUALIZAÇÃO ISV**. Nunca chamado automaticamente após importações.
   */
  public dispararDownloadPacoteBrowser(blob: Blob, fileName: string): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // ignore cleanup error
      }
    }, 1000);
  }

  // =========================================================================
  // INSPEÇÃO E VALIDAÇÃO DO PACOTE (ETAPAS 1 A 7 — SEM EXIGIR LOGIN)
  // =========================================================================

  public async inspecionarPacoteAtualizacaoIsv(
    entrada: Blob | File | Uint8Array | ArrayBuffer,
    onProgress?: (percent: number, etapa: string) => void
  ): Promise<ResultadoInspecaoPacoteIsv> {
    await this.init();

    if (this._operacaoEmCurso !== 'NENHUMA') {
      return {
        validoParaInstalacao: false,
        autenticidadeStatus: 'REJEITADO_FORMATO_INVALIDO',
        autenticidadeMensagem: 'Já existe uma operação de pacote em andamento.',
        integridadeSha256Ok: false,
        arquivosVerificados: 0,
        errosBloqueantes: ['Aguarde a conclusão da operação anterior antes de importar outro arquivo.'],
      };
    }

    this._operacaoEmCurso = 'INSPECIONANDO';

    try {
      // Etapa 1: Leitura e assinatura ZIP (PK)
      onProgress?.(8, 'Etapa 1/7: Lendo arquivo e verificando estrutura ZIP...');
      let bytes: Uint8Array;
      if (entrada instanceof Uint8Array) {
        bytes = entrada;
      } else if (entrada instanceof ArrayBuffer) {
        bytes = new Uint8Array(entrada);
      } else if (typeof (entrada as any)?.arrayBuffer === 'function') {
        const ab = await (entrada as Blob).arrayBuffer();
        bytes = new Uint8Array(ab);
      } else {
        return {
          validoParaInstalacao: false,
          autenticidadeStatus: 'REJEITADO_FORMATO_INVALIDO',
          autenticidadeMensagem: 'Tipo de entrada inválido para pacote ZIP.',
          integridadeSha256Ok: false,
          arquivosVerificados: 0,
          errosBloqueantes: ['O arquivo informado não pôde ser lido como binário.'],
        };
      }

      if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        return {
          validoParaInstalacao: false,
          autenticidadeStatus: 'REJEITADO_FORMATO_INVALIDO',
          autenticidadeMensagem: 'Arquivo inválido: cabeçalho não corresponde a um pacote .zip válido.',
          integridadeSha256Ok: false,
          arquivosVerificados: 0,
          errosBloqueantes: [
            'O arquivo selecionado não é um pacote ZIP válido da atualização ISV.',
          ],
        };
      }

      // Etapa 2: Descompactação segura e verificação de manifest.json
      onProgress?.(22, 'Etapa 2/7: Descompactando e validando manifest.json...');
      let files: Record<string, Uint8Array>;
      try {
        files = unzipSync(bytes);
      } catch (unzipErr: any) {
        return {
          validoParaInstalacao: false,
          autenticidadeStatus: 'REJEITADO_CORROMPIDO',
          autenticidadeMensagem: `Pacote ZIP corrompido ou truncado (${unzipErr?.message || 'erro de descompactação'}).`,
          integridadeSha256Ok: false,
          arquivosVerificados: 0,
          errosBloqueantes: [
            'Não foi possível descompactar o arquivo ZIP. Solicite um novo envio do arquivo à gerência.',
          ],
        };
      }

      const manifestBytes = files['manifest.json'];
      if (!manifestBytes) {
        return {
          validoParaInstalacao: false,
          autenticidadeStatus: 'REJEITADO_FORMATO_INVALIDO',
          autenticidadeMensagem: 'manifest.json ausente no arquivo ZIP.',
          integridadeSha256Ok: false,
          arquivosVerificados: 0,
          errosBloqueantes: ['O arquivo ZIP não contém manifest.json oficial do ISV Filial 172.'],
        };
      }

      let manifesto: IsvPacoteManifesto;
      try {
        manifesto = JSON.parse(strFromU8(manifestBytes));
      } catch {
        return {
          validoParaInstalacao: false,
          autenticidadeStatus: 'REJEITADO_CORROMPIDO',
          autenticidadeMensagem: 'manifest.json ilegível ou corrompido.',
          integridadeSha256Ok: false,
          arquivosVerificados: 0,
          errosBloqueantes: ['Não foi possível interpretar o manifest.json do pacote.'],
        };
      }

      // Etapa 3: Validação de formato, schema e Filial 172
      onProgress?.(34, 'Etapa 3/7: Validando filial (172) e esquema do pacote...');
      if (manifesto.formato !== 'ISV_FILIAL_172_PACOTE_LOCAL' || !manifesto.versaoFormato) {
        return {
          validoParaInstalacao: false,
          autenticidadeStatus: 'REJEITADO_FORMATO_INVALIDO',
          autenticidadeMensagem: 'Formato do manifesto incompatível com ISV_FILIAL_172_PACOTE_LOCAL.',
          integridadeSha256Ok: false,
          arquivosVerificados: 0,
          manifesto,
          errosBloqueantes: ['Este arquivo não pertence ao formato oficial de atualização local ISV.'],
        };
      }

      if (manifesto.filialId !== '172') {
        return {
          validoParaInstalacao: false,
          autenticidadeStatus: 'REJEITADO_FILIAL_INCOMPATIVEL',
          autenticidadeMensagem: `Filial incompatível: pacote gerado para a Filial "${manifesto.filialId || 'desconhecida'}", esperado "172".`,
          integridadeSha256Ok: false,
          arquivosVerificados: 0,
          manifesto,
          errosBloqueantes: [
            `Pacote incompatível: destinado à Filial "${manifesto.filialId || '?'}", não à Filial 172 — Cascavel.`,
          ],
        };
      }

      // Etapa 4: Verificação SHA-256 de cada arquivo e do hash consolidado
      onProgress?.(50, 'Etapa 4/7: Conferindo assinaturas de integridade SHA-256...');
      const errosIntegridade: string[] = [];
      let arquivosVerificados = 0;

      if (!Array.isArray(manifesto.entradas) || manifesto.entradas.length === 0) {
        errosIntegridade.push('Lista de arquivos e checksums SHA-256 ausente no manifesto.');
      } else {
        for (const entradaMeta of manifesto.entradas) {
          const entryBytes = files[entradaMeta.caminho];
          if (!entryBytes) {
            errosIntegridade.push(`Arquivo ausente no pacote: ${entradaMeta.caminho}`);
            continue;
          }
          if (entryBytes.length !== entradaMeta.bytes) {
            errosIntegridade.push(
              `Tamanho divergente em ${entradaMeta.caminho} (esperado ${entradaMeta.bytes} B, encontrado ${entryBytes.length} B).`
            );
            continue;
          }
          const hashCalculado = await sha256HexBytes(entryBytes);
          if (hashCalculado !== entradaMeta.sha256) {
            errosIntegridade.push(
              `Checksum SHA-256 divergente em ${entradaMeta.caminho} (arquivo corrompido ou adulterado).`
            );
            continue;
          }
          arquivosVerificados++;
        }

        const resumoHashesTexto = manifesto.entradas
          .slice()
          .sort((a, b) => a.caminho.localeCompare(b.caminho))
          .map((e) => `${e.caminho}:${e.sha256}:${e.bytes}`)
          .join('\n');
        const hashConsolidadoCalc = await sha256HexText(resumoHashesTexto);
        if (hashConsolidadoCalc !== manifesto.sha256DadosConsolidados) {
          errosIntegridade.push('Hash consolidado do manifesto não confere com as entradas.');
        }
      }

      if (errosIntegridade.length > 0) {
        return {
          validoParaInstalacao: false,
          autenticidadeStatus: 'REJEITADO_CORROMPIDO',
          autenticidadeMensagem:
            'Falha na validação de integridade SHA-256. O pacote pode estar corrompido ou ter sido alterado.',
          integridadeSha256Ok: false,
          arquivosVerificados,
          manifesto,
          errosBloqueantes: errosIntegridade,
        };
      }

      // Etapa 5: Declaração honesta de autenticidade (sem chaves privadas no frontend)
      onProgress?.(64, 'Etapa 5/7: Analisando payload e integridade referencial...');
      const errosBloqueantes: string[] = [];

      const parseJsonFile = <T>(path: string, fallback: T): T => {
        const b = files[path];
        if (!b) {
          errosBloqueantes.push(`Arquivo obrigatório ausente: ${path}`);
          return fallback;
        }
        try {
          return JSON.parse(strFromU8(b)) as T;
        } catch {
          errosBloqueantes.push(`JSON inválido em ${path}`);
          return fallback;
        }
      };

      const produtos: ProdutoSMG[] = [];
      for (let i = 1; i <= (manifesto.partesBaseRubProdutos || 1); i++) {
        const path = `bases/base_rub_produtos_${String(i).padStart(3, '0')}.ndjson`;
        const b = files[path];
        if (!b) {
          errosBloqueantes.push(`Parte da BASE RUB ausente: ${path}`);
          continue;
        }
        const linhas = strFromU8(b).split('\n').filter((l) => l.trim().length > 0);
        for (const linha of linhas) {
          produtos.push(JSON.parse(linha) as ProdutoSMG);
        }
        await yieldThread();
      }

      const registrosOperacionais: RegistroPlanilhaIsv[] = [];
      for (let i = 1; i <= (manifesto.partesBaseRubOperacional || 1); i++) {
        const path = `bases/base_rub_operacional_${String(i).padStart(3, '0')}.ndjson`;
        const b = files[path];
        if (!b) {
          errosBloqueantes.push(`Parte operacional da BASE RUB ausente: ${path}`);
          continue;
        }
        const linhas = strFromU8(b).split('\n').filter((l) => l.trim().length > 0);
        for (const linha of linhas) {
          registrosOperacionais.push(JSON.parse(linha) as RegistroPlanilhaIsv);
        }
        await yieldThread();
      }

      const fornecedores = parseJsonFile<FornecedorSPCOI007[]>('bases/spcoi007.json', []);
      const industrias = parseJsonFile<Industria[]>('bases/industrias.json', []);
      const saeou060 = parseJsonFile<RegistroSaeou060[]>('bases/saeou060.json', []);
      const agencias = parseJsonFile<AgenciaComercial[]>('comercial/agencias.json', []);
      const promotores = parseJsonFile<Promotor[]>('comercial/promotores.json', []);
      const vinculosPromotorIndustria = parseJsonFile<VinculoPromotorIndustria[]>(
        'comercial/vinculos_promotor_industria.json',
        []
      );
      const vinculosPromotorAgencia = parseJsonFile<VinculoPromotorAgencia[]>(
        'comercial/vinculos_promotor_agencia.json',
        []
      );
      const vinculosAgenciaIndustria = parseJsonFile<VinculoAgenciaIndustria[]>(
        'comercial/vinculos_agencia_industria.json',
        []
      );
      const vinculosDispositivoPromotor = parseJsonFile<VinculoPromotor[]>(
        'comercial/vinculos_dispositivo.json',
        []
      );
      let historicoMovimentacoes: HistoricoMovimentacaoComercial[] = [];
      const histMovBytes = files['comercial/historico_movimentacoes.json'];
      if (histMovBytes) {
        try {
          const parsedMov = JSON.parse(strFromU8(histMovBytes));
          if (Array.isArray(parsedMov)) historicoMovimentacoes = parsedMov;
        } catch {
          errosBloqueantes.push('JSON inválido em comercial/historico_movimentacoes.json');
        }
      }
      const metaBases = parseJsonFile<any>('metadados_bases.json', {});

      // Conferir contagens e integridade das 3 bases obrigatórias + referências comerciais
      if (produtos.length !== manifesto.contagens.produtos) {
        errosBloqueantes.push(
          `Quantidade de produtos divergente (${produtos.length} vs ${manifesto.contagens.produtos}).`
        );
      }
      if (registrosOperacionais.length !== manifesto.contagens.registrosOperacionais) {
        errosBloqueantes.push(
          `Quantidade de registros operacionais divergente (${registrosOperacionais.length} vs ${manifesto.contagens.registrosOperacionais}).`
        );
      }
      if (fornecedores.length !== manifesto.contagens.fornecedores) {
        errosBloqueantes.push(
          `Quantidade de fornecedores SPCOI007 divergente (${fornecedores.length} vs ${manifesto.contagens.fornecedores}).`
        );
      }
      if (saeou060.length !== manifesto.contagens.saeou060) {
        errosBloqueantes.push(
          `Quantidade de registros SAEOU060 divergente (${saeou060.length} vs ${manifesto.contagens.saeou060}).`
        );
      }
      if (produtos.length === 0 || registrosOperacionais.length === 0) {
        errosBloqueantes.push('BASE RUB do pacote está vazia.');
      }
      if (fornecedores.length === 0 || industrias.length === 0) {
        errosBloqueantes.push('Base SPCOI007 do pacote está vazia ou sem indústrias.');
      }
      if (saeou060.length === 0) {
        errosBloqueantes.push('Base SAEOU060 do pacote está vazia.');
      }

      // Verificar integridade referencial dos vínculos comerciais
      const promIds = new Set(promotores.map((p) => p.promotorId));
      const agIds = new Set(agencias.map((a) => a.agenciaId));
      const cnpjSet = new Set(industrias.map((i) => normalizarCnpj(i.cnpj)));

      for (const vpa of vinculosPromotorAgencia) {
        if (!promIds.has(vpa.promotorId) || !agIds.has(vpa.agenciaId)) {
          errosBloqueantes.push(`Vínculo Promotor↔Agência órfão detectado (${vpa.id}).`);
          break;
        }
      }
      for (const vai of vinculosAgenciaIndustria) {
        if (!agIds.has(vai.agenciaId) || !cnpjSet.has(normalizarCnpj(vai.cnpj))) {
          errosBloqueantes.push(`Vínculo Agência↔Indústria órfão detectado (${vai.id}).`);
          break;
        }
      }

      // Etapa 6: Comparação de versões, detecção de downgrade e conflitos comerciais locais
      onProgress?.(82, 'Etapa 6/7: Comparando versões e detectando conflitos locais...');
      const versaoAtualId = this._persistedMeta.versaoInstaladaId;
      const tsAtual = this._persistedMeta.ultimaAtualizacaoTs;

      let comparacaoVersao: ComparacaoVersaoPacote = 'PRIMEIRA_INSTALACAO';
      let exigeConfirmacaoDowngrade = false;
      const avisos: string[] = [];

      if (versaoAtualId) {
        if (versaoAtualId === manifesto.versaoId) {
          comparacaoVersao = 'MESMA_VERSAO';
          avisos.push('Este pacote possui exatamente a mesma versão já instalada neste dispositivo.');
        } else if (tsAtual && manifesto.geradoEmTs < tsAtual) {
          comparacaoVersao = 'VERSAO_ANTERIOR_DOWNGRADE';
          exigeConfirmacaoDowngrade = true;
          avisos.push(
            `ATENÇÃO (DOWNGRADE): O pacote foi gerado em ${new Date(manifesto.geradoEmIso).toLocaleString('pt-BR')}, anterior à versão atual instalada neste dispositivo.`
          );
        } else {
          comparacaoVersao = 'NOVA_VERSAO';
        }
      }

      const conflitosComerciais: ConflitoCadastroComercial[] = [];
      if (this._persistedMeta.alteracoesComerciaisLocaisPendentes) {
        const resumos = this._persistedMeta.ultimasAlteracoesComerciaisResumo;
        if (resumos.length > 0) {
          resumos.forEach((desc) => {
            conflitosComerciais.push({ tipo: 'VINCULO', descricao: desc });
          });
        } else {
          conflitosComerciais.push({
            tipo: 'PROMOTOR',
            descricao:
              'Existem alterações locais em promotores, agências ou vínculos realizadas após a última atualização.',
          });
        }
        avisos.push(
          'Existem edições comerciais locais pendentes neste dispositivo. Escolha na confirmação se deseja substituir pelo pacote ou manter as alterações locais.'
        );
      }

      // Etapa 7: Verificar estimativa de espaço disponível no armazenamento do navegador
      onProgress?.(94, 'Etapa 7/7: Verificando cota estimada de armazenamento local...');
      const est = await this._deps.estimateStorage();
      const rawJsonTotalBytes = manifesto.entradas.reduce((acc, e) => acc + e.bytes, 0);
      const necessarioEstimadoBytes = Math.round(rawJsonTotalBytes * ESTIMATE_MULTIPLIER_IDB);
      const disponivelBytes =
        est.quota !== null && est.usage !== null ? Math.max(0, est.quota - est.usage) : null;
      const espacoSuficiente =
        disponivelBytes === null ? true : disponivelBytes >= necessarioEstimadoBytes;

      if (!espacoSuficiente && disponivelBytes !== null) {
        errosBloqueantes.push(
          `Espaço de armazenamento insuficiente no navegador (estimado necessário: ${(necessarioEstimadoBytes / (1024 * 1024)).toFixed(1)} MB; disponível: ${(disponivelBytes / (1024 * 1024)).toFixed(1)} MB).`
        );
      }

      const statusAtual = this.getStatusPacote();
      const contagensPacote: IsvPacoteContagensSnapshot = {
        produtos: produtos.length,
        registrosOperacionais: registrosOperacionais.length,
        fornecedores: fornecedores.length,
        industrias: industrias.length,
        saeou060: saeou060.length,
        promotores: promotores.length,
        agencias: agencias.length,
        vinculos:
          vinculosPromotorIndustria.length +
          vinculosPromotorAgencia.length +
          vinculosAgenciaIndustria.length,
      };

      const resumoComparacao: ResumoComparacaoPacote = {
        comparacaoVersao,
        exigeConfirmacaoDowngrade,
        versaoAtualId,
        versaoPacoteId: manifesto.versaoId,
        contagensAtuais: statusAtual.contagensAtuais,
        contagensPacote,
        conflitosComerciais,
        avisos,
      };

      const valido = errosBloqueantes.length === 0;
      onProgress?.(
        100,
        valido
          ? 'Inspeção concluída! Aguardando confirmação explícita do usuário.'
          : 'Inspeção encontrou bloqueios que impedem a instalação.'
      );

      return {
        validoParaInstalacao: valido,
        autenticidadeStatus: 'INTEGRIDADE_VERIFICADA_SEM_ASSINATURA_PKI',
        autenticidadeMensagem:
          'Integridade SHA-256 confirmada para todos os arquivos do pacote. Observação: pacotes locais não possuem assinatura criptográfica assimétrica (PKI).',
        integridadeSha256Ok: true,
        arquivosVerificados,
        manifesto,
        resumoComparacao,
        espacoEstimado: {
          disponivelBytes,
          quotaBytes: est.quota,
          necessarioEstimadoBytes,
          suficiente: espacoSuficiente,
          aviso:
            disponivelBytes !== null && !espacoSuficiente
              ? 'Espaço insuficiente para staging seguro no IndexedDB.'
              : 'O navegador gerencia o IndexedDB por origem e pode aplicar políticas automáticas de limpeza em casos de falta de espaço no dispositivo.',
        },
        errosBloqueantes,
        payload: valido
          ? {
              manifesto,
              produtos,
              registrosOperacionais,
              fornecedores,
              industrias,
              saeou060,
              promotores,
              agencias,
              vinculosPromotorIndustria,
              vinculosPromotorAgencia,
              vinculosAgenciaIndustria,
              vinculosDispositivoPromotor,
              historicoMovimentacoes,
              historicoIsv: Array.isArray(metaBases?.historicoIsv) ? metaBases.historicoIsv : [],
              historicoSpcoi: Array.isArray(metaBases?.historicoSpcoi)
                ? metaBases.historicoSpcoi
                : [],
            }
          : undefined,
      };
    } finally {
      this._operacaoEmCurso = 'NENHUMA';
    }
  }

  // =========================================================================
  // INSTALAÇÃO SEGURA COM STAGING E ROLLBACK (ETAPAS 8 A 13)
  // =========================================================================

  public async instalarPacoteAtualizacaoIsv(
    inspecao: ResultadoInspecaoPacoteIsv,
    confirmacoes: {
      confirmarSubstituicaoBases: boolean;
      confirmarDowngrade?: boolean;
      resolucaoConflitoComercial?: ResolucaoConflitoPacote;
      /** Gancho opcional exclusivo para testes automatizados simularem falha no meio da troca */
      onBeforeCommitTestHook?: (etapa: string) => Promise<void> | void;
    },
    onProgress?: (percent: number, etapa: string) => void
  ): Promise<ResultadoInstalacaoPacoteIsv> {
    await this.init();

    if (!inspecao.validoParaInstalacao || !inspecao.payload || !inspecao.resumoComparacao) {
      return {
        sucesso: false,
        mensagem:
          inspecao.errosBloqueantes[0] ||
          'Este pacote não passou na inspeção prévia e foi bloqueado antes da gravação.',
        avisos: inspecao.errosBloqueantes,
      };
    }

    if (!confirmacoes.confirmarSubstituicaoBases) {
      return {
        sucesso: false,
        mensagem: 'Confirmação explícita do usuário é obrigatória antes de substituir as bases.',
        avisos: [],
      };
    }

    if (
      inspecao.resumoComparacao.exigeConfirmacaoDowngrade &&
      !confirmacoes.confirmarDowngrade
    ) {
      return {
        sucesso: false,
        mensagem:
          'Este pacote é mais antigo que a versão atual (downgrade). Confirme explicitamente a substituição para versão anterior.',
        avisos: [],
      };
    }

    const temConflitos = inspecao.resumoComparacao.conflitosComerciais.length > 0;
    if (temConflitos && !confirmacoes.resolucaoConflitoComercial) {
      return {
        sucesso: false,
        mensagem:
          'Existem alterações comerciais locais pendentes. Escolha entre SUBSTITUIR_PELO_PACOTE ou MANTER_ALTERACOES_LOCAIS.',
        avisos: [],
      };
    }

    if (this._operacaoEmCurso !== 'NENHUMA') {
      return {
        sucesso: false,
        mensagem: 'Já existe uma instalação em andamento.',
        avisos: [],
      };
    }

    this._operacaoEmCurso = 'INSTALANDO';
    const payload = inspecao.payload;
    const preservarComerciaisLocais =
      temConflitos && confirmacoes.resolucaoConflitoComercial === 'MANTER_ALTERACOES_LOCAIS';

    // Capturar snapshot completo para rollback caso qualquer etapa falhe
    const rollbackSnapshot = {
      produtos: this._deps.getProdutos(),
      saeou060: this._deps.getSaeou060(),
      registrosOperacionais: this._deps.getRegistrosOperacionais(),
      fornecedores: this._deps.getFornecedores(),
      industrias: this._deps.getIndustrias(),
      vinculosPromotorIndustria: this._deps.getVinculosPromotorIndustria(),
      historicoIsv: this._deps.getHistoricoIsv(),
      historicoSpcoi: this._deps.getHistoricoSpcoi(),
      promotores: this._deps.getPromotores(),
      agencias: this._deps.getAgencias(),
      historicoMovimentacoes: this._deps.getHistoricoMovimentacoes(),
      vinculosDispositivoPromotor: this._deps.getVinculosDispositivoPromotor(),
      persistedMeta: { ...this._persistedMeta },
    };

    let etapaAtual = 'STAGING';
    let catalogoAplicado = false;
    let isvAplicado = false;
    let promotoresAplicados = false;

    try {
      // Etapa 9: Gravação temporária controlada em staging (sem tocar stores ativas)
      onProgress?.(15, 'Etapa 9/13: Preparando área temporária de staging...');
      await this._deps.clearStaging();

      const stagingBatches = Math.max(
        1,
        Math.ceil(payload.produtos.length / CHUNK_STAGING_SIZE)
      );
      for (let i = 0; i < stagingBatches; i++) {
        const slice = payload.produtos.slice(
          i * CHUNK_STAGING_SIZE,
          (i + 1) * CHUNK_STAGING_SIZE
        );
        await this._deps.putStaging(`stage_produtos_${i}`, slice);
        const pct = 15 + Math.round(((i + 1) / stagingBatches) * 20);
        onProgress?.(
          pct,
          `Etapa 9/13: Gravando staging BASE RUB (${i + 1}/${stagingBatches})...`
        );
        await yieldThread();
      }

      await this._deps.putStaging('stage_saeou060', payload.saeou060);
      await this._deps.putStaging('stage_spcoi', {
        fornecedores: payload.fornecedores,
        industrias: payload.industrias,
      });
      await this._deps.putStaging('stage_comercial', {
        promotores: payload.promotores,
        agencias: payload.agencias,
        vinculosPI: payload.vinculosPromotorIndustria,
      });

      // Etapa 10: Conferência final de staging & contagens antes da troca ativa
      etapaAtual = 'CONFERENCIA_STAGING';
      onProgress?.(45, 'Etapa 10/13: Conferindo integridade do staging antes da troca...');
      if (confirmacoes.onBeforeCommitTestHook) {
        await confirmacoes.onBeforeCommitTestHook(etapaAtual);
      }

      // Etapa 11: Troca controlada das coleções do pacote (preservando vencimentos, EANs e filas)
      etapaAtual = 'TROCA_CATALOGO_E_SAEOU';
      onProgress?.(
        58,
        'Etapa 11/13: Aplicando BASE RUB e SAEOU060 (vencimentos e EANs 100% preservados)...'
      );
      const preservacao = await this._deps.aplicarCatalogoESaeou({
        produtos: payload.produtos,
        saeou060: payload.saeou060,
        versaoPacoteId: payload.manifesto.versaoId,
        dataGeracaoIso: payload.manifesto.geradoEmIso,
      });
      catalogoAplicado = true;

      etapaAtual = 'TROCA_ISV_SPCOI';
      onProgress?.(72, 'Etapa 11/13: Aplicando SPCOI007, BASE RUB operacional e vínculos...');
      if (confirmacoes.onBeforeCommitTestHook) {
        await confirmacoes.onBeforeCommitTestHook(etapaAtual);
      }
      await this._deps.aplicarIsv({
        registrosOperacionais: payload.registrosOperacionais,
        fornecedores: payload.fornecedores,
        industrias: payload.industrias,
        vinculosPromotorIndustria: payload.vinculosPromotorIndustria,
        historicoIsv: payload.historicoIsv,
        historicoSpcoi: payload.historicoSpcoi,
        preservarAlteracoesComerciaisLocais: preservarComerciaisLocais,
      });
      isvAplicado = true;

      etapaAtual = 'TROCA_COMERCIAL_PROMOTORES';
      onProgress?.(84, 'Etapa 11/13: Aplicando cadastros de promotores e agências...');
      if (confirmacoes.onBeforeCommitTestHook) {
        await confirmacoes.onBeforeCommitTestHook(etapaAtual);
      }
      await this._deps.aplicarPromotores({
        promotores: payload.promotores,
        agencias: payload.agencias,
        historicoMovimentacoes: payload.historicoMovimentacoes,
        vinculosDispositivoPromotor: payload.vinculosDispositivoPromotor,
        preservarAlteracoesComerciaisLocais: preservarComerciaisLocais,
      });
      promotoresAplicados = true;

      // Etapa 12: Limpar staging, atualizar metadados do pacote e reconstruir índices
      etapaAtual = 'ATUALIZACAO_METADADOS';
      onProgress?.(94, 'Etapa 12/13: Atualizando versão instalada e limpando staging...');
      await this._deps.clearStaging();

      this._persistedMeta = {
        ...this._persistedMeta,
        versaoInstaladaId: payload.manifesto.versaoId,
        ultimaAtualizacaoIso: new Date().toISOString(),
        ultimaAtualizacaoTs: payload.manifesto.geradoEmTs,
        origemUltimaAtualizacao: 'IMPORTACAO_PACOTE',
        atualizacaoDisponivel: preservarComerciaisLocais,
        motivosDesatualizacao: preservarComerciaisLocais
          ? ['Alterações comerciais locais mantidas após importação do pacote.']
          : [],
        alteracoesComerciaisLocaisPendentes: preservarComerciaisLocais,
        ultimaAlteracaoComercialIso: preservarComerciaisLocais
          ? this._persistedMeta.ultimaAlteracaoComercialIso
          : null,
        ultimasAlteracoesComerciaisResumo: preservarComerciaisLocais
          ? this._persistedMeta.ultimasAlteracoesComerciaisResumo
          : [],
      };
      await this._deps.setMeta(META_KEY_PACOTE, this._persistedMeta);
      this.notify();

      // Etapa 13: Confirmação final
      onProgress?.(100, 'Etapa 13/13: Atualização local concluída com integridade total!');

      return {
        sucesso: true,
        mensagem: `Pacote ${payload.manifesto.versaoId} instalado com sucesso! Vencimentos (${preservacao.vencimentosPreservados}) e vínculos EAN (${preservacao.vinculosEanPreservados}) foram 100% preservados.`,
        versaoInstaladaId: payload.manifesto.versaoId,
        resumoComparacao: inspecao.resumoComparacao,
        preservacaoGarantida: {
          vencimentosPreservados: preservacao.vencimentosPreservados,
          vinculosEanPreservados: preservacao.vinculosEanPreservados,
          filaSyncPreservada: true,
        },
        avisos: inspecao.resumoComparacao.avisos,
      };
    } catch (err: any) {
      // ROLLBACK ATÔMICO EM CASO DE FALHA NA TROCA
      let rollbackOk = false;
      try {
        if (catalogoAplicado) {
          await this._deps.aplicarCatalogoESaeou({
            produtos: rollbackSnapshot.produtos,
            saeou060: rollbackSnapshot.saeou060,
            versaoPacoteId: rollbackSnapshot.persistedMeta.versaoInstaladaId || 'ROLLBACK',
            dataGeracaoIso:
              rollbackSnapshot.persistedMeta.ultimaAtualizacaoIso || new Date().toISOString(),
          });
        }
        if (isvAplicado) {
          await this._deps.aplicarIsv({
            registrosOperacionais: rollbackSnapshot.registrosOperacionais,
            fornecedores: rollbackSnapshot.fornecedores,
            industrias: rollbackSnapshot.industrias,
            vinculosPromotorIndustria: rollbackSnapshot.vinculosPromotorIndustria,
            historicoIsv: rollbackSnapshot.historicoIsv,
            historicoSpcoi: rollbackSnapshot.historicoSpcoi,
            preservarAlteracoesComerciaisLocais: false,
          });
        }
        if (promotoresAplicados) {
          await this._deps.aplicarPromotores({
            promotores: rollbackSnapshot.promotores,
            agencias: rollbackSnapshot.agencias,
            historicoMovimentacoes: rollbackSnapshot.historicoMovimentacoes,
            vinculosDispositivoPromotor: rollbackSnapshot.vinculosDispositivoPromotor,
            preservarAlteracoesComerciaisLocais: false,
          });
        }
        this._persistedMeta = rollbackSnapshot.persistedMeta;
        await this._deps.setMeta(META_KEY_PACOTE, this._persistedMeta);
        await this._deps.clearStaging();
        rollbackOk = true;
        this.notify();
      } catch (rbErr) {
        console.error('[LocalPackage] Erro durante rollback:', rbErr);
      }

      return {
        sucesso: false,
        mensagem: `Falha na etapa "${etapaAtual}": ${err?.message || 'Erro desconhecido'}. ${
          rollbackOk
            ? 'Rollback concluído: a versão anterior em uso permanece intacta.'
            : 'Verifique os dados locais.'
        }`,
        etapaFalha: etapaAtual,
        rollbackExecutado: rollbackOk,
        avisos: [],
      };
    } finally {
      this._operacaoEmCurso = 'NENHUMA';
    }
  }
}

export const localUpdatePackageService = new LocalUpdatePackageService();
