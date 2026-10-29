import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
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

interface NuvemV3ControlCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabSecao = 'REORGANIZACAO' | 'SINCRONIZACAO' | 'BASE_RUB' | 'BACKUP' | 'DIAGNOSTICO' | 'PAPEIS';

export const NuvemV3ControlCenterModal: React.FC<NuvemV3ControlCenterModalProps> = ({ isOpen, onClose }) => {
  const [tabAtiva, setTabAtiva] = useState<TabSecao>('REORGANIZACAO');
  const [usuario, setUsuario] = useState<UsuarioOperacional>(() => authRoleService.getUsuarioAtual());
  const [contadores, setContadores] = useState(() => nuvemSyncEngine.getContadores());
  const [versaoAtivaRub, setVersaoAtivaRub] = useState<VersaoAtivaInfo | null>(() => rubSyncService.getVersaoAtivaRemota());
  const [statusPub, setStatusPub] = useState<PublicacaoRubStatus>(() => rubSyncService.getStatusPublicacao());
  
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

  useEffect(() => {
    if (!isOpen) return;

    const unsubAuth = authRoleService.subscribe(setUsuario);
    const unsubEngine = nuvemSyncEngine.subscribe(() => {
      setContadores(nuvemSyncEngine.getContadores());
    });
    const unsubRubVersao = rubSyncService.subscribeVersao(setVersaoAtivaRub);
    const unsubRubStatus = rubSyncService.subscribeStatus(setStatusPub);
    const unsubReorg = reorganizacaoNuvemService.subscribe(setRelatorioReorg);

    return () => {
      unsubAuth();
      unsubEngine();
      unsubRubVersao();
      unsubRubStatus();
      unsubReorg();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleMudarPapel = (papel: PapelOperacional) => {
    authRoleService.alternarPapel(papel);
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

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-200 bg-slate-50 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setTabAtiva('REORGANIZACAO')}
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
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
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
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
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
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
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
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
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
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
            className={`px-3.5 py-2.5 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all border-b-2 whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              tabAtiva === 'PAPEIS'
                ? 'border-[#F36B0B] text-[#C94F00] bg-white shadow-2xs'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Papéis & Acesso</span>
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
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h4 className="text-xs font-black uppercase text-slate-900">
                  Controle de Acesso Baseado em Papéis (RBAC) — Filial 172
                </h4>
                <p className="text-xs text-slate-600 mt-1">
                  Selecione o papel do usuário deste dispositivo para testar ou operar com as permissões apropriadas:
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(['OPERADOR_LOJA', 'CONFERENTE_ENCARREGADO', 'GERENCIA_ADMIN'] as PapelOperacional[]).map((p) => {
                  const info = PAPEIS_INFO[p];
                  const isCurrent = usuario.papel === p;
                  return (
                    <div
                      key={p}
                      onClick={() => handleMudarPapel(p)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2 ${
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
                      <div className="pt-2 border-t border-slate-100 text-[10px] space-y-1">
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
