import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
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
import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { processarSMGOI013, processarVinculosEAN } from '../services/excelParser';
import { gerarExemploPlanilhaSAEOU060, processarSAEOU060 } from '../services/saeou060Parser';
import { productRepository } from '../services/productRepository';
import { clearAllData, getHistoricoImportacoes, loadDemoData, reprocessarBases } from '../services/storage';
import { MetadadosBase, ResumoImportacao } from '../types';
import { LimparDadosAntigosModal } from './LimparDadosAntigosModal';

interface ImportacaoViewProps {
  metadados: MetadadosBase;
  onImportComplete?: () => void;
  onNavigateToSaeou060?: () => void;
}

export const ImportacaoView: React.FC<ImportacaoViewProps> = ({
  metadados,
  onImportComplete,
  onNavigateToSaeou060,
}) => {
  const [activeTab, setActiveTab] = useState<'SMGOI013' | 'VINCULOS_EAN' | 'SAEOU060' | 'HISTORICO'>('SMGOI013');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>('Iniciando processamento...');
  const [processingFileType, setProcessingFileType] = useState<'SMGOI013' | 'VINCULOS_EAN' | 'SAEOU060'>('SMGOI013');
  const [ultimoResumo, setUltimoResumo] = useState<ResumoImportacao | null>(null);
  const [erroGlobal, setErroGlobal] = useState<string | null>(null);
  const [isDraggingSmg, setIsDraggingSmg] = useState(false);
  const [isDraggingEan, setIsDraggingEan] = useState(false);
  const [isDraggingSaeou, setIsDraggingSaeou] = useState(false);
  const [isLimparModalOpen, setIsLimparModalOpen] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);

  const fileInputSmgRef = useRef<HTMLInputElement>(null);
  const fileInputEanRef = useRef<HTMLInputElement>(null);
  const fileInputSaeouRef = useRef<HTMLInputElement>(null);

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

  const handleProcessFileSmg = async (file: File) => {
    if (!file) return;

    setIsProcessing(true);
    setProcessingFileType('SMGOI013');
    setProgressPercent(0);
    setProgressStatus('Lendo e analisando arquivo da SMGOI013...');
    setErroGlobal(null);
    setUltimoResumo(null);

    try {
      const resumo = await processarSMGOI013(file, (percent, status) => {
        setProgressPercent(percent);
        setProgressStatus(status);
      });
      setUltimoResumo(resumo);
      if (onImportComplete) onImportComplete();
    } catch (err: any) {
      console.error('Erro ao importar SMGOI013:', err);
      setErroGlobal(
        err.message ||
          'Erro ao processar a planilha da SMGOI013. Verifique se o arquivo possui colunas válidas de Código e Descrição.'
      );
    } finally {
      setIsProcessing(false);
      if (fileInputSmgRef.current) fileInputSmgRef.current.value = '';
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
      await productRepository.addSaeou060Registros(resultado.registros);
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

  const handleFileSmgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleProcessFileSmg(files[0]);
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

  // Drag and drop handlers
  const handleDropSmg = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingSmg(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFileSmg(e.dataTransfer.files[0]);
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

  // Helper to generate and download sample spreadsheets for instant user testing
  const handleDownloadSampleSMG = () => {
    const sampleData = [
      {
        'Código': '00046135-156',
        'Descrição Mercadoria': 'RF.MARG.QUALY C/SAL',
        'Embalagem': 'CXA 1 X 6 X 1KG',
        'Estoque Emb1': 24,
        'Estoque Emb9': 6,
        'Vendas Qtde.': 90,
        'Vendas Preço': 11.99,
        'Data Última Entrada': '15/08/2026',
        'Quantidade Última Entrada': 60,
        'Dias sem venda': 1,
        'Idade': 16,
        'Quantidade Ideal': 40,
        'Comprador Filial': 'CARLOS SILVA',
        'Setor Físico': 'LATICINIOS',
        'Setor Balanço': '04 - FRIOS E LATICINIOS',
        'Pedidos Pendentes': '30 CXA',
      },
      {
        'Código': '00051208-009',
        'Descrição Mercadoria': 'LEITE UHT INTEGRAL PIRACANJUBA 1L',
        'Embalagem': 'CXA 1 X 12 X 1L',
        'Estoque Emb1': 180,
        'Estoque Emb9': 20,
        'Vendas Qtde.': 360,
        'Vendas Preço': 4.89,
        'Data Última Entrada': '20/08/2026',
        'Quantidade Última Entrada': 240,
        'Dias sem venda': 0,
        'Idade': 11,
        'Quantidade Ideal': 120,
        'Comprador Filial': 'MARCELO SOUZA',
        'Setor Físico': 'MERCEARIA LIQUIDA',
        'Setor Balanço': '02 - MERCEARIA',
        'Pedidos Pendentes': '',
      },
      {
        'Código': '00049795-166',
        'Descrição Mercadoria': 'IOGURTE GREGO TRADICIONAL NESTLE 90G',
        'Embalagem': 'CXA 1 X 24 X 90G',
        'Estoque Emb1': 48,
        'Estoque Emb9': 12,
        'Vendas Qtde.': 45,
        'Vendas Preço': 3.49,
        'Data Última Entrada': '10/08/2026',
        'Quantidade Última Entrada': 48,
        'Dias sem venda': 8,
        'Idade': 21,
        'Quantidade Ideal': 24,
        'Comprador Filial': 'CARLOS SILVA',
        'Setor Físico': 'LATICINIOS',
        'Setor Balanço': '04 - FRIOS E LATICINIOS',
        'Pedidos Pendentes': '',
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SMGOI013');
    XLSX.writeFile(wb, 'Exemplo_Planilha_SMGOI013.xlsx');
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
                {processingFileType === 'SMGOI013'
                  ? 'Importando SMGOI013'
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

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-2.5 text-[11px] text-blue-900 font-medium flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700 shrink-0" />
              <span>Por favor, aguarde a conclusão sem fechar a tela.</span>
            </div>
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
                Atualização da SMGOI013 e Vínculos EAN com proteção total
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('SMGOI013')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none ${
              activeTab === 'SMGOI013'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            SMGOI013
          </button>
          <button
            onClick={() => setActiveTab('VINCULOS_EAN')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none ${
              activeTab === 'VINCULOS_EAN'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Vínculos EAN
          </button>
          <button
            onClick={() => setActiveTab('SAEOU060')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none ${
              activeTab === 'SAEOU060'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            SAEOU060
          </button>
          <button
            onClick={() => setActiveTab('HISTORICO')}
            className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all select-none ${
              activeTab === 'HISTORICO'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Histórico ({historico.length})
          </button>
        </div>
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

      {/* TAB 1: SMGOI013 */}
      {activeTab === 'SMGOI013' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">
                Importar Planilha SMGOI013
              </h3>
              <p className="text-xs text-gray-500 font-medium">
                Selecione o arquivo Excel (.xlsx, .xls, .csv) com os dados operacionais de estoque, vendas e cadastro da filial.
              </p>
            </div>

            {/* Critical Rules Callout Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 space-y-1.5">
              <div className="flex items-center gap-1.5 font-black uppercase text-blue-800 tracking-wide">
                <Info className="w-4 h-4 text-blue-700 shrink-0 stroke-[2.5]" />
                <span>Regras de Proteção e Reconhecimento Automático:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-blue-950 font-medium">
                <li>
                  <strong>Reconhecimento inteligente:</strong> O sistema detecta automaticamente linhas de cabeçalho, mesmo com cabeçalhos deslocados ou títulos de relatório no topo.
                </li>
                <li>
                  <strong>Zeros à esquerda:</strong> O código é tratado estritamente como texto. Zeros iniciais do Código Interno são normalizados sem perda do dígito (ex: <code>009</code>).
                </li>
                <li>
                  <strong>Vencimentos 100% seguros:</strong> Uma nova importação da SMGOI013 <strong>NUNCA apaga</strong> os lotes cadastrados pela equipe em loja.
                </li>
              </ul>
            </div>

            {/* Upload Area with Drag and Drop */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingSmg(true);
              }}
              onDragLeave={() => setIsDraggingSmg(false)}
              onDrop={handleDropSmg}
              className={`border-2 border-dashed rounded-xl p-6 text-center space-y-3 transition-colors ${
                isDraggingSmg
                  ? 'border-blue-600 bg-blue-50/50'
                  : 'border-gray-300 hover:border-blue-700 bg-gray-50'
              }`}
            >
              <UploadCloud className="w-12 h-12 text-blue-700 mx-auto stroke-[2]" />
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-gray-800">
                  Arraste e solte o arquivo da SMGOI013 aqui
                </p>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Ou clique no botão abaixo • Formatos aceitos: .xlsx, .xls, .csv
                </p>
              </div>

              <input
                ref={fileInputSmgRef}
                id="input-file-smgoi013"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSmgChange}
                disabled={isProcessing}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputSmgRef.current?.click()}
                disabled={isProcessing}
                className="px-5 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-950 text-white font-black uppercase tracking-wider text-xs shadow-md inline-flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin stroke-[2.5]" />
                    <span>PROCESSANDO PLANILHA ({progressPercent}%)...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4 stroke-[2.5]" />
                    <span>SELECIONAR SMGOI013</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={handleDownloadSampleSMG}
                className="text-xs font-black uppercase tracking-wider text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                Baixar Modelo Exemplo SMGOI013 (.xlsx)
              </button>
            </div>
          </div>
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
                  Entrada de apontamentos de vencimentos dos promotores com cruzamento automático na SMGOI013.
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
                  <strong>Base Oficial Única:</strong> O SAEOU060 cruza os apontamentos exclusivamente com a base <strong>SMGOI013</strong> pelo Código e Dígito.
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
                  ? 'border-blue-600 bg-blue-50/50'
                  : 'border-gray-300 hover:border-blue-600 bg-gray-50'
              }`}
            >
              <UploadCloud className="w-12 h-12 text-blue-700 mx-auto stroke-[2]" />
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
                className="px-5 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-black uppercase tracking-wider text-xs shadow-md inline-flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
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
                className="text-xs font-black uppercase tracking-wider text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                Baixar Modelo Exemplo SAEOU060 (.xlsx)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: HISTÓRICO */}
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
                      h.tipo === 'SMGOI013'
                        ? 'bg-blue-100 text-blue-800'
                        : h.tipo === 'SAEOU060'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-purple-100 text-purple-800'
                    }`}>
                      {h.tipo}
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
