import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Database,
  Download,
  FileSpreadsheet,
  History,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  X
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { processarVinculosEAN } from '../services/excelParser';
import { gerarExemploPlanilhaSAEOU060, processarSAEOU060 } from '../services/saeou060Parser';
import { gerarExemploPlanilhaSPCOI007, processarArquivoSPCOI007 } from '../services/spcoi007Parser';
import {
  converterRegistroRubParaProduto,
  gerarExemploBaseRub,
  processarBaseRub
} from '../services/isvPlanilhaParser';
import { isvService } from '../services/isvService';
import { formatarMoedaBR } from '../services/deviceId';
import { cloudSyncService, SyncStatusInfo } from '../services/cloudSyncService';
import { productRepository } from '../services/productRepository';
import { clearAllData, getHistoricoImportacoes, getProdutos, loadDemoData, reprocessarBases } from '../services/storage';
import { MetadadosBase, ProdutoSMG, ResumoImportacao, ResumoImportacaoIsv, ResumoImportacaoSPCOI007 } from '../types';
import { LimparDadosAntigosModal } from './LimparDadosAntigosModal';

interface ImportacaoViewProps {
  metadados: MetadadosBase;
  onImportComplete?: () => void;
  onNavigateToSaeou060?: () => void;
  onNavigateToIsv?: () => void;
}

