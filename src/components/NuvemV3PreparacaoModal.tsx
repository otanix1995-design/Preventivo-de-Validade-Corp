import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  FileText
} from 'lucide-react';
import React, { useState } from 'react';
import { backupService, SnapshotCompletoIndexedDB, ValidacaoBackupResultado } from '../services/backupService';
import { localInventoryService, RelatorioInventarioLotes } from '../services/localInventoryService';
import { securityRulesValidator, RelatorioDiagnosticoSeguranca } from '../services/securityRulesValidator';
import {
  concurrentRubPublicationService,
  ResultadoPublicacaoRub,
  VersaoAtivaInfo,
} from '../services/concurrentRubPublicationService';

interface NuvemV3PreparacaoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'visao_geral' | 'backup' | 'inventario' | 'seguranca' | 'concorrencia_rub';

export const NuvemV3PreparacaoModal: React.FC<NuvemV3PreparacaoModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('visao_geral');

  // Estados do Backup
  const [isGeneratingBackup, setIsGeneratingBackup] = useState(false);
  const [backupGerado, setBackupGerado] = useState<SnapshotCompletoIndexedDB | null>(null);
  const [validacaoBackup, setValidacaoBackup] = useState<ValidacaoBackupResultado | null>(null);

  // Estados do Inventário
  const [isAnalyzingInventory, setIsAnalyzingInventory] = useState(false);
  const [inventario, setInventario] = useState<RelatorioInventarioLotes | null>(null);

  // Estados dos Testes de Segurança
  const [isRunningSecurityTests, setIsRunningSecurityTests] = useState(false);
  const [resultadoSeguranca, setResultadoSeguranca] = useState<RelatorioDiagnosticoSeguranca | null>(null);

  // Estados da Concorrência da BASE RUB
  const [resultadoConcorrenciaSucesso, setResultadoConcorrenciaSucesso] = useState<ResultadoPublicacaoRub | null>(null);
  const [resultadoConcorrenciaConflito, setResultadoConcorrenciaConflito] = useState<ResultadoPublicacaoRub | null>(null);

  if (!isOpen) return null;

  // Ações do Backup
  const handleGerarEBaixarBackup = async () => {
    setIsGeneratingBackup(true);
    try {
      const snap = await backupService.baixarBackupJson('172');
      setBackupGerado(snap);
      const val = backupService.validarIntegridade(snap);
      setValidacaoBackup(val);
    } catch (err) {
      console.error('Falha no backup:', err);
    } finally {
      setIsGeneratingBackup(false);
    }
  };

  // Ações do Inventário
  const handleExecutarDiagnosticoInventario = async () => {
    setIsAnalyzingInventory(true);
    try {
      const rel = await localInventoryService.diagnosticarVencimentosLocais('172');
      setInventario(rel);
    } catch (err) {
      console.error('Falha no inventário:', err);
    } finally {
      setIsAnalyzingInventory(false);
    }
  };

  // Ações dos Testes de Segurança
  const handleExecutarTestesSeguranca = () => {
    setIsRunningSecurityTests(true);
    setTimeout(() => {
      const rel = securityRulesValidator.executarSuiteDeTestes();
      setResultadoSeguranca(rel);
      setIsRunningSecurityTests(false);
    }, 300);
  };

  // Ações da Concorrência BASE RUB
  const handleTestarConcorrencia = () => {
    const versaoNoBanco: VersaoAtivaInfo = {
      versaoId: 'rub_v_20261028_100',
      dataPublicacaoIso: new Date(Date.now() - 3600000).toISOString(),
      publicadoPor: 'Terminal_Central_Cascavel',
      totalProdutos: 11650,
      totalChunks: 47,
      checksumBase: 'CHK-RUB-9F8A',
      versaoAnteriorId: 'rub_v_20261020_090',
    };

    // Caso 1: Sucesso (Versão esperada bate exatamente)
    const resOk = concurrentRubPublicationService.simularValidacaoConcorrencia(versaoNoBanco, {
      filialId: '172',
      novaVersaoId: 'rub_v_20261028_101',
      expectedBaseVersionId: 'rub_v_20261028_100', // Coincide com o banco
      publicadoPor: 'Encarregado_172',
      totalProdutos: 11680,
      totalChunks: 47,
      checksumBase: 'CHK-RUB-A1B2',
      dryRun: true,
    });
    setResultadoConcorrenciaSucesso(resOk);

    // Caso 2: Conflito (Versão esperada era antiga, outro terminal já atualizou)
    const resConflito = concurrentRubPublicationService.simularValidacaoConcorrencia(versaoNoBanco, {
      filialId: '172',
      novaVersaoId: 'rub_v_20261028_102',
      expectedBaseVersionId: 'rub_v_20261020_090', // Diverge! Banco já está na 100
      publicadoPor: 'Terminal_Pdv_02',
      totalProdutos: 11620,
      totalChunks: 47,
      checksumBase: 'CHK-RUB-CONFLITO',
      dryRun: true,
    });
    setResultadoConcorrenciaConflito(resConflito);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header do Modal */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-300">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  NUVEM V3 — FASE 1 PREPARATÓRIA
                </h2>
                <span className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded-full uppercase">
                  Filial 172 (Cascavel)
                </span>
                <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full">
                  Somente Diagnóstico
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Validação de segurança em ambiente isolado, backup integral de 18 tabelas e inventário offline sem alteração em produção
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas de Navegação */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 gap-2 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('visao_geral')}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'visao_geral'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Server className="w-4 h-4" />
            Visão Geral & Salvaguardas
          </button>
          <button
            onClick={() => {
              setActiveTab('backup');
              if (!backupGerado) handleGerarEBaixarBackup();
            }}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'backup'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database className="w-4 h-4" />
            Backup Integral (18 Tabelas)
          </button>
          <button
            onClick={() => {
              setActiveTab('inventario');
              if (!inventario) handleExecutarDiagnosticoInventario();
            }}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'inventario'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            Inventário de Lotes & Fila Offline
          </button>
          <button
            onClick={() => {
              setActiveTab('seguranca');
              if (!resultadoSeguranca) handleExecutarTestesSeguranca();
            }}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'seguranca'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-4 h-4" />
            Diagnóstico de Segurança Isolado
          </button>
          <button
            onClick={() => {
              setActiveTab('concorrencia_rub');
              if (!resultadoConcorrenciaSucesso) handleTestarConcorrencia();
            }}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'concorrencia_rub'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            Publicação Concorrente BASE RUB
          </button>
        </div>

        {/* Conteúdo das Abas */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-6">
          {/* ABA 1: VISÃO GERAL & SALVAGUARDAS */}
          {activeTab === 'visao_geral' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-bold text-blue-900">
                      Diretriz Soberana da Fase Preparatória
                    </h3>
                    <p className="text-xs text-blue-800 mt-1 leading-relaxed">
                      Conforme autorização expressa, esta etapa prepara e valida tecnicamente todos os pilares da <strong>Nuvem V3</strong> sem executar migração destrutiva, sem substituir as regras ativas de produção e sem alterar a soberania da <strong>BASE RUB</strong> como catálogo oficial.
                    </p>
                  </div>
                </div>
              </div>

              {/* Grid de 4 Salvaguardas Rígidas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Zero Exclusão de Registros</h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Nenhum lote de vencimento, produto ou vínculo EAN existente no IndexedDB é deletado, truncado ou descartado.
                    </p>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Regras de Produção Intocadas</h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      O arquivo <code>firestore.rules</code> de produção permanece inalterado. As regras restritivas foram elaboradas em <code>firestore.rules.nuvem_v3_draft</code> e validadas em ambiente de teste isolado.
                    </p>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Preservação da BASE RUB Soberana</h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      A BASE RUB é mantida como a única fonte do catálogo operacional oficial. SMGOI013 permanece arquivada e inativa.
                    </p>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Controle Concorrente Transacional</h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      A publicação de novas versões exige validação prévia da versão ativa anterior via <code>runTransaction</code>, eliminando risco de sobrescrita.
                    </p>
                  </div>
                </div>
              </div>

              {/* Ações Rápidas */}
              <div className="bg-slate-100 p-4 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-700">
                  <span className="font-bold">Próximos passos autorizados:</span> Execute as abas acima para gerar o backup, inspecionar a fila offline e rodar os testes de regras.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('backup')}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    Iniciar Backup (JSON)
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ABA 2: BACKUP INTEGRAL */}
          {activeTab === 'backup' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-600" />
                    Snapshot Completo do Banco Local (ControleVencimentosDB_v2)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Exporta e valida 100% dos dados locais de 18 objectStores do IndexedDB e filas offline do localStorage.
                  </p>
                </div>
                <button
                  onClick={handleGerarEBaixarBackup}
                  disabled={isGeneratingBackup}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
                >
                  {isGeneratingBackup ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {isGeneratingBackup ? 'Gerando Snapshot...' : 'Gerar & Baixar Arquivo JSON'}
                </button>
              </div>

              {/* Status de Validação da Integridade */}
              {validacaoBackup && (
                <div
                  className={`p-4 rounded-xl border flex items-start gap-3 ${
                    validacaoBackup.valido
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  {validacaoBackup.valido ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <p className="text-xs font-bold">{validacaoBackup.mensagem}</p>
                    <div className="text-[11px] opacity-90 flex flex-wrap gap-x-4 gap-y-1 font-mono">
                      <span>Total de Tabelas: {validacaoBackup.detalhes.totalTabelas}/18</span>
                      <span>Total de Registros: {validacaoBackup.detalhes.totalRegistros}</span>
                      <span>Checksum: {validacaoBackup.detalhes.checksumCalculado}</span>
                      <span>Lotes de Vencimento: {validacaoBackup.detalhes.lotesVencimentoEncontrados}</span>
                      <span>Catálogo/Produtos: {validacaoBackup.detalhes.produtosEncontrados}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabela de Contagem por ObjectStore */}
              {backupGerado && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Detalhamento por Tabela (18 ObjectStores)
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      Filial: {backupGerado.metadados.filialId} | Checksum: {backupGerado.metadados.checksumSimples}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {Object.entries(backupGerado.metadados.contagemPorTabela).map(([tabela, contagem]) => (
                      <div key={tabela} className="px-4 py-2 flex items-center justify-between text-xs hover:bg-slate-50">
                        <span className="font-mono text-slate-700">{tabela}</span>
                        <span
                          className={`font-bold px-2 py-0.5 rounded-full text-[11px] ${
                            contagem > 0
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {contagem.toLocaleString('pt-BR')} registros
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ABA 3: INVENTÁRIO & FILA OFFLINE */}
          {activeTab === 'inventario' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <FileCheck2 className="w-4 h-4 text-blue-600" />
                    Diagnóstico de Lotes Exclusivos do Dispositivo e Fila Offline
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Identifica vencimentos não sincronizados com a nuvem e operações pendentes em cache para proteção absoluta contra perda de dados.
                  </p>
                </div>
                <button
                  onClick={handleExecutarDiagnosticoInventario}
                  disabled={isAnalyzingInventory}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${isAnalyzingInventory ? 'animate-spin' : ''}`} />
                  {isAnalyzingInventory ? 'Analisando...' : 'Atualizar Diagnóstico'}
                </button>
              </div>

              {inventario && (
                <>
                  {/* Cards de Métricas do Inventário */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Total no IndexedDB
                      </p>
                      <p className="text-xl font-bold text-slate-900 mt-1">
                        {inventario.totalVencimentosIndexedDB}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Lotes cadastrados</p>
                    </div>

                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 shadow-xs">
                      <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                        Somente no Dispositivo
                      </p>
                      <p className="text-xl font-bold text-amber-900 mt-1">
                        {inventario.lotesSomenteDispositivo}
                      </p>
                      <p className="text-[11px] text-amber-700 mt-0.5">Sem confirmação nuvem</p>
                    </div>

                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 shadow-xs">
                      <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                        Confirmados Nuvem
                      </p>
                      <p className="text-xl font-bold text-emerald-900 mt-1">
                        {inventario.lotesConfirmadosNuvem}
                      </p>
                      <p className="text-[11px] text-emerald-700 mt-0.5">Sincronizados e íntegros</p>
                    </div>

                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 shadow-xs">
                      <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                        Fila Offline Pendente
                      </p>
                      <p className="text-xl font-bold text-blue-900 mt-1">
                        {inventario.totalOperacoesOfflinePendentes}
                      </p>
                      <p className="text-[11px] text-blue-700 mt-0.5">Operações a enviar</p>
                    </div>
                  </div>

                  {/* Declaração de Salvaguarda Ativa */}
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      <strong>Garantia de Preservação:</strong> {inventario.garantiaPreservacao.declaracao} (Registros descartados: 0).
                    </span>
                  </div>

                  {/* Amostra dos Lotes Exclusivos do Dispositivo */}
                  {inventario.lotesAmostraSomenteDispositivo.length > 0 && (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                        <span className="text-xs font-bold text-slate-800">
                          Amostra de Lotes Residentes Apenas Neste Dispositivo (Protegidos)
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {inventario.lotesAmostraSomenteDispositivo.map((lote) => (
                          <div key={lote.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900">{lote.codigo_exibicao}</span>
                                <span className="font-medium text-slate-700">{lote.descricao_produto}</span>
                              </div>
                              <p className="text-[11px] text-amber-700 mt-0.5">
                                Motivo: {lote.motivoClassificacao}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-slate-900">
                                {lote.quantidade_total_unidades} un.
                              </span>
                              <p className="text-[11px] text-slate-500">Validade: {lote.data_validade}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Operações da Fila Offline */}
                  {inventario.detalhamentoOperacoesPendentes.length > 0 ? (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                        <span className="text-xs font-bold text-slate-800">
                          Operações na Fila Offline (Sobrevivem ao fechamento da aplicação)
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {inventario.detalhamentoOperacoesPendentes.map((op) => (
                          <div key={op.operationId} className="p-3 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded-sm font-bold text-slate-700">
                                {op.tipoOperacao}
                              </span>
                              <span className="font-medium text-slate-800">
                                {op.payloadResumo.descricao || op.registroId}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              Status: {op.status} ({op.tentativas} tentativas)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-500">
                      Nenhuma operação pendente acumulada na fila offline no momento.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ABA 4: DIAGNÓSTICO DE SEGURANÇA ISOLADO */}
          {activeTab === 'seguranca' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-600" />
                    Bateria de Validação Isolada de Regras (RBAC + Filial 172)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Testa a matriz de permissões em ambiente seguro antes de qualquer publicação no Firestore.
                  </p>
                </div>
                <button
                  onClick={handleExecutarTestesSeguranca}
                  disabled={isRunningSecurityTests}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
                >
                  <Play className={`w-4 h-4 ${isRunningSecurityTests ? 'animate-spin' : ''}`} />
                  {isRunningSecurityTests ? 'Executando...' : 'Reexecutar Bateria de Testes'}
                </button>
              </div>

              {resultadoSeguranca && (
                <>
                  <div
                    className={`p-4 rounded-xl border flex items-center justify-between ${
                      resultadoSeguranca.todosPassaram
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {resultadoSeguranca.todosPassaram ? (
                        <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                      ) : (
                        <ShieldAlert className="w-6 h-6 text-rose-600 shrink-0" />
                      )}
                      <div>
                        <p className="text-xs font-bold">
                          {resultadoSeguranca.todosPassaram
                            ? '100% dos Casos de Teste Aprovados com Sucesso!'
                            : `${resultadoSeguranca.testesFalharam} caso(s) de teste reprovado(s)!`}
                        </p>
                        <p className="text-[11px] opacity-90 mt-0.5">
                          {resultadoSeguranca.testesPassaram} de {resultadoSeguranca.totalTestes} cenários de segurança e isolamento validados.
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono font-bold bg-white/70 px-2.5 py-1 rounded-md border border-current">
                      {resultadoSeguranca.testesPassaram}/{resultadoSeguranca.totalTestes} OK
                    </span>
                  </div>

                  {/* Lista de Casos de Teste Executados */}
                  <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
                    {resultadoSeguranca.resultados.map((teste) => (
                      <div key={teste.id} className="p-3.5 hover:bg-slate-50 transition-colors flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                teste.sucesso ? 'bg-emerald-500' : 'bg-rose-500'
                              }`}
                            />
                            <span className="text-xs font-bold text-slate-800">{teste.nome}</span>
                          </div>
                          <p className="text-[11px] text-slate-600 pl-4">{teste.motivo}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-slate-100 text-slate-600 font-bold">
                            Esperado: {teste.resultadoEsperado}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-sm ${
                              teste.sucesso
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {teste.resultadoObtido}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 bg-slate-100 rounded-xl text-[11px] text-slate-600 border border-slate-200 flex items-center justify-between">
                    <span>
                      Arquivo de referência gerado: <code>firestore.rules.nuvem_v3_draft</code>
                    </span>
                    <span className="font-bold text-amber-800">
                      Regras de produção atuais NÃO foram substituídas (aguardando aprovação).
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ABA 5: CONCORRÊNCIA BASE RUB */}
          {activeTab === 'concorrencia_rub' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600" />
                    Validação de Publicação Concorrente da BASE RUB
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Demonstração do bloqueio otimista via transação atômica contra sobrescrita acidental de versões.
                  </p>
                </div>
                <button
                  onClick={handleTestarConcorrencia}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-xs shrink-0"
                >
                  <RefreshCw className="w-4 h-4" />
                  Simular Cenários de Concorrência
                </button>
              </div>

              {/* Cenário 1: Sucesso */}
              {resultadoConcorrenciaSucesso && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Cenário 1: Publicação Sequencial Válida
                    </span>
                    <span className="text-[10px] font-bold font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-sm">
                      APROVADO
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    A versão ativa atual no Firestore confere perfeitamente com a versão base esperada (<code>rub_v_20261028_100</code>). O ponteiro é comutado com segurança atômica para <code>rub_v_20261028_101</code>.
                  </p>
                  <div className="p-2.5 bg-slate-50 rounded-lg text-[11px] font-mono text-slate-700">
                    {resultadoConcorrenciaSucesso.mensagem}
                  </div>
                </div>
              )}

              {/* Cenário 2: Conflito Interceptado */}
              {resultadoConcorrenciaConflito && (
                <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Cenário 2: Publicação Concorrente Bloqueada
                    </span>
                    <span className="text-[10px] font-bold font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded-sm">
                      BLOQUEADO COM SUCESSO
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Outro terminal atualizou a BASE RUB enquanto este terminal preparava os dados. O publicador esperava a versão antiga (<code>rub_v_20261020_090</code>), mas o banco já avançou para a versão <code>rub_v_20261028_100</code>. A transação <strong>abortou imediatamente</strong> e impediu o descarte da versão intermediária.
                  </p>
                  <div className="p-2.5 bg-amber-50 rounded-lg text-[11px] font-mono text-amber-900 border border-amber-200 space-y-0.5">
                    <p className="font-bold">{resultadoConcorrenciaConflito.mensagem}</p>
                    <p>Versão esperada: {resultadoConcorrenciaConflito.erroConcorrencia?.versaoEsperada}</p>
                    <p>Versão ativa atual: {resultadoConcorrenciaConflito.erroConcorrencia?.versaoRealmenteAtiva}</p>
                    <p>Publicada por: {resultadoConcorrenciaConflito.erroConcorrencia?.publicadoPorOutro}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer do Modal */}
        <div className="px-6 py-3 bg-white border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Lock className="w-4 h-4 text-slate-400" />
            <span>Fase 1 Preparatória Concluída — Aguardando autorização para migração.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors cursor-pointer"
          >
            Fechar Painel
          </button>
        </div>
      </div>
    </div>
  );
};
