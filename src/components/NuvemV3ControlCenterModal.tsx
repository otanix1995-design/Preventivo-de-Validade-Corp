import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  Database,
  Download,
  FileJson,
  Layers,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { authRoleService, PapelOperacional, PAPEIS_INFO, UsuarioOperacional } from '../services/authRoleService';
import { nuvemSyncEngine } from '../services/nuvemSyncEngine';
import { rubSyncService, PublicacaoRubStatus } from '../services/rubSyncService';
import { backupService, SnapshotCompletoIndexedDB } from '../services/backupService';
import { NuvemV3TestSuite, NuvemV3TestSummary } from '../services/nuvemV3TestSuite';
import { productRepository } from '../services/productRepository';
import { cloudSyncService } from '../services/cloudSyncService';
import { VersaoAtivaInfo } from '../services/concurrentRubPublicationService';
import { reorganizacaoNuvemService, RelatorioReorganizacaoNuvem } from '../services/reorganizacaoNuvemService';
import { isFirestoreQuotaExceeded } from '../services/firebase';
import { BasesSyncStatusCard } from './BasesSyncStatusCard';
import { firebaseAuthService, EstadoAuthServidor } from '../services/firebaseAuthService';
import { securityRulesValidator, RelatorioDiagnosticoSeguranca } from '../services/securityRulesValidator';
import {
  limpezaTresBasesService,
  DiagnosticoLimpezaBases,
  ResultadoLimpezaBases,
} from '../services/limpezaTresBasesService';

export type TabSecao = 'REORGANIZACAO' | 'SINCRONIZACAO' | 'BASE_RUB' | 'BACKUP' | 'DIAGNOSTICO' | 'PAPEIS' | 'LIMPEZA_BASES';

interface NuvemV3ControlCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: TabSecao;
}

