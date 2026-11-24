import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Database,
  HardDrive,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import { authRoleService } from '../services/authRoleService';
import {
  centralFirestoreService,
  StatusNuvemHibrida,
  TestesObrigatoriosResultado,
} from '../services/centralFirestoreService';
import { cloudSyncService } from '../services/cloudSyncService';
import { comercialSyncService } from '../services/comercialSyncService';
import {
  formatarErroSyncPorServico,
  isFirestoreQuotaExceeded,
  OperationType,
  SyncServiceErrorDetail,
} from '../services/firebase';
import { isvService } from '../services/isvService';
import { nuvemSyncEngine } from '../services/nuvemSyncEngine';
import { productRepository } from '../services/productRepository';
import { spcoiSyncService } from '../services/spcoiSyncService';
import { MetadadosBase } from '../types';
import { NuvemV3PreparacaoModal } from './NuvemV3PreparacaoModal';

interface SincronizacaoCentralModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadados: MetadadosBase;
  onRefreshData: () => void;
}

interface ServicoResultadoUI {
  id: 'SPCOI007' | 'COMERCIAL' | 'VENCIMENTOS' | 'VINCULOS_EAN';
  nome: string;
  colecao: string;
  sucesso: boolean;
  mensagem: string;
  erroDetalhe?: SyncServiceErrorDetail;
}