export const ImportacaoView: React.FC<ImportacaoViewProps> = ({
  metadados,
  onImportComplete,
  onNavigateToSaeou060,
  onNavigateToIsv,
}) => {
  const [activeTab, setActiveTab] = useState<'BASE_RUB' | 'VINCULOS_EAN' | 'SAEOU060' | 'SPCOI007' | 'HISTORICO'>('BASE_RUB');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>('Iniciando processamento...');
  const [processingFileType, setProcessingFileType] = useState<'BASE_RUB' | 'VINCULOS_EAN' | 'SAEOU060' | 'SPCOI007'>('BASE_RUB');
  const [ultimoResumo, setUltimoResumo] = useState<ResumoImportacao | null>(null);
  const [ultimoResumoSpcoi, setUltimoResumoSpcoi] = useState<ResumoImportacaoSPCOI007 | null>(null);
  const [ultimoResumoIsv, setUltimoResumoIsv] = useState<ResumoImportacaoIsv | null>(isvService.getResumoIsvAtual());
  const [erroGlobal, setErroGlobal] = useState<string | null>(null);
  const [isDraggingEan, setIsDraggingEan] = useState(false);
  const [isDraggingSaeou, setIsDraggingSaeou] = useState(false);
  const [isDraggingSpcoi, setIsDraggingSpcoi] = useState(false);
  const [isDraggingIsv, setIsDraggingIsv] = useState(false);
  const [isLimparModalOpen, setIsLimparModalOpen] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>(cloudSyncService.getStatus());
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [syncFeedbackMsg, setSyncFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = cloudSyncService.subscribeStatus(setSyncStatus);
    return unsub;
  }, []);

  const handleSyncWithCloud = async () => {
    setIsSyncingCloud(true);
    setSyncFeedbackMsg('Verificando e sincronizando com a nuvem...');
    try {
      const res = await productRepository.syncWithCloud();
      if (onImportComplete) onImportComplete();
      setSyncFeedbackMsg(res.message);
    } catch (e: any) {
      setSyncFeedbackMsg('Erro ao sincronizar com a nuvem.');
    } finally {
      setIsSyncingCloud(false);
      setTimeout(() => setSyncFeedbackMsg(null), 5000);
    }
  };

  const fileInputEanRef = useRef<HTMLInputElement>(null);
  const fileInputSaeouRef = useRef<HTMLInputElement>(null);
  const fileInputSpcoiRef = useRef<HTMLInputElement>(null);
  const fileInputIsvRef = useRef<HTMLInputElement>(null);

  const historico = getHistoricoImportacoes();
  const diagnostico = productRepository.getDiagnosticoBase();

  const handleReprocessar = async () => {
    setIsReprocessing(true);
    try {
      await reprocessarBases();
      if (onImportComplete) onImportComplete();
    } finally {
      setTimeout(() => setIsReprocessing(false), 400);
    }
  };

  const handleProcessFileEan = async (file: File) => {
    if (!file) return;

    setIsProcessing(true);
    setProcessingFileType('VINCULOS_EAN');
    setProgressPercent(0);
    setProgressStatus('Lendo e analisando arquivo de Vínculos EAN...');
    setErroGlobal(null);
    setUltimoResumo(null);

    try {
      const resumo = await processarVinculosEAN(file, (percent, status) => {
        setProgressPercent(percent);
        setProgressStatus(status);
      });
      setUltimoResumo(resumo);
      if (onImportComplete) onImportComplete();
    } catch (err: any) {
      console.error('Erro ao importar Vínculos EAN:', err);
      setErroGlobal(
        err.message ||
          'Erro ao processar a planilha de Vínculos EAN. Verifique se contém colunas de Código Interno e EAN.'
      );
    } finally {
      setIsProcessing(false);
      if (fileInputEanRef.current) fileInputEanRef.current.value = '';
    }
  };

  const handleProcessFileSaeou = async (file: File) => {
    if (!file) return;

    setIsProcessing(true);
    setProcessingFileType('SAEOU060');
    setProgressPercent(0);
    setProgressStatus('Lendo e analisando arquivo SAEOU060...');
    setErroGlobal(null);
    setUltimoResumo(null);

    try {
      const resultado = await processarSAEOU060(file, (percent, status) => {
        setProgressPercent(percent);
        setProgressStatus(status);
      });
      await productRepository.aplicarNovoSnapshotSaeou060(resultado.registros, file.name);
      await productRepository.addHistorico(resultado.resumo);
      setUltimoResumo(resultado.resumo);
      if (onImportComplete) onImportComplete();
    } catch (err: any) {
      console.error('Erro ao importar SAEOU060:', err);
      setErroGlobal(
        err.message ||
          'Erro ao processar a planilha SAEOU060. Verifique se contém colunas válidas de Código, Vencimento e Quantidade.'
      );
    } finally {
      setIsProcessing(false);
      if (fileInputSaeouRef.current) fileInputSaeouRef.current.value = '';
    }
  };

  const handleFileEanChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleProcessFileEan(files[0]);
    }
  };

  const handleFileSaeouChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleProcessFileSaeou(files[0]);
    }
  };

  const handleProcessFileSpcoi = async (file: File) => {
    if (!file) return;

    setIsProcessing(true);
    setProcessingFileType('SPCOI007');
    setProgressPercent(0);
    setProgressStatus('Lendo e analisando arquivo SPCOI007...');
    setErroGlobal(null);
    setUltimoResumo(null);
    setUltimoResumoSpcoi(null);

    try {
      const produtosAtuais = getProdutos();
      const industriasAtuais = isvService.getIndustrias();
      const resultado = await processarArquivoSPCOI007(
        file,
        produtosAtuais,
        industriasAtuais,
        (percent, status) => {
          setProgressPercent(percent);
          setProgressStatus(status);
        }
      );

      await isvService.salvarImportacaoSpcoi(
        resultado.fornecedores,
        resultado.industrias,
        resultado.resumo
      );

      setUltimoResumoSpcoi(resultado.resumo);
      if (onImportComplete) onImportComplete();
    } catch (err: any) {
      console.error('Erro ao importar SPCOI007:', err);
      setErroGlobal(
        err.message ||
          'Erro ao processar a planilha SPCOI007. Verifique se o arquivo possui colunas válidas de CNPJ, Razão Social e Código do Produto.'
      );
    } finally {
      setIsProcessing(false);
      if (fileInputSpcoiRef.current) fileInputSpcoiRef.current.value = '';
    }
  };

  const handleFileSpcoiChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleProcessFileSpcoi(files[0]);
    }
  };

  const handleProcessFileIsv = async (file: File) => {
    if (!file) return;

    setIsProcessing(true);
    setProcessingFileType('BASE_RUB');
    setProgressPercent(0);
    setProgressStatus('Lendo e analisando BASE DO RUB (36 colunas)...');
    setErroGlobal(null);
    setUltimoResumoIsv(null);

    try {
      const produtosAtuais = getProdutos();
      const fornecedoresAtuais = isvService.getFornecedores();
      const resultado = await processarBaseRub(
        file,
        produtosAtuais,
        fornecedoresAtuais,
        (percent, status) => {
          // Mapeia o progresso do parser da planilha para 0% a 70%
          const pct = Math.min(70, Math.round((percent / 100) * 70));
          setProgressPercent(pct);
          setProgressStatus(
            status.includes('concluída com sucesso')
              ? 'Planilha analisada com sucesso! Preparando catálogo...'
              : status
          );
        }
      );

      // 1. Salvar registros operacionais no isvService
      setProgressPercent(75);
      setProgressStatus('Gravando registros operacionais da BASE RUB localmente...');
      await isvService.salvarImportacaoPlanilhaIsv(
        resultado.registros,
        resultado.resumo
      );

      // 2. Converter registros da BASE DO RUB em lotes assíncronos (chunks)
      // Estabelece a BASE DO RUB como catálogo primário oficial do aplicativo sem travar a interface
      const vinculosAtuais = productRepository.getVinculos();
      const vinculosPorCodigo = new Map<string, string[]>();
      vinculosAtuais.forEach((v) => {
        if (v.status_vinculo === 'VINCULADO' && v.codigo_interno) {
          const list = vinculosPorCodigo.get(v.codigo_interno) || [];
          if (!list.includes(v.ean)) list.push(v.ean);
          vinculosPorCodigo.set(v.codigo_interno, list);
        }
      });

      const totalRegistros = resultado.registros.length;
      const produtosConvertidos: ProdutoSMG[] = [];
      const CHUNK_SIZE = 1000;

      for (let i = 0; i < totalRegistros; i += CHUNK_SIZE) {
        const chunk = resultado.registros.slice(i, i + CHUNK_SIZE);
        for (let j = 0; j < chunk.length; j++) {
          const reg = chunk[j];
          const eans = vinculosPorCodigo.get(reg.codigo_interno) || [];
          produtosConvertidos.push(converterRegistroRubParaProduto(reg, eans));
        }

        const pct = Math.round(75 + (i / totalRegistros) * 15);
        setProgressPercent(pct);
        setProgressStatus(`Indexando catálogo da BASE DO RUB (${Math.min(i + CHUNK_SIZE, totalRegistros)} de ${totalRegistros})...`);
        // Libera o event loop do navegador para fluidez da UI
        await new Promise((r) => setTimeout(r, 0));
      }

      // 3. Gravar catálogo indexado no IndexedDB (local-first, não bloqueia em nuvem)
      setProgressPercent(95);
      setProgressStatus('Confirmando gravação local no IndexedDB...');
      await productRepository.saveProducts(produtosConvertidos);

      // 4. Conclusão confirmada no dispositivo
      setProgressPercent(100);
      setProgressStatus('Importação concluída com sucesso!');

      // Pequena pausa para confirmar 100% visualmente
      await new Promise((r) => setTimeout(r, 200));

      // Garante encerramento imediato do modal local
      setIsProcessing(false);
      setUltimoResumoIsv(resultado.resumo);

      if (onImportComplete) {
        try {
          onImportComplete();
        } catch (cbErr) {
          console.warn('[ImportacaoView] Aviso ao notificar onImportComplete:', cbErr);
        }
      }
    } catch (err: any) {
      console.error('Erro ao importar BASE DO RUB:', err);
      setErroGlobal(
        err.message ||
          'Erro ao processar a BASE DO RUB. Verifique se o arquivo possui as colunas obrigatórias: "Valor Disponível", "Estoque", "Código/Código Interno" e "Nome".'
      );
    } finally {
      setIsProcessing(false);
      if (fileInputIsvRef.current) fileInputIsvRef.current.value = '';
    }
  };

  const handleFileIsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleProcessFileIsv(files[0]);
    }
  };

  const handleDropIsv = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingIsv(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFileIsv(e.dataTransfer.files[0]);
    }
  };

  const handleLimparPlanilhaIsv = async () => {
    if (window.confirm('Deseja realmente limpar a BASE DO RUB?')) {
      await isvService.limparPlanilhaIsv();
      setUltimoResumoIsv(null);
      if (onImportComplete) onImportComplete();
    }
  };

  const handleDropEan = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingEan(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFileEan(e.dataTransfer.files[0]);
    }
  };

  const handleDropSaeou = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingSaeou(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFileSaeou(e.dataTransfer.files[0]);
    }
  };

  const handleDropSpcoi = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingSpcoi(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFileSpcoi(e.dataTransfer.files[0]);
    }
  };

  const handleDownloadSampleEAN = () => {
    const sampleData = [
      {
        'CÓDIGO DE BARRAS / EAN': '7898909755380',
        'CÓDIGO INTERNO': '47293',
        'DÍGITO (OPCIONAL)': '196',
        'DESCRIÇÃO (OPCIONAL)': 'ABACAXI CALDA TOZZI LATA 400G',
      },
      {
        'CÓDIGO DE BARRAS / EAN': '7896434920273',
        'CÓDIGO INTERNO': '51449',
        'DÍGITO (OPCIONAL)': '154',
        'DESCRIÇÃO (OPCIONAL)': 'ABACAXI CALDA TRIANGULO LATA 400G',
      },
      {
        'CÓDIGO DE BARRAS / EAN': '7891251015331',
        'CÓDIGO INTERNO': '4665',
        'DÍGITO (OPCIONAL)': '154',
        'DESCRIÇÃO (OPCIONAL)': 'AZEITE EXTRA VIRGEM BORGES 500ML',
      },
      {
        'CÓDIGO DE BARRAS / EAN': '7506339394535',
        'CÓDIGO INTERNO': '51122',
        'DÍGITO (OPCIONAL)': '108',
        'DESCRIÇÃO (OPCIONAL)': 'SHAMPOO PANTENE RESTAURAÇÃO 400ML',
      },
      {
        'CÓDIGO DE BARRAS / EAN': '7500435190657',
        'CÓDIGO INTERNO': '82444',
        'DÍGITO (OPCIONAL)': '152',
        'DESCRIÇÃO (OPCIONAL)': 'CREME DENTAL ORAL-B 3D WHITE 70G',
      },
      {
        'CÓDIGO DE BARRAS / EAN': '7891234567895',
        'CÓDIGO INTERNO': '46135',
        'DÍGITO (OPCIONAL)': '156',
        'DESCRIÇÃO (OPCIONAL)': 'RF.MARG.QUALY C/SAL',
      },
      {
        'CÓDIGO DE BARRAS / EAN': '7898215150016',
        'CÓDIGO INTERNO': '51208',
        'DÍGITO (OPCIONAL)': '009',
        'DESCRIÇÃO (OPCIONAL)': 'LEITE UHT INTEGRAL PIRACANJUBA 1L',
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vinculos_EAN');
    XLSX.writeFile(wb, 'Exemplo_Planilha_Vinculos_EAN.xlsx');
  };

  return (
    <div id="view-importacao" className="space-y-4 pb-24 max-w-4xl mx-auto">
      {/* Loading Modal Overlay with 0 to 100% Animation */}
      {isProcessing && (
        <div
          id="import-progress-modal"
          className="fixed inset-0 z-50 bg-gray-950/80 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-200 text-center space-y-5">
            <div className="flex items-center justify-center">
              <div className="relative w-24 h-24 flex items-center justify-center">
                {/* Outer spin ring */}
                <div className="absolute inset-0 rounded-full border-4 border-blue-100 border-t-blue-700 animate-spin" />
                {/* Center Percentage Display */}
                <div className="flex flex-col items-center justify-center">
                  <span className="text-2xl font-black font-mono text-blue-700">
                    {progressPercent}%
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-black uppercase tracking-tight text-gray-900">
                {processingFileType === 'BASE_RUB'
                  ? 'Importando BASE RUB (36 Colunas)'
                  : processingFileType === 'SAEOU060'
                  ? 'Importando SAEOU060'
                  : processingFileType === 'SPCOI007'
                  ? 'Importando SPCOI007'
                  : 'Importando Vínculos EAN'}
              </h3>
              <p className="text-xs font-bold text-gray-600 min-h-[32px] flex items-center justify-center">
                {progressStatus}
              </p>
            </div>

            {/* Linear Progress Bar with Smooth Animation */}
            <div className="space-y-1.5">
              <div className="w-full bg-gray-100 rounded-full h-3.5 overflow-hidden p-0.5 border border-gray-200">
                <div
                  className="bg-linear-to-r from-blue-600 via-blue-700 to-indigo-600 h-full rounded-full transition-all duration-200 ease-out shadow-xs"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase font-mono">
                <span>0% INÍCIO</span>
                <span>{progressPercent}% PROCESSADO</span>
                <span>100% FINAL</span>
              </div>
            </div>

            {progressPercent >= 100 ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 text-[11px] text-emerald-900 font-semibold flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Importação concluída com sucesso no dispositivo! Fechando...</span>
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-2.5 text-[11px] text-blue-900 font-medium flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700 shrink-0" />
                <span>Por favor, aguarde a conclusão sem fechar a tela.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top Header Card with Bold Typography */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 space-y-3 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-700" />

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center border border-emerald-200">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight text-gray-900 leading-tight">
                IMPORTAÇÃO DE DADOS
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                BASE RUB (Fonte Oficial), Vínculos EAN, SAEOU060 e SPCOI007
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsLimparModalOpen(true)}
            className="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
            title="Limpar registros antigos, histórico e lotes vencidos"
          >
            <Trash2 className="w-4 h-4 stroke-[2.5]" />
            <span className="hidden sm:inline">Limpar Dados Antigos</span>
          </button>
        </div>

        {/* Tab switcher */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1 bg-gray-100 p-1 rounded-xl">
          <button
            id="tab-importacao-base-rub"
            onClick={() => setActiveTab('BASE_RUB')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none flex items-center justify-center gap-1.5 ${
              activeTab === 'BASE_RUB'
                ? 'bg-white text-orange-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>BASE RUB (36 Colunas)</span>
            {isvService.temPlanilhaIsv() && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" title="Base Oficial Ativa" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('VINCULOS_EAN')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none ${
              activeTab === 'VINCULOS_EAN'
                ? 'bg-white text-orange-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Vínculos EAN
          </button>
          <button
            onClick={() => setActiveTab('SAEOU060')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none ${
              activeTab === 'SAEOU060'
                ? 'bg-white text-orange-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            SAEOU060
          </button>
          <button
            id="tab-importacao-spcoi007"
            onClick={() => setActiveTab('SPCOI007')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none ${
              activeTab === 'SPCOI007'
                ? 'bg-white text-orange-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            SPCOI007 (Fornec.)
          </button>
          <button
            onClick={() => setActiveTab('HISTORICO')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none ${
              activeTab === 'HISTORICO'
                ? 'bg-white text-orange-600 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Histórico ({historico.length})
          </button>
        </div>
      </div>

      {/* Cloud Sync Status Banner (Multi-Dispositivos) */}
      <div className="bg-linear-to-r from-blue-900 to-indigo-900 text-white rounded-xl p-4 shadow-sm border border-blue-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shrink-0 mt-0.5">
            {syncStatus.state === 'syncing' || isSyncingCloud ? (
              <RefreshCw className="w-5 h-5 text-amber-300 animate-spin" />
            ) : syncStatus.state === 'offline' ? (
              <CloudOff className="w-5 h-5 text-rose-300" />
            ) : (
              <Cloud className="w-5 h-5 text-emerald-300" />
            )}
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-white">
                Sincronização em Nuvem (Multi-Dispositivos)
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                syncStatus.state === 'connected'
                  ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/40'
                  : syncStatus.state === 'syncing' || isSyncingCloud
                  ? 'bg-amber-500/30 text-amber-200 border border-amber-400/40'
                  : 'bg-rose-500/30 text-rose-200 border border-rose-400/40'
              }`}>
                {syncStatus.state === 'connected' ? 'Conectado à Nuvem' : syncStatus.state === 'syncing' || isSyncingCloud ? 'Sincronizando...' : 'Offline'}
              </span>
            </div>
            <p className="text-[11px] text-blue-200">
              {syncFeedbackMsg || (
                syncStatus.lastSyncTime
                  ? `Última sincronização às ${syncStatus.lastSyncTime}. Atualizações importadas em outros aparelhos são sincronizadas automaticamente.`
                  : 'Qualquer planilha importada é sincronizada em tempo real com todos os computadores e celulares conectados à filial.'
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSyncWithCloud}
          disabled={isSyncingCloud || syncStatus.state === 'syncing'}
          className="px-3.5 py-2 rounded-xl bg-white text-blue-900 hover:bg-blue-50 active:bg-blue-100 font-black text-xs uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 disabled:opacity-60 cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCloud || syncStatus.state === 'syncing' ? 'animate-spin text-blue-600' : 'text-blue-700'}`} />
          <span>{isSyncingCloud || syncStatus.state === 'syncing' ? 'Sincronizando...' : 'Sincronizar Agora'}</span>
        </button>
      </div>

      {/* Diagnóstico da Base de Dados */}
      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-700 stroke-[2.5]" />
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-900">
              Diagnóstico da Base de Produtos
            </h3>
          </div>
          <button
            type="button"
            onClick={handleReprocessar}
            disabled={isReprocessing}
            className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="Recalcular índices e cruzar vínculos com os produtos atuais"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReprocessing ? 'animate-spin' : ''}`} />
            <span>{isReprocessing ? 'Reprocessando...' : 'Reprocessar Vínculos'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Produtos no Repositório
            </span>
            <span className="text-lg font-black font-mono text-slate-900">
              {diagnostico.totalPersistidos.toLocaleString('pt-BR')}
            </span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Status da Base
            </span>
            <span className={`text-xs font-black uppercase tracking-wider inline-block mt-1 px-2 py-0.5 rounded ${
              diagnostico.totalPersistidos === 0
                ? 'bg-amber-100 text-amber-900'
                : 'bg-emerald-100 text-emerald-900'
            }`}>
              {diagnostico.totalPersistidos === 0 ? 'VAZIA (0 PRODS)' : diagnostico.statusBase}
            </span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Vínculos Localizados
            </span>
            <span className="text-lg font-black font-mono text-emerald-700">
              {diagnostico.vinculosEncontrados.toLocaleString('pt-BR')}
            </span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              {diagnostico.totalPersistidos === 0 ? 'Aguardando Base' : 'Não Localizados'}
            </span>
            <span className={`text-lg font-black font-mono ${
              diagnostico.vinculosPendentes > 0
                ? (diagnostico.totalPersistidos === 0 ? 'text-amber-600' : 'text-rose-600')
                : 'text-slate-700'
            }`}>
              {diagnostico.vinculosPendentes.toLocaleString('pt-BR')}
            </span>
          </div>
        </div>
      </div>

      {/* Global Error Banner */}
      {erroGlobal && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-xs font-medium space-y-2">
          <div className="flex items-center gap-1.5 font-black text-red-800 uppercase">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 stroke-[2.5]" />
            <span>Falha na Importação da Planilha:</span>
          </div>
          <p className="text-gray-800">{erroGlobal}</p>
          <div className="pt-2 border-t border-red-200 text-[11px] text-red-900 space-y-1">
            <span className="font-bold uppercase block">Dicas para resolver:</span>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Certifique-se de que o arquivo contém a coluna de Código (ex: <code>Código</code>, <code>Cod. Mercadoria</code> ou <code>Código Interno</code>).</li>
              <li>A planilha pode estar em formato <code>.xlsx</code>, <code>.xls</code> ou <code>.csv</code>.</li>
              <li>Você pode baixar o modelo de exemplo abaixo para testar imediatamente.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Summary Box if just imported */}
      {ultimoResumo && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-5 text-emerald-950 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 stroke-[2.5]" />
              <h3 className="text-sm font-black text-emerald-900 uppercase">
                Importação Concluída com Sucesso!
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-emerald-700">
              {ultimoResumo.data_hora}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="bg-white p-3 rounded-xl border border-emerald-200">
              <span className="text-[10px] text-emerald-700 font-bold block uppercase tracking-wider">Lidos</span>
              <strong className="text-xl font-black font-mono text-gray-900">{ultimoResumo.total_lidos}</strong>
            </div>
            <div className="bg-white p-3 rounded-xl border border-emerald-200">
              <span className="text-[10px] text-emerald-700 font-bold block uppercase tracking-wider">Atualizados</span>
              <strong className="text-xl font-black font-mono text-blue-700">{ultimoResumo.total_atualizados}</strong>
            </div>
            <div className="bg-white p-3 rounded-xl border border-emerald-200">
              <span className="text-[10px] text-emerald-700 font-bold block uppercase tracking-wider">Novos</span>
              <strong className="text-xl font-black font-mono text-emerald-700">{ultimoResumo.total_novos}</strong>
            </div>
            <div className="bg-white p-3 rounded-xl border border-emerald-200">
              <span className="text-[10px] text-emerald-700 font-bold block uppercase tracking-wider">Erros/Ignor.</span>
              <strong className="text-xl font-black font-mono text-gray-700">
                {ultimoResumo.total_erros + ultimoResumo.total_ignorados}
              </strong>
            </div>
          </div>

          {ultimoResumo.detalhes_erros && ultimoResumo.detalhes_erros.length > 0 && (
            <div className="bg-white p-3 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
              <span className="font-black uppercase flex items-center gap-1 text-amber-800">
                <AlertTriangle className="w-3.5 h-3.5 stroke-[2.5]" />
                Avisos na importação:
              </span>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] font-medium">
                {ultimoResumo.detalhes_erros.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-emerald-800 italic font-medium">
            * Seus lotes de vencimento e anotações foram preservados integralmente.
          </p>
        </div>
      )}

      {/* TAB 1: BASE RUB (36 COLUNAS) — FONTE OPERACIONAL PRINCIPAL */}
      {activeTab === 'BASE_RUB' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                    Importar BASE RUB (36 Colunas) — Fonte Operacional Principal
                  </h3>
                  {isvService.temPlanilhaIsv() && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                      Base Oficial Ativa
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 font-medium">
                  Base operacional soberana da Filial 172. Alimenta Dashboard, Consulta, ISV, Vencimentos, Cartazes e Relatórios com Valor Disponível oficial.
                </p>
              </div>

              {onNavigateToIsv && (
                <button
                  type="button"
                  onClick={onNavigateToIsv}
                  className="px-3.5 py-2 rounded-xl bg-orange-50 text-orange-700 hover:bg-orange-100 active:bg-orange-200 border border-orange-200 font-black text-xs uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all cursor-pointer self-start sm:self-auto shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 text-orange-600 stroke-[2.5]" />
                  <span>Ir para Módulo ISV</span>
                </button>
              )}
            </div>

            {/* Rules Callout Box */}
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-xs text-orange-950 space-y-2">
              <div className="flex items-center gap-1.5 font-black uppercase text-orange-900 tracking-wide">
                <Info className="w-4 h-4 text-orange-700 shrink-0 stroke-[2.5]" />
                <span>Diretrizes e Proteção da BASE DO RUB:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-orange-950 font-medium">
                <li>
                  <strong>Soberania Operacional e Financeira:</strong> A BASE DO RUB é a fonte de autoridade máxima. O <em>Valor Disponível</em> oficial é preservado diretamente do ERP.
                </li>
                <li>
                  <strong>Identificação Estrita de Produtos:</strong> Identificação correta por <em>Filial + Código Interno (raiz) + Dígito</em> com integridade de zeros à esquerda.
                </li>
                <li>
                  <strong>Vencimentos 100% Protegidos:</strong> Importações da BASE DO RUB <strong>NUNCA apagam</strong> lotes de vencimentos cadastrados em loja ou vínculos EAN.
                </li>
                <li>
                  <strong>Integração com SPCOI007:</strong> A base auxiliar SPCOI007 enriquece os produtos com dados de fornecedores, CNPJs e promotores.
                </li>
              </ul>
            </div>

            {/* Upload Area with Drag and Drop */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingIsv(true);
              }}
              onDragLeave={() => setIsDraggingIsv(false)}
              onDrop={handleDropIsv}
              className={`border-2 border-dashed rounded-xl p-6 text-center space-y-3 transition-colors ${
                isDraggingIsv
                  ? 'border-orange-500 bg-orange-50/50'
                  : 'border-gray-300 hover:border-orange-500 bg-gray-50'
              }`}
            >
              <UploadCloud className="w-12 h-12 text-orange-600 mx-auto stroke-[2]" />
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-gray-800">
                  Arraste e solte o arquivo da BASE DO RUB (36 Colunas) aqui
                </p>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Reconhecimento automático por cabeçalho • Formatos aceitos: .xlsx, .xls, .csv
                </p>
              </div>

              <input
                ref={fileInputIsvRef}
                id="input-file-base-rub"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileIsvChange}
                disabled={isProcessing}
                className="hidden"
              />

              <button
                type="button"
                id="btn-selecionar-base-rub"
                onClick={() => fileInputIsvRef.current?.click()}
                disabled={isProcessing}
                className="px-5 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white font-black uppercase tracking-wider text-xs shadow-md inline-flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin stroke-[2.5]" />
                    <span>PROCESSANDO BASE RUB ({progressPercent}%)...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4 stroke-[2.5]" />
                    <span>SELECIONAR BASE RUB (36 COLUNAS)</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={gerarExemploBaseRub}
                className="text-xs font-black uppercase tracking-wider text-orange-600 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                Baixar Modelo Oficial BASE RUB (.xlsx 36 colunas — Filial 172)
              </button>

              {isvService.temPlanilhaIsv() && (
                <button
                  type="button"
                  onClick={handleLimparPlanilhaIsv}
                  className="text-xs font-black uppercase tracking-wider text-rose-700 hover:text-rose-900 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 stroke-[2.5]" />
                  Limpar BASE DO RUB
                </button>
              )}
            </div>
          </div>

          {/* Resumo da Importação BASE RUB */}
          {ultimoResumoIsv && (
            <div className="bg-white rounded-xl p-5 border border-emerald-300 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2 text-emerald-800 font-black text-sm uppercase">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Resumo da BASE DO RUB ({ultimoResumoIsv.nome_arquivo}):</span>
                </div>
                <span className="text-xs font-mono font-bold text-gray-500">
                  {new Date(ultimoResumoIsv.data_hora).toLocaleString('pt-BR')}
                </span>
              </div>

              {/* Cards de Métricas */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">Itens Processados</span>
                  <span className="font-mono font-black text-slate-900 text-sm">
                    {ultimoResumoIsv.total_processados.toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
                  <span className="text-[10px] text-emerald-700 font-bold uppercase block">Com Valor Disponível</span>
                  <span className="font-mono font-black text-emerald-950 text-sm">
                    {ultimoResumoIsv.total_com_valor.toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className={`p-2.5 rounded-lg border ${
                  ultimoResumoIsv.total_sem_valor > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}>
                  <span className="text-[10px] font-bold uppercase block">Sem Valor Oficial</span>
                  <span className="font-mono font-black text-sm">
                    {ultimoResumoIsv.total_sem_valor.toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="p-2.5 bg-orange-50 rounded-lg border border-orange-200 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-orange-700 font-bold uppercase block">Valor Total ISV</span>
                  <span className="font-mono font-black text-orange-950 text-sm">
                    {formatarMoedaBR(ultimoResumoIsv.valor_total_disponivel)}
                  </span>
                </div>

                <div className="p-2.5 bg-purple-50 rounded-lg border border-purple-200">
                  <span className="text-[10px] text-purple-700 font-bold uppercase block">Cruzados SPCOI007</span>
                  <span className="font-mono font-black text-purple-950 text-sm">
                    {ultimoResumoIsv.total_cruzados_spcoi007.toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>

              {/* Botão de Ação Rápida para o ISV */}
              {onNavigateToIsv && (
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={onNavigateToIsv}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-black text-xs uppercase tracking-wide flex items-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95"
                  >
                    <Sparkles className="w-4 h-4 stroke-[2.5]" />
                    <span>Abrir Módulo ISV com Dados Oficiais</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: VÍNCULOS EAN */}
      {activeTab === 'VINCULOS_EAN' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                Importar Planilha de Vínculos EAN
              </h3>
              <p className="text-xs text-gray-500 font-medium">
                Associe múltiplos códigos de barras (EANs) aos produtos através do Código Interno.
              </p>
            </div>

            {/* Rules Callout Box */}
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-xs text-purple-900 space-y-1.5">
              <div className="flex items-center gap-1.5 font-black uppercase text-purple-800 tracking-wide">
                <Info className="w-4 h-4 text-purple-700 shrink-0 stroke-[2.5]" />
                <span>Regra Fundamental do Vínculo:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-purple-950 font-medium">
                <li>
                  O vínculo é realizado <strong>exclusivamente pelo CÓDIGO INTERNO</strong> (nunca pela descrição).
                </li>
                <li>
                  O EAN é tratado integralmente como <strong>TEXTO</strong>, preservando todos os dígitos sem notação científica.
                </li>
                <li>
                  Um mesmo produto pode ter <strong>múltiplos EANs</strong> vinculados.
                </li>
              </ul>
            </div>

            {/* Upload Area with Drag and Drop */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingEan(true);
              }}
              onDragLeave={() => setIsDraggingEan(false)}
              onDrop={handleDropEan}
              className={`border-2 border-dashed rounded-xl p-6 text-center space-y-3 transition-colors ${
                isDraggingEan
                  ? 'border-purple-600 bg-purple-50/50'
                  : 'border-gray-300 hover:border-purple-600 bg-gray-50'
              }`}
            >
              <UploadCloud className="w-12 h-12 text-purple-700 mx-auto stroke-[2]" />
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-gray-800">
                  Arraste e solte a planilha de Vínculos EAN aqui
                </p>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Ou clique no botão abaixo • Formatos aceitos: .xlsx, .xls, .csv
                </p>
              </div>

              <input
                ref={fileInputEanRef}
                id="input-file-vinculos-ean"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileEanChange}
                disabled={isProcessing}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputEanRef.current?.click()}
                disabled={isProcessing}
                className="px-5 py-3 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black uppercase tracking-wider text-xs shadow-md inline-flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin stroke-[2.5]" />
                    <span>PROCESSANDO VÍNCULOS ({progressPercent}%)...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4 stroke-[2.5]" />
                    <span>SELECIONAR VÍNCULOS EAN</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={handleDownloadSampleEAN}
                className="text-xs font-black uppercase tracking-wider text-purple-700 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                Baixar Modelo Exemplo Vínculos EAN (.xlsx)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SAEOU060 */}
      {activeTab === 'SAEOU060' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-1">
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                  Importar Planilha SAEOU060
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  Entrada de apontamentos de vencimentos dos promotores com cruzamento automático na BASE DO RUB.
                </p>
              </div>

              {onNavigateToSaeou060 && (
                <button
                  type="button"
                  onClick={onNavigateToSaeou060}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Abrir Módulo SAEOU060
                </button>
              )}
            </div>

            {/* Rules Callout Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 space-y-1.5">
              <div className="flex items-center gap-1.5 font-black uppercase text-blue-800 tracking-wide">
                <Info className="w-4 h-4 text-blue-700 shrink-0 stroke-[2.5]" />
                <span>Regras de Auditoria e Cruzamento do SAEOU060:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-blue-950 font-medium">
                <li>
                  <strong>Base Oficial Única:</strong> O SAEOU060 cruza os apontamentos exclusivamente com a <strong>BASE DO RUB</strong> pelo Código e Dígito.
                </li>
                <li>
                  <strong>Proteção de Dados:</strong> O SAEOU060 <strong>NUNCA substitui</strong> o cadastro oficial nem apaga os vencimentos salvos no controle.
                </li>
                <li>
                  <strong>Auditoria e Preços:</strong> Preços trabalhados e promotores informados são preservados para histórico e auditoria.
                </li>
              </ul>
            </div>

            {/* Upload Area with Drag and Drop */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingSaeou(true);
              }}
              onDragLeave={() => setIsDraggingSaeou(false)}
              onDrop={handleDropSaeou}
              className={`border-2 border-dashed rounded-xl p-6 text-center space-y-3 transition-colors ${
                isDraggingSaeou
                  ? 'border-orange-600 bg-orange-50/50'
                  : 'border-gray-300 hover:border-orange-600 bg-gray-50'
              }`}
            >
              <UploadCloud className="w-12 h-12 text-orange-600 mx-auto stroke-[2]" />
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-gray-800">
                  Arraste e solte o arquivo SAEOU060 aqui
                </p>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Ou clique no botão abaixo • Formatos aceitos: .xlsx, .xls, .csv
                </p>
              </div>

              <input
                ref={fileInputSaeouRef}
                id="input-file-saeou060"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSaeouChange}
                disabled={isProcessing}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputSaeouRef.current?.click()}
                disabled={isProcessing}
                className="px-5 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-wider text-xs shadow-md inline-flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin stroke-[2.5]" />
                    <span>PROCESSANDO SAEOU060 ({progressPercent}%)...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4 stroke-[2.5]" />
                    <span>SELECIONAR SAEOU060</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={gerarExemploPlanilhaSAEOU060}
                className="text-xs font-black uppercase tracking-wider text-orange-600 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                Baixar Modelo Exemplo SAEOU060 (.xlsx)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SPCOI007 */}
      {activeTab === 'SPCOI007' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-1">
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                  Importar Planilha SPCOI007 — Fornecedores & Indústrias
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  Relacionamento entre Produtos, CNPJs de Fornecedores e Indústrias com cruzamento seguro na BASE DO RUB.
                </p>
              </div>
            </div>

            {/* Rules Callout Box */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 space-y-1.5">
              <div className="flex items-center gap-1.5 font-black uppercase text-amber-900 tracking-wide">
                <Info className="w-4 h-4 text-amber-700 shrink-0 stroke-[2.5]" />
                <span>Regras Fundamentais da Base SPCOI007:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-950 font-medium">
                <li>
                  <strong>Soberania da BASE DO RUB:</strong> A SPCOI007 é uma base auxiliar. A importação <strong>NUNCA cadastra novos produtos operacionais</strong> na filial 172.
                </li>
                <li>
                  <strong>Relação Produto → CNPJ → Indústria:</strong> Cada produto é vinculado ao CNPJ normalizado com 14 dígitos (preservando zeros à esquerda).
                </li>
                <li>
                  <strong>Múltiplos CNPJs:</strong> Produtos com mais de um fornecedor mantêm todos os vínculos transparentemente, sem escolha arbitrária.
                </li>
                <li>
                  <strong>Preservação de Dados:</strong> Reimportações preservam cadastros de indústrias e vínculos com promotores previamente configurados.
                </li>
              </ul>
            </div>

            {/* Upload Area with Drag and Drop */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingSpcoi(true);
              }}
              onDragLeave={() => setIsDraggingSpcoi(false)}
              onDrop={handleDropSpcoi}
              className={`border-2 border-dashed rounded-xl p-6 text-center space-y-3 transition-colors ${
                isDraggingSpcoi
                  ? 'border-amber-600 bg-amber-50/50'
                  : 'border-gray-300 hover:border-amber-600 bg-gray-50'
              }`}
            >
              <UploadCloud className="w-12 h-12 text-amber-700 mx-auto stroke-[2]" />
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-gray-800">
                  Arraste e solte o arquivo SPCOI007 aqui
                </p>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Ou clique no botão abaixo • Formatos aceitos: .xlsx, .xls, .csv
                </p>
              </div>

              <input
                ref={fileInputSpcoiRef}
                id="input-file-spcoi007"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSpcoiChange}
                disabled={isProcessing}
                className="hidden"
              />

              <button
                type="button"
                id="btn-selecionar-spcoi007"
                onClick={() => fileInputSpcoiRef.current?.click()}
                disabled={isProcessing}
                className="px-5 py-3 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-black uppercase tracking-wider text-xs shadow-md inline-flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin stroke-[2.5]" />
                    <span>PROCESSANDO SPCOI007 ({progressPercent}%)...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4 stroke-[2.5]" />
                    <span>SELECIONAR PLANILHA SPCOI007</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={gerarExemploPlanilhaSPCOI007}
                className="text-xs font-black uppercase tracking-wider text-amber-800 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                Baixar Modelo Exemplo SPCOI007 (.xlsx)
              </button>
            </div>
          </div>

          {/* Resumo da Importação SPCOI007 caso executada */}
          {ultimoResumoSpcoi && (
            <div className="bg-white rounded-xl p-5 border border-emerald-300 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2 text-emerald-800 font-black text-sm uppercase">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Resumo da Importação SPCOI007 ({ultimoResumoSpcoi.nome_arquivo}):</span>
                </div>
                <span className="text-xs font-mono font-bold text-gray-500">
                  {ultimoResumoSpcoi.data_hora}
                </span>
              </div>

              {/* Colunas Reconhecidas */}
              {ultimoResumoSpcoi.colunas_identificadas && ultimoResumoSpcoi.colunas_identificadas.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  <span className="text-[10px] text-slate-600 font-black uppercase tracking-wider block">
                    8 Colunas Reconhecidas na Planilha:
                  </span>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {ultimoResumoSpcoi.colunas_identificadas.map((col, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-white border border-slate-300 rounded text-[11px] font-mono font-semibold text-slate-800"
                      >
                        ✓ {col}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Cards de Métricas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">Total Lidos</span>
                  <span className="font-mono font-black text-slate-900 text-sm">
                    {ultimoResumoSpcoi.total_lidos.toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
                  <span className="text-[10px] text-emerald-700 font-bold uppercase block">Válidos</span>
                  <span className="font-mono font-black text-emerald-950 text-sm">
                    {(ultimoResumoSpcoi.total_validos ?? ultimoResumoSpcoi.total_lidos).toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className={`p-2.5 rounded-lg border ${
                  (ultimoResumoSpcoi.total_invalidos || 0) > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}>
                  <span className="text-[10px] font-bold uppercase block">Inválidos</span>
                  <span className="font-mono font-black text-sm">
                    {(ultimoResumoSpcoi.total_invalidos || 0).toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="p-2.5 bg-blue-50 rounded-lg border border-blue-200">
                  <span className="text-[10px] text-blue-700 font-bold uppercase block">Na BASE DO RUB</span>
                  <span className="font-mono font-black text-blue-950 text-sm">
                    {ultimoResumoSpcoi.total_encontrados_smg.toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">Sem Correspond.</span>
                  <span className="font-mono font-black text-slate-700 text-sm">
                    {ultimoResumoSpcoi.total_sem_correspondencia.toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200">
                  <span className="text-[10px] text-amber-800 font-bold uppercase block">Múltiplos CNPJs</span>
                  <span className="font-mono font-black text-amber-950 text-sm">
                    {ultimoResumoSpcoi.total_multiplos_cnpjs.toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="p-2.5 bg-purple-50 rounded-lg border border-purple-200">
                  <span className="text-[10px] text-purple-700 font-bold uppercase block">Indústrias (CNPJs)</span>
                  <span className="font-mono font-black text-purple-950 text-sm">
                    {ultimoResumoSpcoi.total_industrias.toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>

              {/* Detalhes de registros inválidos se houver */}
              {ultimoResumoSpcoi.detalhes_invalidos && ultimoResumoSpcoi.detalhes_invalidos.length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3 text-xs space-y-2">
                  <span className="text-[11px] text-amber-900 font-black uppercase tracking-wide block">
                    Avisos de Linhas Ignoradas ({ultimoResumoSpcoi.detalhes_invalidos.length} amostras):
                  </span>
                  <div className="max-h-32 overflow-y-auto space-y-1 font-mono text-[11px] text-amber-950">
                    {ultimoResumoSpcoi.detalhes_invalidos.slice(0, 20).map((inv, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="font-bold text-amber-700">Linha {inv.linha}:</span>
                        <span>{inv.motivo}</span>
                        {inv.dado && <span className="text-gray-500">({inv.dado})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}



      {/* TAB 6: HISTÓRICO */}
      {activeTab === 'HISTORICO' && (
        <div className="space-y-3">
          {historico.length === 0 ? (
            <div className="bg-white rounded-xl p-8 border border-gray-200 text-center space-y-2">
              <History className="w-10 h-10 text-gray-400 mx-auto stroke-[2]" />
              <p className="text-xs font-black text-gray-700 uppercase tracking-wide">
                Nenhuma importação registrada nesta sessão.
              </p>
            </div>
          ) : (
            historico.map((h, idx) => (
              <div
                key={h.id || idx}
                className="bg-white rounded-xl p-4 border border-gray-200 shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                      h.tipo === 'BASE_RUB'
                        ? 'bg-orange-100 text-orange-800'
                        : h.tipo === 'SAEOU060'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-purple-100 text-purple-800'
                    }`}>
                      {h.tipo === 'BASE_RUB' ? 'BASE RUB' : h.tipo}
                    </span>
                    <span className="text-xs font-black text-gray-900 truncate max-w-[180px]">
                      {h.nome_arquivo}
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-500 font-mono font-bold">
                    {h.data_hora}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1 text-center text-xs bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                  <div>
                    <span className="text-gray-400 block text-[9px] font-bold uppercase tracking-wider">Lidos</span>
                    <strong className="font-mono font-black text-gray-900">{h.total_lidos}</strong>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[9px] font-bold uppercase tracking-wider">Atualizados</span>
                    <strong className="text-blue-700 font-mono font-black">{h.total_atualizados}</strong>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[9px] font-bold uppercase tracking-wider">Novos</span>
                    <strong className="text-emerald-700 font-mono font-black">{h.total_novos}</strong>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[9px] font-bold uppercase tracking-wider">Erros</span>
                    <strong className={`font-mono font-black ${h.total_erros > 0 ? 'text-red-600' : 'text-gray-700'}`}>
                      {h.total_erros}
                    </strong>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Administrative Data Tools */}
      <div className="bg-gray-100 rounded-xl p-4 border border-gray-200 space-y-3">
        <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider">
          Gerenciamento da Base de Dados Local
        </h4>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setIsLimparModalOpen(true)}
            className="px-3.5 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-700 stroke-[2.5]" />
            <span>Limpar Dados Antigos</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirm('Carregar dados de demonstração da Filial 172?')) {
                loadDemoData();
                if (onImportComplete) onImportComplete();
              }
            }}
            className="px-3.5 py-2 rounded-lg bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500 stroke-[2.5]" />
            <span>Recarregar Base Demo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirm('ATENÇÃO: Deseja limpar todos os dados cadastrais e lotes locais? Esta ação não pode ser desfeita.')) {
                clearAllData();
                if (onImportComplete) onImportComplete();
              }
            }}
            className="px-3.5 py-2 rounded-lg bg-white hover:bg-red-50 border border-red-200 text-red-700 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5 text-red-600 stroke-[2.5]" />
            <span>Limpar Banco de Dados</span>
          </button>
        </div>
      </div>

      {/* Modal Limpar Dados Antigos */}
      <LimparDadosAntigosModal
        isOpen={isLimparModalOpen}
        onClose={() => {
          setIsLimparModalOpen(false);
          if (onImportComplete) onImportComplete();
        }}
        initialPreset={activeTab === 'HISTORICO' ? 'HISTORICO' : 'VENCIDOS'}
      />
    </div>
  );
};