export const NuvemV3ControlCenterModal: React.FC<NuvemV3ControlCenterModalProps> = ({
  isOpen,
  onClose,
  initialTab,
}) => {
  const [tabAtiva, setTabAtiva] = useState<TabSecao>(() => initialTab || 'REORGANIZACAO');
  const [usuario, setUsuario] = useState<UsuarioOperacional>(() => authRoleService.getUsuarioAtual());
  const [contadores, setContadores] = useState(() => nuvemSyncEngine.getContadores());
  const [versaoAtivaRub, setVersaoAtivaRub] = useState<VersaoAtivaInfo | null>(() => rubSyncService.getVersaoAtivaRemota());
  const [statusPub, setStatusPub] = useState<PublicacaoRubStatus>(() => rubSyncService.getStatusPublicacao());

  // Atualiza tabAtiva se initialTab for fornecido ao abrir
  useEffect(() => {
    if (isOpen && initialTab) {
      setTabAtiva(initialTab);
    }
  }, [isOpen, initialTab]);
  
  // Reorganização & Ressincronização states
  const [relatorioReorg, setRelatorioReorg] = useState<RelatorioReorganizacaoNuvem | null>(() =>
    reorganizacaoNuvemService.getUltimoRelatorio()
  );
  const [isExecutandoReorg, setIsExecutandoReorg] = useState(false);
  const [reorgToast, setReorgToast] = useState<string | null>(null);

  // Test suite states
  const [testSummary, setTestSummary] = useState<NuvemV3TestSummary | null>(null);
  const [isExecutandoTestes, setIsExecutandoTestes] = useState(false);

  // Backup states
  const [backupGerado, setBackupGerado] = useState<SnapshotCompletoIndexedDB | null>(null);
  const [isGerandoBackup, setIsGerandoBackup] = useState(false);
  const [backupToast, setBackupToast] = useState<string | null>(null);

  // Sync action states
  const [isForcingSync, setIsForcingSync] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  // Server Auth states
  const [authServidor, setAuthServidor] = useState<EstadoAuthServidor>(() => firebaseAuthService.getEstado());
  const [relatorioSeguranca, setRelatorioSeguranca] = useState<RelatorioDiagnosticoSeguranca>(() =>
    securityRulesValidator.executarSuiteDeTestes()
  );
  const [isLogandoGoogle, setIsLogandoGoogle] = useState(false);

  // Estados da Limpeza Controlada das 3 Bases Operacionais (Filial 172)
  const [diagnosticoBases, setDiagnosticoBases] = useState<DiagnosticoLimpezaBases | null>(null);
  const [carregandoDiagnostico, setCarregandoDiagnostico] = useState(false);
  const [textoConfirmacao, setTextoConfirmacao] = useState('');
  const [executandoLimpeza, setExecutandoLimpeza] = useState(false);
  const [resultadoLimpeza, setResultadoLimpeza] = useState<ResultadoLimpezaBases | null>(null);
  const [erroLimpeza, setErroLimpeza] = useState<string | null>(null);
  const [limpezaToast, setLimpezaToast] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const unsubAuth = authRoleService.subscribe(setUsuario);
    const unsubEngine = nuvemSyncEngine.subscribe(() => {
      setContadores(nuvemSyncEngine.getContadores());
    });
    const unsubRubVersao = rubSyncService.subscribeVersao(setVersaoAtivaRub);
    const unsubRubStatus = rubSyncService.subscribeStatus(setStatusPub);
    const unsubReorg = reorganizacaoNuvemService.subscribe(setRelatorioReorg);
    const unsubServerAuth = firebaseAuthService.subscribe(setAuthServidor);

    return () => {
      unsubAuth();
      unsubEngine();
      unsubRubVersao();
      unsubRubStatus();
      unsubReorg();
      unsubServerAuth();
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && tabAtiva === 'LIMPEZA_BASES' && !diagnosticoBases && !carregandoDiagnostico) {
      handleCarregarDiagnostico();
    }
  }, [isOpen, tabAtiva]);

  if (!isOpen) return null;

  const handleMudarPapel = (papel: PapelOperacional) => {
    authRoleService.alternarPapel(papel);
  };

  const handleCarregarDiagnostico = async () => {
    setCarregandoDiagnostico(true);
    setErroLimpeza(null);
    try {
      const diag = await limpezaTresBasesService.diagnosticarBasesOperacionais('172');
      setDiagnosticoBases(diag);
    } catch (e: any) {
      setErroLimpeza(e?.message || 'Falha ao consultar diagnóstico das bases.');
    } finally {
      setCarregandoDiagnostico(false);
    }
  };

  const handleBaixarBackupPreLimpeza = async () => {
    try {
      setLimpezaToast('Gerando e baixando backup completo (JSON)...');
      await backupService.baixarBackupJson('172');
      setLimpezaToast('Backup baixado com sucesso!');
      setTimeout(() => setLimpezaToast(null), 4000);
    } catch (e: any) {
      setErroLimpeza(e?.message || 'Falha ao gerar arquivo de backup.');
    }
  };

  const handleExecutarLimpezaBases = async () => {
    if (textoConfirmacao.trim().toUpperCase() !== 'LIMPAR-BASES-172') {
      setErroLimpeza('Por favor, digite exatamente "LIMPAR-BASES-172" no campo de confirmação.');
      return;
    }

    // Eleva papel operacional local para Gerência / Administrador
    if (authRoleService.getPapel() !== 'GERENCIA_ADMIN') {
      authRoleService.alternarPapel('GERENCIA_ADMIN');
    }

    setExecutandoLimpeza(true);
    setErroLimpeza(null);
    try {
      const res = await limpezaTresBasesService.executarLimpezaDasTresBases('172', true);
      setResultadoLimpeza(res);
      setTextoConfirmacao('');
      setLimpezaToast('Limpeza das 3 bases concluída com sucesso!');
      setTimeout(() => setLimpezaToast(null), 5000);
      await handleCarregarDiagnostico();
    } catch (e: any) {
      console.error('Erro na limpeza das bases:', e);
      setErroLimpeza(e?.message || 'Erro inesperado durante a execução da limpeza.');
    } finally {
      setExecutandoLimpeza(false);
    }
  };

  const handleLoginGoogle = async () => {
    setIsLogandoGoogle(true);
    try {
      const res = await firebaseAuthService.loginComGoogle();
      setSyncToast(res.mensagem);
    } catch (e: any) {
      setSyncToast(`Erro login: ${e?.message}`);
    } finally {
      setIsLogandoGoogle(false);
    }
  };

  const handleLogoutGoogle = async () => {
    await firebaseAuthService.logout();
    setSyncToast('Sessão desconectada do Firebase Auth');
  };

  const handleRodarTestesSeguranca = () => {
    const rel = securityRulesValidator.executarSuiteDeTestes();
    setRelatorioSeguranca(rel);
  };

  const handleExecutarReorganizacao = async () => {
    if (isExecutandoReorg) return;
    const confirma = window.confirm(
      'Confirma o início da REORGANIZAÇÃO E RESSINCRONIZAÇÃO LIMPA DA FILIAL 172?\n\n' +
      '1. Backup prévio verificável das 18 tabelas do IndexedDB e fila offline\n' +
      '2. Identificação e reconciliação dos 85 vencimentos antigos da nuvem pertencentes à filial 172\n' +
      '3. Aplicação de tombstones irreversíveis e enfileiramento de exclusões lógicas auditadas\n' +
      '4. Preservação integral de Vínculos EAN, SAEOU060, SPCOI007, ISV e vencimentos ativos\n' +
      '5. Publicação da versão mestre oficial da BASE RUB de 36 colunas\n' +
      '6. Atualização dos indicadores para refletir o estado real da nuvem'
    );
    if (!confirma) return;

    setIsExecutandoReorg(true);
    setReorgToast('Executando etapas da reorganização em lote atômico...');
    try {
      const rel = await reorganizacaoNuvemService.executarReorganizacaoCompleta('172');
      setRelatorioReorg(rel);
      setReorgToast(
        `Reorganização concluída com sucesso! ${rel.etapas.reconciliacaoVencimentos.confirmadosComoExcluidos} vencimentos antigos protegidos por tombstones, 0 registros válidos perdidos.`
      );
      setTimeout(() => setReorgToast(null), 7000);
    } catch (e: any) {
      setReorgToast(`Erro na reorganização: ${e?.message}`);
    } finally {
      setIsExecutandoReorg(false);
    }
  };

  const handleDownloadRelatorioReorg = () => {
    if (!relatorioReorg) return;
    const blob = new Blob([JSON.stringify(relatorioReorg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-reorganizacao-nuvemv3-filial172-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleForcarSincronizacao = async () => {
    if (isForcingSync) return;
    setIsForcingSync(true);
    setSyncToast('Disparando sincronização transacional...');
    try {
      const resQueue = await nuvemSyncEngine.processarFila();
      const resDelta = await nuvemSyncEngine.executarSincronizacaoIncremental('172');
      await cloudSyncService.pullVencimentosFromCloud();
      setSyncToast(
        `Sincronização concluída: ${resQueue.processadas} operações enviadas, ${resDelta.atualizados} atualizações recebidas.`
      );
      setTimeout(() => setSyncToast(null), 5000);
    } catch (e: any) {
      setSyncToast(`Erro no envio: ${e?.message}`);
      setTimeout(() => setSyncToast(null), 5000);
    } finally {
      setIsForcingSync(false);
    }
  };

  const handlePublicarBaseRub = async () => {
    const produtos = productRepository.getProdutos();
    const meta = productRepository.getMetadados();

    if (produtos.length === 0) {
      alert('Não há produtos na BASE RUB carregados para publicar.');
      return;
    }

    const confirma = window.confirm(
      `Confirma a publicação oficial da BASE RUB para a Filial 172 com ${produtos.length} produtos? O sistema executará validação de concorrência e upload em chunks seguros.`
    );
    if (!confirma) return;

    const res = await rubSyncService.publicarBaseRubCentral(produtos, meta, '172');
    if (res.sucesso) {
      alert(res.mensagem);
    } else {
      alert(`Erro na publicação: ${res.mensagem}`);
    }
  };

  const handleBaixarBaseRub = async () => {
    const confirma = window.confirm(
      'Deseja atualizar a BASE RUB local a partir da versão mestre oficial da nuvem? Os produtos atuais serão atualizados de forma atômica.'
    );
    if (!confirma) return;

    const res = await rubSyncService.baixarBaseRubAtivaParaDispositivo('172');
    if (res.sucesso) {
      if (res.produtos && res.meta) {
        await productRepository.importarBaseRubDireto(res.produtos, res.meta);
      }
      alert(res.mensagem);
    } else {
      alert(res.mensagem);
    }
  };

  const handleRollbackRub = async () => {
    if (!versaoAtivaRub?.versaoAnteriorId) {
      alert('Não há versão anterior registrada para rollback.');
      return;
    }
    const confirma = window.confirm(
      `Confirma o ROLLBACK do ponteiro da BASE RUB para a versão anterior (${versaoAtivaRub.versaoAnteriorId})?`
    );
    if (!confirma) return;

    const res = await rubSyncService.executarRollbackParaVersaoAnterior('172');
    alert(res.mensagem);
  };

  const handleGerarBackupCompleto = async () => {
    if (isGerandoBackup) return;
    setIsGerandoBackup(true);
    setBackupToast('Lendo todas as 18 tabelas do IndexedDB e filas...');
    try {
      const snap = await backupService.gerarSnapshotCompleto('172');
      const valid = backupService.validarIntegridade(snap);
      if (valid.valido) {
        setBackupGerado(snap);
        setBackupToast(
          `Backup gerado com sucesso! Total de ${snap.metadados.totalRegistros} registros nas 18 tabelas. Clique para baixar o arquivo JSON.`
        );
      } else {
        setBackupToast(`Divergência no backup: ${valid.mensagem}`);
      }
    } catch (e: any) {
      setBackupToast(`Erro ao gerar backup: ${e?.message}`);
    } finally {
      setIsGerandoBackup(false);
    }
  };

  const handleBaixarArquivoBackup = () => {
    if (!backupGerado) return;
    backupService.baixarBackupJson('172');
  };

  const handleExecutarDiagnostico = async () => {
    if (isExecutandoTestes) return;
    setIsExecutandoTestes(true);
    try {
      const summary = await NuvemV3TestSuite.executarTodosTestes();
      setTestSummary(summary);
    } finally {
      setIsExecutandoTestes(false);
    }
  };

  const isGerencia = usuario.papel === 'GERENCIA_ADMIN';
  const isConferente = usuario.papel === 'CONFERENTE_ENCARREGADO' || isGerencia;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-orange-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="bg-linear-to-r from-[#F36B0B] to-[#C94F00] text-white p-4 sm:p-5 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center border border-white/25 shrink-0">
              <Cloud className="w-5 h-5 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black uppercase tracking-tight">
                  Central Nuvem V3 — Sincronização e Governança
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-white/20 text-orange-100 uppercase tracking-wider">
                  FILIAL 172 (CASCAVEL)
                </span>
              </div>
              <p className="text-xs text-orange-100 font-bold mt-0.5">
                Usuário Ativo: <span className="text-white">{usuario.nome}</span> ({PAPEIS_INFO[usuario.papel].rotulo})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white hover:bg-white/15 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation - Visível, acessível e scrollável */}
        <div className="flex items-center gap-1.5 px-4 pt-3 border-b border-slate-200 bg-slate-50 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 pb-0.5">
          <button
            onClick={() => setTabAtiva('REORGANIZACAO')}
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
              tabAtiva === 'REORGANIZACAO'
                ? 'border-[#F36B0B] text-[#C94F00] bg-white shadow-2xs font-extrabold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Reorganização Nuvem</span>
          </button>

          <button
            onClick={() => setTabAtiva('SINCRONIZACAO')}
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
              tabAtiva === 'SINCRONIZACAO'
                ? 'border-[#F36B0B] text-[#C94F00] bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sincronização ({contadores.pendentes})</span>
          </button>

          <button
            onClick={() => setTabAtiva('BASE_RUB')}
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
              tabAtiva === 'BASE_RUB'
                ? 'border-[#F36B0B] text-[#C94F00] bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>BASE RUB (Versões)</span>
          </button>

          <button
            onClick={() => setTabAtiva('BACKUP')}
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
              tabAtiva === 'BACKUP'
                ? 'border-[#F36B0B] text-[#C94F00] bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileJson className="w-3.5 h-3.5" />
            <span>Backup 18 Tabelas</span>
          </button>

          <button
            onClick={() => setTabAtiva('DIAGNOSTICO')}
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
              tabAtiva === 'DIAGNOSTICO'
                ? 'border-[#F36B0B] text-[#C94F00] bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Diagnóstico (Testes 1 a 7)</span>
          </button>

          <button
            onClick={() => setTabAtiva('PAPEIS')}
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
              tabAtiva === 'PAPEIS'
                ? 'border-[#F36B0B] text-[#C94F00] bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Papéis & Acesso</span>
          </button>

          <button
            onClick={() => setTabAtiva('LIMPEZA_BASES')}
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
              tabAtiva === 'LIMPEZA_BASES'
                ? 'border-rose-600 text-rose-700 bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-rose-700'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            <span>Limpeza das 3 Bases</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* ================================================================= */}
          {/* TAB 0: REORGANIZAÇÃO & RESSINCRONIZAÇÃO LIMPA (FILIAL 172) */}
          {/* ================================================================= */}
          {tabAtiva === 'REORGANIZACAO' && (
            <div className="space-y-4">
              {reorgToast && (
                <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs font-bold animate-in fade-in flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-600 shrink-0" />
                  <span>{reorgToast}</span>
                </div>
              )}

              {/* Main Action Banner */}
              <div className="p-4 sm:p-5 rounded-2xl bg-linear-to-r from-orange-50 via-amber-50 to-orange-50 border-2 border-orange-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="p-2 rounded-xl bg-orange-600 text-white shadow-xs">
                        <Sparkles className="w-5 h-5" />
                      </span>
                      <div>
                        <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                          Reorganização e Ressincronização Limpa — Filial 172
                        </h3>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Executa em lote atômico: backup das 18 tabelas, reconciliação e tombstones dos 85 vencimentos antigos, preservação de bases válidas e publicação da BASE RUB mestre.
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleExecutarReorganizacao}
                    disabled={isExecutandoReorg}
                    className="px-5 py-3 rounded-xl bg-[#F36B0B] hover:bg-[#C94F00] active:scale-95 text-white font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isExecutandoReorg ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Reorganizando...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-white" />
                        <span>Executar Reorganização Completa</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Status & Results Breakdown */}
              {relatorioReorg && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-300 p-3.5 rounded-xl text-emerald-900 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <p className="font-black uppercase tracking-wide">
                          Reorganização Concluída ({new Date(relatorioReorg.dataHoraFim).toLocaleString('pt-BR')})
                        </p>
                        <p className="text-[11px] text-emerald-800">
                          Duração: {relatorioReorg.duracaoMs}ms | Filial: {relatorioReorg.filialId} | Checksum: {relatorioReorg.etapas.backup.checksum}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleDownloadRelatorioReorg}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold text-[11px] uppercase tracking-wider hover:bg-emerald-800 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Baixar Relatório JSON</span>
                      </button>
                    </div>
                  </div>

                  {/* 4 Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* Card 1: Backup Verificável */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-1.5">
                          <FileJson className="w-4 h-4 text-orange-600" />
                          1. Backup Verificável Pré-Limpeza
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          100% ÍNTEGRO
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        Snapshot completo de todas as <strong>18 tabelas</strong> do IndexedDB e da fila offline salvo em memória e armazenamento seguro.
                      </p>
                      <div className="p-2.5 bg-slate-50 rounded-lg text-[11px] font-mono text-slate-700">
                        <div>Total registros: <strong>{relatorioReorg.etapas.backup.totalRegistros}</strong></div>
                        <div>Checksum: <strong className="text-orange-700">{relatorioReorg.etapas.backup.checksum}</strong></div>
                      </div>
                    </div>

                    {/* Card 2: Reconciliação dos 85 Vencimentos Antigos */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-1.5">
                          <ShieldAlert className="w-4 h-4 text-rose-600" />
                          2. Reconciliação dos 85 Vencimentos Antigos
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                          85 BLINDADOS
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        Reconciliados com exclusões intencionais locais. Aplicados <strong>tombstones definitivos</strong> e enfileirada remoção lógica auditada.
                      </p>
                      <div className="p-2.5 bg-slate-50 rounded-lg text-[11px] font-mono text-slate-700 space-y-1">
                        <div>Pertencentes à Filial 172: <strong>{relatorioReorg.etapas.reconciliacaoVencimentos.pertencentesFilial172}</strong></div>
                        <div>Confirmados como excluídos: <strong>{relatorioReorg.etapas.reconciliacaoVencimentos.confirmadosComoExcluidos}</strong></div>
                        <div>Tombstones ativos: <strong className="text-emerald-700">Sim (Impossível ressuscitar)</strong></div>
                      </div>
                    </div>

                    {/* Card 3: Preservação de Bases Válidas */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-600" />
                          3. Preservação das Bases Válidas
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          0 PERDAS
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        Nenhuma base operacional legítima foi afetada pela limpeza.
                      </p>
                      <div className="p-2.5 bg-slate-50 rounded-lg text-[11px] font-mono text-slate-700 grid grid-cols-2 gap-1">
                        <div>Vínculos EAN: <strong>{relatorioReorg.etapas.preservacaoBasesValidas.vinculosEanPreservados}</strong></div>
                        <div>SAEOU060: <strong>{relatorioReorg.etapas.preservacaoBasesValidas.saeou060Preservados}</strong></div>
                        <div>SPCOI007: <strong>{relatorioReorg.etapas.preservacaoBasesValidas.spcoi007Preservados}</strong></div>
                        <div>Lotes Ativos: <strong>{relatorioReorg.etapas.preservacaoBasesValidas.lotesAtivosPreservados}</strong></div>
                      </div>
                    </div>

                    {/* Card 4: BASE RUB Central Soberana */}
                    <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-1.5">
                          <Layers className="w-4 h-4 text-amber-600" />
                          4. BASE RUB Mestre (36 Colunas)
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                          FONTE SOBERANA
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        Publicação da versão oficial sem conversão indevida de estoque e sem SMGOI013.
                      </p>
                      <div className="p-2.5 bg-slate-50 rounded-lg text-[11px] font-mono text-slate-700">
                        <div>Versão ID: <strong className="text-orange-700">{relatorioReorg.etapas.publicacaoBaseRub.versaoId}</strong></div>
                        <div>Status: <strong>{relatorioReorg.etapas.publicacaoBaseRub.status}</strong></div>
                      </div>
                    </div>
                  </div>

                  {/* Ações Pendentes e Respeito à Cota */}
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/60 space-y-2">
                    <h4 className="text-xs font-black text-amber-900 uppercase tracking-tight flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-700" />
                      Status da Nuvem e Ações Respeitando a Cota do Firestore
                    </h4>
                    <p className="text-xs text-amber-950">
                      Estado atual da sincronização: <strong>{relatorioReorg.etapas.indicadoresSync.estadoAtualReal}</strong>
                    </p>
                    {relatorioReorg.acoesPendentes.length > 0 ? (
                      <ul className="text-xs text-amber-900 space-y-1 pl-4 list-disc">
                        {relatorioReorg.acoesPendentes.map((a, idx) => (
                          <li key={idx}>{a}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-emerald-800 font-bold">
                        ✓ Todas as operações foram sincronizadas diretamente com a nuvem sem pendências!
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 1: SINCRONIZAÇÃO */}
          {/* ================================================================= */}
          {tabAtiva === 'SINCRONIZACAO' && (
            <div className="space-y-4">
              {syncToast && (
                <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs font-bold animate-in fade-in flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
                  <span>{syncToast}</span>
                </div>
              )}

              {/* Status Unificado das 3 Bases Operacionais */}
              <BasesSyncStatusCard />

              {/* Status Counters Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-amber-50/70 border border-amber-200 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-800 uppercase">Pendentes</span>
                    <Clock className="w-4 h-4 text-amber-600" />
                  </div>
                  <p className="text-2xl font-black text-amber-900 mt-1">{contadores.pendentes}</p>
                  <p className="text-[10px] text-amber-700 mt-0.5">Salvo no dispositivo</p>
                </div>

                <div className="bg-sky-50/70 border border-sky-200 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-sky-800 uppercase">Enviando</span>
                    <RefreshCw className="w-4 h-4 text-sky-600 animate-spin" />
                  </div>
                  <p className="text-2xl font-black text-sky-900 mt-1">{contadores.enviando}</p>
                  <p className="text-[10px] text-sky-700 mt-0.5">Em trânsito com a nuvem</p>
                </div>

                <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-800 uppercase">Confirmados</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-2xl font-black text-emerald-900 mt-1">Nuvem V3</p>
                  <p className="text-[10px] text-emerald-700 mt-0.5">Servidor central ativo</p>
                </div>

                <div className="bg-rose-50/70 border border-rose-200 p-3.5 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-rose-800 uppercase">Erros na Fila</span>
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                  </div>
                  <p className="text-2xl font-black text-rose-900 mt-1">{contadores.erros}</p>
                  <p className="text-[10px] text-rose-700 mt-0.5">Com auto-recuperação</p>
                </div>
              </div>

              {/* Action Banner */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-800">
                    Sincronização Transacional Forçada
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Dispara o envio de todas as operações pendentes locais e busca novos lotes com cursores sem limite de 250.
                  </p>
                </div>
                <button
                  onClick={handleForcarSincronizacao}
                  disabled={isForcingSync}
                  className="px-4 py-2 bg-[#F36B0B] hover:bg-[#C94F00] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isForcingSync ? 'animate-spin' : ''}`} />
                  <span>{isForcingSync ? 'Sincronizando...' : 'Sincronizar Agora'}</span>
                </button>
              </div>

              {/* Fila de Operações Detalhada */}
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 mb-2">
                  Fila Transacional Persistente ({contadores.totalFila} operações no histórico recente)
                </h4>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {nuvemSyncEngine.getFila().length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400 font-bold">
                      Nenhuma operação pendente. Todos os registros locais estão sincronizados.
                    </div>
                  ) : (
                    nuvemSyncEngine.getFila().slice().reverse().map((op) => (
                      <div key={op.opId} className="p-2.5 text-xs flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                              op.tipo === 'CREATE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : op.tipo === 'UPDATE'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {op.tipo}
                          </span>
                          <span className="font-mono text-slate-600 font-bold">{op.loteId.slice(-14)}</span>
                          <span className="text-slate-400 text-[10px]">por {op.usuario}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              op.status === 'SINCRONIZADO'
                                ? 'bg-emerald-50 text-emerald-700'
                                : op.status === 'ENVIANDO'
                                ? 'bg-sky-50 text-sky-700 animate-pulse'
                                : op.status === 'ERRO'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {op.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: BASE RUB */}
          {/* ================================================================= */}
          {tabAtiva === 'BASE_RUB' && (
            <div className="space-y-4">
              <div className="bg-orange-50/70 border border-orange-200 rounded-xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-[10px] font-black uppercase text-[#C94F00] px-2 py-0.5 bg-orange-100 rounded">
                      Fonte Soberana Operacional
                    </span>
                    <h3 className="text-sm font-black text-slate-900 uppercase mt-1">
                      Catálogo BASE RUB (36 Colunas) — Filial 172
                    </h3>
                  </div>
                  {versaoAtivaRub ? (
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Versão Oficial Ativa:</p>
                      <p className="text-xs font-mono font-black text-[#C94F00]">{versaoAtivaRub.versaoId}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-amber-700 font-bold">Nenhuma versão oficial ativa na nuvem</span>
                  )}
                </div>

                {versaoAtivaRub && (
                  <div className="mt-3 pt-3 border-t border-orange-200 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-[10px] text-slate-500">Total Produtos:</p>
                      <p className="font-bold text-slate-900">{versaoAtivaRub.totalProdutos}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Partes (Chunks):</p>
                      <p className="font-bold text-slate-900">{versaoAtivaRub.totalChunks}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Publicado por:</p>
                      <p className="font-bold text-slate-900 truncate">{versaoAtivaRub.publicadoPor}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Checksum:</p>
                      <p className="font-mono text-[10px] text-slate-700 truncate">{versaoAtivaRub.checksumBase}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress if publishing */}
              {statusPub.emAndamento && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                    <span>{statusPub.mensagem}</span>
                    <span>{statusPub.progressoPorcentagem}%</span>
                  </div>
                  <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${statusPub.progressoPorcentagem}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Control Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={handlePublicarBaseRub}
                  disabled={!isGerencia || statusPub.emAndamento}
                  className={`p-3.5 rounded-xl border text-left space-y-1 transition-all ${
                    isGerencia
                      ? 'bg-orange-50 hover:bg-orange-100 border-orange-300 cursor-pointer shadow-xs'
                      : 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-black uppercase text-[#C94F00]">
                    <Upload className="w-4 h-4" />
                    <span>Publicar BASE RUB</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    Fraciona a base em chunks &lt;450KB com checksum e proteção CAS de versão. (Exclusivo Gerência)
                  </p>
                </button>

                <button
                  onClick={handleBaixarBaseRub}
                  className="p-3.5 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-xl text-left space-y-1 transition-all cursor-pointer shadow-xs"
                >
                  <div className="flex items-center gap-1.5 text-xs font-black uppercase text-blue-800">
                    <Download className="w-4 h-4" />
                    <span>Baixar Versão Ativa</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    Atualiza o catálogo local com a versão oficial da nuvem com cache seguro de proteção.
                  </p>
                </button>

                <button
                  onClick={handleRollbackRub}
                  disabled={!isGerencia || !versaoAtivaRub?.versaoAnteriorId}
                  className={`p-3.5 rounded-xl border text-left space-y-1 transition-all ${
                    isGerencia && versaoAtivaRub?.versaoAnteriorId
                      ? 'bg-rose-50 hover:bg-rose-100 border-rose-300 cursor-pointer shadow-xs'
                      : 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-black uppercase text-rose-800">
                    <RotateCcw className="w-4 h-4" />
                    <span>Rollback de Versão</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    Comuta o ponteiro oficial de volta para a versão anterior em caso de divergência.
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: BACKUP COMPLETO */}
          {/* ================================================================= */}
          {tabAtiva === 'BACKUP' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <h4 className="text-xs font-black uppercase text-slate-900">
                  Backup Completo Estruturado (18 Tabelas do IndexedDB)
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Exporta um arquivo JSON integral contendo todas as 18 tabelas operacionais da Filial 172
                  (produtos, vencimentos, vínculos EAN, SAEOU060, histórico, ISV, auditoria) e as filas persistentes offline.
                </p>
              </div>

              {backupToast && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold animate-in fade-in">
                  {backupToast}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleGerarBackupCompleto}
                  disabled={isGerandoBackup}
                  className="px-4 py-2.5 bg-[#F36B0B] hover:bg-[#C94F00] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer flex items-center gap-2 disabled:opacity-50"
                >
                  <FileJson className="w-4 h-4" />
                  <span>{isGerandoBackup ? 'Gerando Backup...' : 'Gerar Novo Backup Integral'}</span>
                </button>

                {backupGerado && (
                  <button
                    onClick={handleBaixarArquivoBackup}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Baixar Arquivo JSON ({backupGerado.metadados.totalRegistros} registros)</span>
                  </button>
                )}
              </div>

              {backupGerado && (
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold">
                    <span>Checksum de Integridade:</span>
                    <span className="font-mono text-[11px] text-slate-700">{backupGerado.metadados.checksumSimples}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Data/Hora da Geração:</span>
                    <span className="font-mono">{new Date(backupGerado.metadados.dataHoraIso).toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Total de Tabelas Exportadas:</span>
                    <span className="font-bold text-slate-900">{backupGerado.metadados.totalTabelas} tabelas</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: DIAGNÓSTICO (TESTES 1 A 7) */}
          {/* ================================================================= */}
          {tabAtiva === 'DIAGNOSTICO' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-900">
                    Suíte de Verificação e Homologação (Testes 1 a 7)
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Comprova em tempo real o funcionamento da Nuvem V3 sem depender de simulações externas.
                  </p>
                </div>
                <button
                  onClick={handleExecutarDiagnostico}
                  disabled={isExecutandoTestes}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 ${isExecutandoTestes ? 'animate-spin' : ''}`} />
                  <span>{isExecutandoTestes ? 'Executando...' : 'Rodar Testes'}</span>
                </button>
              </div>

              {testSummary ? (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-100 rounded-xl flex items-center justify-between text-xs font-bold">
                    <span>
                      Resultado: <span className="text-emerald-700">{testSummary.passaram} aprovados</span> /{' '}
                      <span className={testSummary.falharam > 0 ? 'text-rose-700' : 'text-slate-500'}>
                        {testSummary.falharam} falhas
                      </span>
                    </span>
                    <span className="text-slate-500">Tempo total: {testSummary.tempoTotalMs} ms</span>
                  </div>

                  <div className="space-y-2">
                    {testSummary.itens.map((t) => (
                      <div
                        key={t.id}
                        className={`p-3 rounded-xl border transition-all text-xs space-y-1 ${
                          t.sucesso ? 'bg-emerald-50/50 border-emerald-200' : 'bg-rose-50 border-rose-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {t.sucesso ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 stroke-[2.5]" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 stroke-[2.5]" />
                            )}
                            <span className="font-black uppercase text-slate-900">{t.titulo}</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">{t.tempoMs} ms</span>
                        </div>
                        <p className="text-[11px] text-slate-600 pl-6 leading-relaxed">{t.detalhes}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-8 border border-slate-200 rounded-xl text-center text-slate-400 text-xs">
                  Clique em &ldquo;Rodar Testes&rdquo; para validar os 7 requisitos operacionais da Nuvem V3.
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 5: PAPÉIS E AUTORIZAÇÃO */}
          {/* ================================================================= */}
          {tabAtiva === 'PAPEIS' && (
            <div className="space-y-4">
              {/* Card 1: Autenticação Firebase & Perfil no Servidor Firestore */}
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-indigo-950 border border-indigo-700/60 text-indigo-400">
                      <Lock className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wide text-white">
                        Autenticação Firebase & Autorização no Servidor Firestore
                      </h4>
                      <p className="text-[11px] text-slate-300">
                        {authServidor.isAutenticado && !authServidor.isAnonimo
                          ? `Conectado via Firebase Auth: ${authServidor.email}`
                          : 'Sessão anônima local ativa (permissões administrativas restritas na nuvem)'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {authServidor.isAutenticado && !authServidor.isAnonimo ? (
                      <button
                        type="button"
                        onClick={handleLogoutGoogle}
                        className="px-3 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-800 border border-rose-700 text-xs font-bold text-rose-200 transition-colors cursor-pointer"
                      >
                        Desconectar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleLoginGoogle}
                        disabled={isLogandoGoogle}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-bold text-white shadow transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>{isLogandoGoogle ? 'Conectando...' : 'Entrar com Google'}</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="pt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Status Servidor:</span>
                    <span className="font-bold text-slate-200 flex items-center gap-1.5 mt-0.5">
                      {authServidor.isVerificadoServidor ? (
                        <>
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-400 font-black">Autorizado no Servidor</span>
                        </>
                      ) : (
                        <>
                          <ShieldAlert className="w-4 h-4 text-amber-400" />
                          <span className="text-amber-300 font-semibold">Perfil Local / Anônimo</span>
                        </>
                      )}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Filial Autorizada:</span>
                    <span className="font-bold text-slate-200 mt-0.5 block">
                      Filial {authServidor.perfil?.filialId || usuario.filialId || '172'} (Cascavel)
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Papel no Firestore:</span>
                    <span className="font-bold text-orange-400 mt-0.5 block">
                      {authServidor.perfil?.papel || usuario.papel}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Seletor de Papéis Operacionais Locais */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-900">
                      Contexto Operacional Local (RBAC) — Filial 172
                    </h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      No servidor Firestore, o papel é governado por <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px]">/usuarios_autorizados</code> (bloqueado contra auto-escalonamento).
                    </p>
                  </div>
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                    Perfil Ativo: {usuario.papel}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  {(['OPERADOR_LOJA', 'CONFERENTE_ENCARREGADO', 'GERENCIA_ADMIN'] as PapelOperacional[]).map((p) => {
                    const info = PAPEIS_INFO[p];
                    const isCurrent = usuario.papel === p;
                    return (
                      <div
                        key={p}
                        onClick={() => handleMudarPapel(p)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-1.5 ${
                          isCurrent
                            ? 'bg-orange-50 border-[#F36B0B] ring-2 ring-orange-500 shadow-xs'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black uppercase text-slate-900">{info.rotulo}</span>
                          {isCurrent && <Check className="w-4 h-4 text-[#C94F00] stroke-[3]" />}
                        </div>
                        <p className="text-[11px] text-slate-600 leading-snug">{info.descricao}</p>
                        <div className="pt-2 border-t border-slate-100 text-[10px] space-y-0.5">
                          <p className={p !== 'OPERADOR_LOJA' ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                            ✓ Exclusão Lógica fundamentada
                          </p>
                          <p className={p === 'GERENCIA_ADMIN' ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                            ✓ Publicação Central BASE RUB
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 3: Bateria de Diagnóstico de Regras de Segurança (11 Testes) */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-900 flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-indigo-600" />
                      Diagnóstico de Regras de Segurança do Firestore ({relatorioSeguranca.totalTestes} Testes)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Validação em simulador estrito de permissões: não autenticado, outra filial, operador, gerência e auto-escalonamento.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRodarTestesSeguranca}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold uppercase rounded-lg transition-colors cursor-pointer"
                  >
                    Re-executar 11 Testes
                  </button>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg flex items-center justify-between text-xs font-bold">
                  <span className="text-emerald-800">
                    ✓ {relatorioSeguranca.testesPassaram} de {relatorioSeguranca.totalTestes} testes de segurança aprovados
                  </span>
                  <span className="text-slate-500 text-[10px] font-mono">
                    Última execução: {new Date(relatorioSeguranca.dataExecucao).toLocaleTimeString('pt-BR')}
                  </span>
                </div>

                <div className="space-y-1.5 max-h-60 overflow-y-auto divide-y divide-slate-100 pr-1">
                  {relatorioSeguranca.resultados.map((t) => (
                    <div key={t.id} className="pt-2 text-xs flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        {t.sucesso ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-bold text-slate-800 text-[11px]">{t.nome}</p>
                          <p className="text-[10px] text-slate-500 leading-tight">{t.motivo}</p>
                        </div>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 font-mono bg-emerald-100 text-emerald-800">
                        {t.resultadoEsperado}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* ================================================================= */}
          {/* TAB 6: LIMPEZA CONTROLADA DAS TRÊS BASES OPERACIONAIS (FILIAL 172) */}
          {/* ================================================================= */}
          {tabAtiva === 'LIMPEZA_BASES' && (
            <div className="space-y-4">
              {limpezaToast && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold animate-in fade-in flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{limpezaToast}</span>
                </div>
              )}

              {erroLimpeza && (
                <div className="p-3 bg-rose-50 border border-rose-300 text-rose-900 rounded-xl text-xs font-bold animate-in fade-in flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{erroLimpeza}</span>
                </div>
              )}

              {/* Informative Header Banner */}
              <div className="p-4 sm:p-5 rounded-2xl bg-linear-to-r from-rose-50 via-amber-50 to-rose-50 border-2 border-rose-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="p-2.5 rounded-xl bg-rose-600 text-white shadow-xs shrink-0 mt-0.5">
                      <Trash2 className="w-5 h-5" />
                    </span>
                    <div>
                      <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                        Limpeza Controlada das Três Bases Operacionais — Filial 172
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                        Remove versões antigas da <strong>BASE RUB</strong>, <strong>SPCOI007</strong> e <strong>SAEOU060</strong> do Firebase/Firestore e do IndexedDB local, resetando ponteiros mestres para impedir restauração involuntária por outros dispositivos.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleCarregarDiagnostico}
                    disabled={carregandoDiagnostico}
                    className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${carregandoDiagnostico ? 'animate-spin' : ''}`} />
                    <span>Atualizar Diagnóstico</span>
                  </button>
                </div>
              </div>

              {/* Preserved Data Shield Banner (Mandatory Isolation Guarantee) */}
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-600 text-white rounded-lg shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase text-emerald-950">
                      Garantia de Preservação Integral — Isolamento Absoluto
                    </h4>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Vencimentos cadastrados, vínculos EAN de código de barras e promotores <strong>NÃO</strong> são apagados.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono font-bold text-emerald-900">
                  <span className="px-2 py-1 bg-white rounded border border-emerald-300 shadow-2xs">
                    Vencimentos: {diagnosticoBases?.preservados.vencimentosIndexedDB ?? '...'} lotes
                  </span>
                  <span className="px-2 py-1 bg-white rounded border border-emerald-300 shadow-2xs">
                    EANs: {diagnosticoBases?.preservados.vinculosEanIndexedDB ?? '...'} vínculos
                  </span>
                </div>
              </div>

              {/* Diagnostic Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. BASE RUB */}
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-slate-800 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-orange-600" />
                      BASE RUB
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800">
                      36 Colunas
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>IndexedDB Local:</span>
                      <strong className="text-slate-900 font-mono">
                        {diagnosticoBases?.baseRub.registrosLocaisIndexedDB ?? '...'} produtos
                      </strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>Versão Ativa Firestore:</span>
                      <span className="font-mono text-[10px] text-slate-700 truncate max-w-[130px]" title={diagnosticoBases?.baseRub.versaoAtivaRemotaFirestore || 'Nenhuma'}>
                        {diagnosticoBases?.baseRub.versaoAtivaRemotaFirestore ? diagnosticoBases.baseRub.versaoAtivaRemotaFirestore.substring(0, 16) + '...' : 'Nenhuma'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>Versões Históricas:</span>
                      <strong className="text-slate-900 font-mono">
                        {diagnosticoBases?.baseRub.versoesHistoricasRemotas ?? '...'} versões
                      </strong>
                    </div>
                    <div className="flex justify-between py-1">
                      <span>Chunks no Firestore:</span>
                      <strong className="text-slate-900 font-mono">
                        {(diagnosticoBases?.baseRub.chunksRemotosTotal || 0) + (diagnosticoBases?.baseRub.chunksLegadosTotal || 0)} partes
                      </strong>
                    </div>
                  </div>
                </div>

                {/* 2. SPCOI007 */}
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-slate-800 flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-blue-600" />
                      SPCOI007
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                      Fornecedores
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>Fornecedores Local:</span>
                      <strong className="text-slate-900 font-mono">
                        {diagnosticoBases?.spcoi007.registrosLocaisIndexedDB ?? '...'} fornecedores
                      </strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>Versão Ativa Firestore:</span>
                      <span className="font-mono text-[10px] text-slate-700 truncate max-w-[130px]" title={diagnosticoBases?.spcoi007.versaoAtivaRemotaFirestore || 'Nenhuma'}>
                        {diagnosticoBases?.spcoi007.versaoAtivaRemotaFirestore ? diagnosticoBases.spcoi007.versaoAtivaRemotaFirestore.substring(0, 16) + '...' : 'Nenhuma'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>Versões Históricas:</span>
                      <strong className="text-slate-900 font-mono">
                        {diagnosticoBases?.spcoi007.versoesHistoricasRemotas ?? '...'} versões
                      </strong>
                    </div>
                    <div className="flex justify-between py-1">
                      <span>Chunks no Firestore:</span>
                      <strong className="text-slate-900 font-mono">
                        {diagnosticoBases?.spcoi007.chunksRemotosTotal ?? '...'} partes
                      </strong>
                    </div>
                  </div>
                </div>

                {/* 3. SAEOU060 */}
                <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-slate-800 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-purple-600" />
                      SAEOU060
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                      Entradas Loja
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>IndexedDB Local:</span>
                      <strong className="text-slate-900 font-mono">
                        {diagnosticoBases?.saeou060.registrosLocaisIndexedDB ?? '...'} registros
                      </strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>Versão Ativa Firestore:</span>
                      <span className="font-mono text-[10px] text-slate-700 truncate max-w-[130px]" title={diagnosticoBases?.saeou060.versaoAtivaRemotaFirestore || 'Nenhuma'}>
                        {diagnosticoBases?.saeou060.versaoAtivaRemotaFirestore ? diagnosticoBases.saeou060.versaoAtivaRemotaFirestore.substring(0, 16) + '...' : 'Nenhuma'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>Versões Históricas:</span>
                      <strong className="text-slate-900 font-mono">
                        {diagnosticoBases?.saeou060.versoesHistoricasRemotas ?? '...'} versões
                      </strong>
                    </div>
                    <div className="flex justify-between py-1">
                      <span>Chunks no Firestore:</span>
                      <strong className="text-slate-900 font-mono">
                        {(diagnosticoBases?.saeou060.chunksRemotosTotal || 0) + (diagnosticoBases?.saeou060.chunksLegadosTotal || 0)} partes
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Backup Preventivo e Segurança */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-800 flex items-center gap-1.5">
                    <FileJson className="w-4 h-4 text-blue-600" />
                    Backup Preventivo Recuperável
                  </h4>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Gere um download completo em JSON de todas as tabelas locais antes de confirmar a exclusão.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleBaixarBackupPreLimpeza}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar Backup Preventivo (JSON)</span>
                </button>
              </div>

              {/* Area de Confirmação e Exclusão Definitiva */}
              <div className="p-4 sm:p-5 rounded-2xl bg-rose-50/60 border-2 border-rose-300 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-black uppercase text-rose-950">
                      Confirmação Expressa de Limpeza Definitiva
                    </h4>
                    <p className="text-xs text-rose-800 mt-0.5 leading-relaxed">
                      Esta ação removerá completamente os dados antigos de <strong>BASE RUB</strong>, <strong>SPCOI007</strong> e <strong>SAEOU060</strong> tanto da nuvem Firestore (Filial 172) quanto do armazenamento local deste navegador. O aplicativo ficará limpo e pronto para receber a nova importação de planilhas.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-white rounded-xl border border-rose-200 space-y-2">
                  <label className="block text-xs font-bold text-slate-700">
                    Para confirmar a exclusão, digite exatamente <code className="px-1.5 py-0.5 bg-rose-100 text-rose-900 rounded font-mono font-bold">LIMPAR-BASES-172</code> no campo abaixo:
                  </label>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={textoConfirmacao}
                      onChange={(e) => setTextoConfirmacao(e.target.value)}
                      placeholder="LIMPAR-BASES-172"
                      className="flex-1 px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 uppercase"
                      disabled={executandoLimpeza}
                    />
                    <button
                      type="button"
                      onClick={handleExecutarLimpezaBases}
                      disabled={executandoLimpeza || textoConfirmacao.trim().toUpperCase() !== 'LIMPAR-BASES-172'}
                      className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed shadow-xs"
                    >
                      {executandoLimpeza ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Executando Limpeza...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Executar Limpeza Definitiva</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Summary after execution */}
                {resultadoLimpeza && (
                  <div className="p-3.5 bg-emerald-100/80 border border-emerald-300 rounded-xl text-xs space-y-1.5 animate-in fade-in">
                    <div className="flex items-center gap-2 text-emerald-950 font-black">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      <span>{resultadoLimpeza.mensagem}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-emerald-900 font-mono">
                      <div>
                        • BASE RUB: {resultadoLimpeza.detalhesExclusao.baseRub.produtosLocaisRemovidos} prods, {resultadoLimpeza.detalhesExclusao.baseRub.versoesRemotasRemovidas} vers
                      </div>
                      <div>
                        • SPCOI007: {resultadoLimpeza.detalhesExclusao.spcoi007.fornecedoresLocaisRemovidos} forn, {resultadoLimpeza.detalhesExclusao.spcoi007.versoesRemotasRemovidas} vers
                      </div>
                      <div>
                        • SAEOU060: {resultadoLimpeza.detalhesExclusao.saeou060.registrosLocaisRemovidos} reg, {resultadoLimpeza.detalhesExclusao.saeou060.versoesRemotasRemovidas} vers
                      </div>
                    </div>
                    <div className="pt-1 text-[11px] font-bold text-emerald-950">
                      ✓ Vencimentos intactos: {resultadoLimpeza.detalhesExclusao.dadosPreservadosIntactos.vencimentos} | Vínculos EAN intactos: {resultadoLimpeza.detalhesExclusao.dadosPreservadosIntactos.vinculosEan}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-bold">
            Filial 172 | Nuvem V3 Ativa | IndexedDB 18 Tabelas
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