export const SincronizacaoCentralModal: React.FC<SincronizacaoCentralModalProps> = ({
  isOpen,
  onClose,
  metadados,
  onRefreshData,
}) => {
  const [isNuvemV3Open, setIsNuvemV3Open] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncingService, setSyncingService] = useState<string | null>(null);
  const [resultadosServicos, setResultadosServicos] = useState<Record<string, ServicoResultadoUI>>({});
  const [syncBannerErro, setSyncBannerErro] = useState<string | null>(null);
  const [syncBannerOk, setSyncBannerOk] = useState<string | null>(null);

  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<TestesObrigatoriosResultado | null>(null);
  const [testErroMsg, setTestErroMsg] = useState<string | null>(null);
  const [expandedTest, setExpandedTest] = useState<string | null>(null);

  // Consulta manual de teste (somente leitura)
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<any>(null);

  const [statusNuvem, setStatusNuvem] = useState<StatusNuvemHibrida>(() => ({
    conectado: typeof navigator === 'undefined' ? true : navigator.onLine,
    projectId: 'gen-lang-client-0352860977',
    modoArquitetura: 'HIBRIDA_V1',
    gerenciaAdminAutenticada: authRoleService.isGerenciaAdminVerificadaNoServidor(),
    gerenciaEmail: authRoleService.getEmailServidorVerificado(),
    cotaBloqueada: isFirestoreQuotaExceeded(),
    produtosCount: productRepository.getProdutos().length,
    saeouCount: productRepository.getSaeou060Registros().length,
    spcoiCount: isvService.getFornecedores().length,
    vinculosCount: productRepository.getVinculos().length,
    vencimentosCount: productRepository.getVencimentos().length,
    promotoresCount: 0,
    agenciasCount: 0,
    versaoSpcoiRemota: spcoiSyncService.getVersaoAtivaRemota()?.versaoId || null,
    versaoSpcoiLocal: spcoiSyncService.getVersaoLocalId(),
    comercialUltimaAlteracao: comercialSyncService.getStatus().ultimaSincronizacaoIso,
    vinculosVersaoRemota: null,
    ultimaSincronizacao: metadados.ultima_atualizacao_base_rub || new Date().toLocaleString('pt-BR'),
    servicosErros: [],
  }));

  const carregarStatusReal = React.useCallback(async () => {
    try {
      const s = await centralFirestoreService.obterStatusNuvem({
        produtosCount: productRepository.getProdutos().length,
        saeouCount: productRepository.getSaeou060Registros().length,
        spcoiCount: isvService.getFornecedores().length,
        vinculosCount: productRepository.getVinculos().length,
        vencimentosCount: productRepository.getVencimentos().length,
      });
      setStatusNuvem(s);
    } catch (err) {
      console.warn('[SincronizacaoCentralModal] Erro ao consultar status real:', err);
    }
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      void carregarStatusReal();
    }
  }, [isOpen, carregarStatusReal]);

  if (!isOpen) return null;

  const isBusy = isSyncingAll || syncingService !== null;

  const registrarResultado = (res: ServicoResultadoUI) => {
    setResultadosServicos((prev) => ({ ...prev, [res.id]: res }));
  };

  const sincronizarSpcoi = async (): Promise<ServicoResultadoUI> => {
    const colecao = 'filiais/172/config/versao_ativa_spcoi';
    try {
      const res = await spcoiSyncService.verificarSincronizacaoComRemoto('172');
      if (!res.verificado) {
        const errMsg =
          spcoiSyncService.getStatus().erro ||
          `[SPCOI007 • Coleção: ${colecao}] Não foi possível verificar atualização remota.`;
        return {
          id: 'SPCOI007',
          nome: 'SPCOI007 Compactado',
          colecao,
          sucesso: false,
          mensagem: errMsg,
        };
      }
      return {
        id: 'SPCOI007',
        nome: 'SPCOI007 Compactado',
        colecao,
        sucesso: true,
        mensagem: res.baixouNovaVersao
          ? `Nova versão SPCOI007 baixada e aplicada no IndexedDB (${res.versaoId || 'atualizada'}).`
          : `SPCOI007 sincronizado na versão mais recente (${res.versaoId || spcoiSyncService.getVersaoLocalId() || 'OK'}).`,
      };
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'SPCOI007 Compactado', colecao, OperationType.GET);
      return {
        id: 'SPCOI007',
        nome: 'SPCOI007 Compactado',
        colecao,
        sucesso: false,
        mensagem: detail.mensagemUsuario,
        erroDetalhe: detail,
      };
    }
  };

  const publicarSpcoi = async () => {
    if (isBusy) return;
    setSyncingService('SPCOI007_PUB');
    setSyncBannerErro(null);
    setSyncBannerOk(null);
    const colecao = 'filiais/172/spcoi_versoes';
    try {
      const fornecedores = isvService.getFornecedores();
      const industrias = isvService.getIndustrias();
      const res = await spcoiSyncService.publicarSpcoiCentral(fornecedores, industrias, undefined, '172');
      const item: ServicoResultadoUI = {
        id: 'SPCOI007',
        nome: 'SPCOI007 Compactado',
        colecao,
        sucesso: res.sucesso,
        mensagem: res.mensagem,
      };
      registrarResultado(item);
      if (res.sucesso) {
        setSyncBannerOk(res.mensagem);
      } else {
        setSyncBannerErro(`[SPCOI007 • Coleção: ${colecao}] ${res.mensagem}`);
      }
      await carregarStatusReal();
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'SPCOI007 Compactado', colecao, OperationType.WRITE);
      registrarResultado({
        id: 'SPCOI007',
        nome: 'SPCOI007 Compactado',
        colecao,
        sucesso: false,
        mensagem: detail.mensagemUsuario,
        erroDetalhe: detail,
      });
      setSyncBannerErro(detail.mensagemUsuario);
    } finally {
      setSyncingService(null);
    }
  };

  const sincronizarComercial = async (): Promise<ServicoResultadoUI> => {
    const colecao = 'promotores / agencias / vinculos_promotor_industria / vinculosPromotorAgencia';
    try {
      const res = await comercialSyncService.sincronizarAgora();
      const statusCom = comercialSyncService.getStatus();
      const msg = res.sucesso
        ? res.mensagem
        : `[Comercial • Coleção: ${colecao}] ${res.mensagem || statusCom.ultimoErro || 'Falha na sincronização comercial.'}`;
      return {
        id: 'COMERCIAL',
        nome: 'Sincronização Comercial',
        colecao,
        sucesso: res.sucesso,
        mensagem: msg,
      };
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Sincronização Comercial', colecao, OperationType.WRITE);
      return {
        id: 'COMERCIAL',
        nome: 'Sincronização Comercial',
        colecao,
        sucesso: false,
        mensagem: detail.mensagemUsuario,
        erroDetalhe: detail,
      };
    }
  };

  const sincronizarVencimentos = async (): Promise<ServicoResultadoUI> => {
    const colecao = 'vencimentos / filiais/172/vencimentos';
    try {
      const filaRes = await nuvemSyncEngine.processarFila();
      const deltaRes = await nuvemSyncEngine.executarSincronizacaoIncremental('172');
      const locais = productRepository.getVencimentos();
      const pushRes =
        locais.length > 0 && !isFirestoreQuotaExceeded()
          ? await cloudSyncService.sincronizarVencimentosExistentesDetailed(locais)
          : { enviados: 0, ignorados: 0 };

      if (pushRes.erroDetalhe) {
        return {
          id: 'VENCIMENTOS',
          nome: 'Vencimentos',
          colecao: pushRes.erroDetalhe.colecao,
          sucesso: false,
          mensagem: pushRes.erroDetalhe.mensagemUsuario,
          erroDetalhe: pushRes.erroDetalhe,
        };
      }

      if (filaRes.erros > 0) {
        const erroOp = nuvemSyncEngine.getFila().find((o) => o.status === 'ERRO' && o.erroMensagem);
        return {
          id: 'VENCIMENTOS',
          nome: 'Vencimentos',
          colecao,
          sucesso: false,
          mensagem:
            erroOp?.erroMensagem ||
            `[Vencimentos • Coleção: ${colecao}] ${filaRes.erros} operação(ões) na fila retornaram erro.`,
        };
      }

      return {
        id: 'VENCIMENTOS',
        nome: 'Vencimentos',
        colecao,
        sucesso: true,
        mensagem: `Vencimentos sincronizados (${filaRes.processadas} fila, ${pushRes.enviados} verificados, ${deltaRes.atualizados} deltas recebidos).`,
      };
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Vencimentos', colecao, OperationType.WRITE);
      return {
        id: 'VENCIMENTOS',
        nome: 'Vencimentos',
        colecao,
        sucesso: false,
        mensagem: detail.mensagemUsuario,
        erroDetalhe: detail,
      };
    }
  };

  const sincronizarVinculosEan = async (modo: 'PULL' | 'PUSH' | 'AUTO' = 'AUTO'): Promise<ServicoResultadoUI> => {
    const colecao = 'vinculos_chunks / metadados/geral';
    try {
      if (modo === 'PUSH') {
        const vinculos = productRepository.getVinculos();
        const resPush = await cloudSyncService.pushVinculosToCloudDetailed(vinculos);
        if (!resPush.sucesso) {
          return {
            id: 'VINCULOS_EAN',
            nome: 'Vínculos EAN',
            colecao: resPush.erroDetalhe?.colecao || colecao,
            sucesso: false,
            mensagem:
              resPush.erroDetalhe?.mensagemUsuario ||
              `[Vínculos EAN • Coleção: ${colecao}] Não foi possível enviar vínculos EAN.`,
            erroDetalhe: resPush.erroDetalhe,
          };
        }
        return {
          id: 'VINCULOS_EAN',
          nome: 'Vínculos EAN',
          colecao,
          sucesso: true,
          mensagem: `${resPush.total} vínculos EAN publicados em ${colecao}.`,
        };
      }

      const resPull = await cloudSyncService.pullVinculosFromCloudDetailed();
      if (!resPull.sucesso) {
        return {
          id: 'VINCULOS_EAN',
          nome: 'Vínculos EAN',
          colecao: resPull.erroDetalhe?.colecao || 'vinculos_chunks',
          sucesso: false,
          mensagem:
            resPull.erroDetalhe?.mensagemUsuario ||
            `[Vínculos EAN • Coleção: ${colecao}] Falha ao ler vínculos EAN.`,
          erroDetalhe: resPull.erroDetalhe,
        };
      }
      return {
        id: 'VINCULOS_EAN',
        nome: 'Vínculos EAN',
        colecao,
        sucesso: true,
        mensagem: `${resPull.total} vínculos EAN verificados/atualizados no IndexedDB.`,
      };
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Vínculos EAN', colecao, OperationType.GET);
      return {
        id: 'VINCULOS_EAN',
        nome: 'Vínculos EAN',
        colecao,
        sucesso: false,
        mensagem: detail.mensagemUsuario,
        erroDetalhe: detail,
      };
    }
  };

  const handleExecutarServicoIndividual = async (
    id: 'SPCOI007' | 'COMERCIAL' | 'VENCIMENTOS' | 'VINCULOS_EAN',
    eanModo?: 'PULL' | 'PUSH'
  ) => {
    if (isBusy) return;
    setSyncingService(id);
    setSyncBannerErro(null);
    setSyncBannerOk(null);
    try {
      let res: ServicoResultadoUI;
      if (id === 'SPCOI007') res = await sincronizarSpcoi();
      else if (id === 'COMERCIAL') res = await sincronizarComercial();
      else if (id === 'VENCIMENTOS') res = await sincronizarVencimentos();
      else res = await sincronizarVinculosEan(eanModo || 'AUTO');

      registrarResultado(res);
      if (res.sucesso) {
        setSyncBannerOk(res.mensagem);
      } else {
        setSyncBannerErro(res.mensagem);
      }
      await carregarStatusReal();
      onRefreshData();
    } finally {
      setSyncingService(null);
    }
  };

  const handleSincronizarServicosAtivos = async () => {
    if (isBusy) return;
    setIsSyncingAll(true);
    setSyncBannerErro(null);
    setSyncBannerOk(null);

    try {
      const [resSpcoi, resComercial, resVenc, resEan] = await Promise.all([
        sincronizarSpcoi(),
        sincronizarComercial(),
        sincronizarVencimentos(),
        sincronizarVinculosEan('AUTO'),
      ]);

      const lista = [resSpcoi, resComercial, resVenc, resEan];
      lista.forEach(registrarResultado);

      const falhas = lista.filter((r) => !r.sucesso);
      if (falhas.length > 0) {
        setSyncBannerErro(falhas.map((f) => f.mensagem).join(' | '));
      } else {
        setSyncBannerOk(
          'Serviços ativos sincronizados com sucesso (SPCOI007 compactado, Comercial, Vencimentos e Vínculos EAN). BASE RUB e SAEOU060 preservados localmente via .zip.'
        );
      }

      await carregarStatusReal();
      onRefreshData();
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleExecutarTestes = async () => {
    if (isRunningTests) return;
    setIsRunningTests(true);
    setTestErroMsg(null);
    try {
      const res = await centralFirestoreService.executarTestesObrigatorios();
      setTestResults(res);
      if (res.itens.length > 0) {
        setExpandedTest(res.itens[0].id);
      }
    } catch (err: any) {
      console.error('Erro ao executar testes Híbridos V1.0:', err);
      setTestErroMsg(err?.message || String(err));
    } finally {
      setIsRunningTests(false);
    }
  };

  const handleTestSearch = async () => {
    const termo = searchQuery.trim();
    if (!termo) return;
    setIsSearching(true);
    setSearchResult(null);
    try {
      // Consulta local prioritária (BASE RUB e SAEOU060 estão exclusivamente no IndexedDB)
      const localProd = productRepository.findByCodeOrEan(termo);
      if (localProd) {
        setSearchResult({
          tipo: 'LOCAL_INDEXEDDB',
          produto: {
            codigoCompleto: localProd.codigo_original || localProd.codigo_exibicao || `${localProd.codigo_interno}-${localProd.digito}`,
            codigoInterno: localProd.codigo_interno,
            digito: localProd.digito,
            descricao: localProd.descricao,
            setor: localProd.setor_fisico || localProd.setor_balanco || 'LOJA',
            emb1: localProd.estoque_emb1 || 0,
            emb9: localProd.estoque_emb9 || 0,
            fator_embalagem: localProd.fator_embalagem || 1,
          },
        });
        return;
      }

      if (/^\d{8,14}$/.test(termo)) {
        const eanRes = await centralFirestoreService.consultarProdutoPorEan(termo, '172');
        setSearchResult({ tipo: 'EAN', ...eanRes });
      } else {
        const codRes = await centralFirestoreService.consultarProdutoPorCodigo(termo, undefined, '172');
        setSearchResult({ tipo: 'CODIGO_INTERNO', codigo: termo, produto: codRes });
      }
    } catch (err: any) {
      setSearchResult({ erro: err?.message || String(err) });
    } finally {
      setIsSearching(false);
    }
  };

  const comercialState = comercialSyncService.getStatus();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div
        id="modal-sincronizacao-central"
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-blue-800 to-indigo-900 text-white flex items-center justify-between shrink-0 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <Cloud className="w-5 h-5 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black uppercase tracking-tight">
                  Base Central — Arquitetura Híbrida V1.0
                </h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                    statusNuvem.cotaBloqueada
                      ? 'bg-amber-400 text-slate-950'
                      : statusNuvem.conectado
                      ? 'bg-emerald-400 text-slate-950'
                      : 'bg-slate-300 text-slate-900'
                  }`}
                >
                  {statusNuvem.cotaBloqueada ? 'Modo Local (Cota Spark)' : statusNuvem.conectado ? 'Online' : 'Offline'}
                </span>
              </div>
              <p className="text-xs text-blue-100 font-medium">
                Filial 172 — Cascavel • Sincronização seletiva Spark (SPCOI007, Comercial, Vencimentos e Vínculos EAN)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-slate-800 text-sm">
          {/* Status Real e Autenticação da Gerência */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-100 border border-slate-300/80 rounded-xl text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  statusNuvem.cotaBloqueada
                    ? 'bg-amber-500'
                    : statusNuvem.conectado
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-slate-400'
                }`}
              />
              <span className="font-black text-slate-900 uppercase">
                {statusNuvem.gerenciaAdminAutenticada
                  ? `GERENCIA_ADMIN (${statusNuvem.gerenciaEmail || 'Verificada'})`
                  : 'Modo Operacional (Leitura + Vencimentos)'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-slate-600 font-mono text-[11px]">
              <span>Última verificação: <strong className="text-slate-800">{statusNuvem.ultimaSincronizacao}</strong></span>
              <span className="hidden sm:inline">•</span>
              <span>Filial: <strong className="text-slate-800">172</strong></span>
            </div>
          </div>

          {/* Diagnósticos de leitura inicial por coleção, se houver */}
          {statusNuvem.servicosErros.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-1.5 text-xs text-rose-900">
              <p className="font-black uppercase flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                Falha de leitura detectada ao consultar coleções do Firestore:
              </p>
              {statusNuvem.servicosErros.map((err, idx) => (
                <p key={idx} className="font-mono text-[11px] bg-white/80 p-2 rounded border border-rose-200">
                  {err.mensagemUsuario}
                </p>
              ))}
            </div>
          )}

          {/* Banner Diagnóstico Nuvem V3 */}
          <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white rounded-xl p-3.5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-blue-400/30">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-5 h-5 text-blue-300 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-white tracking-wide flex items-center gap-2">
                  ARQUITETURA HÍBRIDA V1.0 — SEGURANÇA & BACKUP
                  <span className="text-[9px] bg-emerald-400 text-slate-950 font-black px-1.5 py-0.5 rounded-full uppercase">
                    Ativa
                  </span>
                </p>
                <p className="text-[11px] text-blue-200 mt-0.5">
                  BASE RUB e SAEOU060 nunca são enviados ao Firestore em lotes de 300; operam 100% no IndexedDB via arquivo .zip.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsNuvemV3Open(true)}
              className="px-3.5 py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-white font-bold text-xs shrink-0 transition-colors cursor-pointer shadow-xs"
            >
              Diagnóstico V3
            </button>
          </div>

          {/* Bloco 1: Bases Exclusivas Locais (.zip / IndexedDB) */}
          <div className="space-y-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-amber-600" />
              Bases Exclusivas Locais (.zip / IndexedDB — Sem Envio ao Firestore)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-black text-slate-900 text-xs">BASE RUB (SMGOI013)</span>
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-200 text-amber-950">
                    Local (.zip)
                  </span>
                </div>
                <p className="text-sm font-black text-slate-900">
                  {statusNuvem.produtosCount.toLocaleString('pt-BR')} produtos locais
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Atualização exclusivamente manual por pacote .zip. Envio legado de produtos ao Firestore desativado.
                </p>
              </div>

              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-black text-slate-900 text-xs">SAEOU060 (Preventivo)</span>
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-amber-200 text-amber-950">
                    Local (.zip)
                  </span>
                </div>
                <p className="text-sm font-black text-slate-900">
                  {statusNuvem.saeouCount.toLocaleString('pt-BR')} registros locais
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Mantido exclusivamente no IndexedDB local com atualização manual via .zip.
                </p>
              </div>
            </div>
          </div>

          {/* Bloco 2: Serviços Ativos na Nuvem (Firebase Spark) */}
          <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-blue-950 uppercase flex items-center gap-2">
                  <RefreshCw className={`w-4 h-4 text-blue-700 ${isSyncingAll ? 'animate-spin' : ''}`} />
                  Serviços Ativos no Firebase Firestore
                </h4>
                <p className="text-xs text-blue-800 mt-0.5 font-medium">
                  Sincroniza SPCOI007 compactado, Comercial, Vencimentos e Vínculos EAN respeitando as regras de segurança.
                </p>
              </div>

              <button
                id="btn-sincronizar-servicos-ativos"
                onClick={handleSincronizarServicosAtivos}
                disabled={isBusy}
                className="px-4 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all shrink-0 cursor-pointer"
              >
                {isSyncingAll ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Sincronizando...</span>
                  </>
                ) : (
                  <>
                    <Cloud className="w-3.5 h-3.5" />
                    <span>Sincronizar Serviços Ativos</span>
                  </>
                )}
              </button>
            </div>

            {syncBannerOk && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 font-medium flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{syncBannerOk}</span>
              </div>
            )}

            {syncBannerErro && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-900 font-medium flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="break-words">{syncBannerErro}</span>
              </div>
            )}

            {/* Grid dos 4 Serviços Ativos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* 1. SPCOI007 */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                      SPCOI007 Compactado
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">fflate + SHA-256</span>
                  </div>
                  <p className="text-[11px] font-mono text-slate-500 mt-1">
                    filiais/172/spcoi_versoes
                  </p>
                  <p className="text-xs font-bold text-slate-800 mt-1">
                    {statusNuvem.spcoiCount.toLocaleString('pt-BR')} fornecedores locais
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    Versão remota: {statusNuvem.versaoSpcoiRemota || 'não verificada'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => handleExecutarServicoIndividual('SPCOI007')}
                    disabled={isBusy}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                  >
                    {syncingService === 'SPCOI007' ? 'Verificando...' : 'Sincronizar SPCOI007'}
                  </button>
                  {statusNuvem.gerenciaAdminAutenticada && statusNuvem.spcoiCount > 0 && (
                    <button
                      onClick={publicarSpcoi}
                      disabled={isBusy}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                    >
                      {syncingService === 'SPCOI007_PUB' ? 'Publicando...' : 'Publicar Versão'}
                    </button>
                  )}
                </div>
                {resultadosServicos.SPCOI007 && (
                  <p
                    className={`text-[11px] p-2 rounded border ${
                      resultadosServicos.SPCOI007.sucesso
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    {resultadosServicos.SPCOI007.mensagem}
                  </p>
                )}
              </div>

              {/* 2. Comercial */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-600" />
                      Comercial (Promotores/Agências)
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800">
                      {comercialState.estado}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-slate-500 mt-1 truncate">
                    promotores • agencias • vinculos
                  </p>
                  <p className="text-xs font-bold text-slate-800 mt-1">
                    {statusNuvem.promotoresCount} promotores • {statusNuvem.agenciasCount} agências
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Pendentes fila: {comercialState.pendentesCount}
                    {!statusNuvem.gerenciaAdminAutenticada ? ' • Escrita exige Gerência' : ''}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => handleExecutarServicoIndividual('COMERCIAL')}
                    disabled={isBusy}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                  >
                    {syncingService === 'COMERCIAL' ? 'Sincronizando...' : 'Sincronizar Comercial'}
                  </button>
                </div>
                {resultadosServicos.COMERCIAL && (
                  <p
                    className={`text-[11px] p-2 rounded border ${
                      resultadosServicos.COMERCIAL.sucesso
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    {resultadosServicos.COMERCIAL.mensagem}
                  </p>
                )}
              </div>

              {/* 3. Vencimentos */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-emerald-600" />
                      Vencimentos (Lotes)
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">Tempo Real</span>
                  </div>
                  <p className="text-[11px] font-mono text-slate-500 mt-1">
                    vencimentos • filiais/172/vencimentos
                  </p>
                  <p className="text-xs font-bold text-slate-800 mt-1">
                    {statusNuvem.vencimentosCount.toLocaleString('pt-BR')} lotes locais
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Pendentes fila: {nuvemSyncEngine.getContadores().pendentes}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => handleExecutarServicoIndividual('VENCIMENTOS')}
                    disabled={isBusy}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                  >
                    {syncingService === 'VENCIMENTOS' ? 'Sincronizando...' : 'Sincronizar Vencimentos'}
                  </button>
                </div>
                {resultadosServicos.VENCIMENTOS && (
                  <p
                    className={`text-[11px] p-2 rounded border ${
                      resultadosServicos.VENCIMENTOS.sucesso
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    {resultadosServicos.VENCIMENTOS.mensagem}
                  </p>
                )}
              </div>

              {/* 4. Vínculos EAN */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-blue-600" />
                      Vínculos EAN
                    </span>
                    {!statusNuvem.gerenciaAdminAutenticada && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        <Lock className="w-2.5 h-2.5" /> Escrita Admin
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-slate-500 mt-1">
                    vinculos_chunks • metadados/geral
                  </p>
                  <p className="text-xs font-bold text-slate-800 mt-1">
                    {statusNuvem.vinculosCount.toLocaleString('pt-BR')} vínculos locais
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Versão nuvem: {statusNuvem.vinculosVersaoRemota || 'não verificada'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => handleExecutarServicoIndividual('VINCULOS_EAN', 'PULL')}
                    disabled={isBusy}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                  >
                    {syncingService === 'VINCULOS_EAN' ? 'Sincronizando...' : 'Puxar EANs'}
                  </button>
                  {statusNuvem.vinculosCount > 0 && (
                    <button
                      onClick={() => handleExecutarServicoIndividual('VINCULOS_EAN', 'PUSH')}
                      disabled={isBusy}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-900 text-[11px] font-bold cursor-pointer"
                    >
                      Enviar EANs
                    </button>
                  )}
                </div>
                {resultadosServicos.VINCULOS_EAN && (
                  <p
                    className={`text-[11px] p-2 rounded border ${
                      resultadosServicos.VINCULOS_EAN.sucesso
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    {resultadosServicos.VINCULOS_EAN.mensagem}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Section: Validação Técnica Híbrida V1.0 (Somente Leitura) */}
          <div className="border border-slate-200 bg-white rounded-xl p-4 space-y-3 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-slate-900 uppercase flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Validação Técnica: 5 Testes da Arquitetura Híbrida V1.0
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Executa verificações somente leitura no Firestore e no IndexedDB (0 gravações em massa).
                </p>
              </div>

              <button
                id="btn-executar-testes-obrigatorios"
                onClick={handleExecutarTestes}
                disabled={isRunningTests}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all shrink-0 cursor-pointer"
              >
                {isRunningTests ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Validando...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Validar Arquitetura Híbrida</span>
                  </>
                )}
              </button>
            </div>

            {testErroMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-bold">
                {testErroMsg}
              </div>
            )}

            {testResults && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="text-xs font-black uppercase text-slate-700">
                    Resultado ({testResults.itens.filter((i) => i.sucesso).length}/{testResults.itens.length} aprovados)
                  </span>
                  <span
                    className={`text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                      testResults.sucessoGeral
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-100 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {testResults.sucessoGeral ? '✓ CONFORMIDADE CONFIRMADA' : '⚠ ATENÇÃO EM ITENS'}
                  </span>
                </div>

                <div className="space-y-2">
                  {testResults.itens.map((item) => {
                    const isExpanded = expandedTest === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`border rounded-xl transition-all overflow-hidden ${
                          item.sucesso ? 'border-emerald-200 bg-emerald-50/30' : 'border-rose-200 bg-rose-50/30'
                        }`}
                      >
                        <button
                          onClick={() => setExpandedTest(isExpanded ? null : item.id)}
                          className="w-full p-3 flex items-center justify-between text-left gap-3 hover:bg-black/2 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {item.sucesso ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-black text-slate-900 uppercase truncate">
                                {item.titulo}
                              </p>
                              <p className="text-[11px] text-slate-600 break-words mt-0.5">
                                {item.detalhes}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {item.tempoMs}ms
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {isExpanded && item.dadosReais && (
                          <div className="p-3 bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto border-t border-slate-200/80">
                            <div className="text-[10px] font-sans font-bold text-slate-400 uppercase mb-1">
                              Dados Verificados:
                            </div>
                            <pre>{JSON.stringify(item.dadosReais, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Section: Consulta Rápida (IndexedDB Local + Firestore Legado Somente Leitura) */}
          <div className="border border-slate-200 bg-slate-50 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              Consulta Rápida de Produto / EAN (IndexedDB Local → Fallback Somente Leitura)
            </h4>

            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTestSearch()}
                placeholder="Ex: 76916 ou 7896216100909"
                className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
              />
              <button
                onClick={handleTestSearch}
                disabled={isSearching}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {isSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Consultar</span>
              </button>
            </div>

            {searchResult && (
              <div className="p-3.5 bg-white border border-slate-200 rounded-xl text-xs space-y-2">
                {searchResult.erro ? (
                  <p className="text-rose-600 font-bold">Erro: {searchResult.erro}</p>
                ) : searchResult.produto ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-black text-xs uppercase">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>
                        {searchResult.tipo === 'LOCAL_INDEXEDDB'
                          ? 'Localizado no IndexedDB Local (BASE RUB .zip)'
                          : 'Localizado no Firestore (Consulta Somente Leitura)'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono text-[11px]">
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Código Completo</p>
                        <p className="font-black text-slate-900 text-sm">
                          {searchResult.produto.codigoCompleto || `${searchResult.produto.codigoInterno}-${searchResult.produto.digito}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Descrição</p>
                        <p className="font-black text-slate-900">{searchResult.produto.descricao}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Estoque EMB1 / EMB9</p>
                        <p className="font-bold text-slate-800">
                          {searchResult.produto.emb1} CX • {searchResult.produto.emb9} UN
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Setor</p>
                        <p className="font-bold text-slate-800">{searchResult.produto.setor || 'LOJA'}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500">Nenhum registro encontrado para esse parâmetro.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span className="font-mono">Filial 172 • Cascavel • Arquitetura Híbrida V1.0</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-black uppercase text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Modal Nuvem V3 Preparação e Diagnóstico */}
      <NuvemV3PreparacaoModal
        isOpen={isNuvemV3Open}
        onClose={() => setIsNuvemV3Open(false)}
      />
    </div>
  );
};
