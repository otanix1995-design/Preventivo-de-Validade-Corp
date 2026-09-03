import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Database,
  FileSpreadsheet,
  FileText,
  Package,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  TrendingDown,
  Users
} from 'lucide-react';
import React from 'react';
import { calcularProjecaoVencimento, formatarDataBR, formatarDiasRestantes } from '../services/projection';
import { DivergenciaRegistro, LoteVencimento, MetadadosBase, ProdutoSMG } from '../types';
import { StatusBadge } from './StatusBadge';

interface DashboardViewProps {
  metadados: MetadadosBase;
  produtos: ProdutoSMG[];
  vencimentos: LoteVencimento[];
  divergencias: DivergenciaRegistro[];
  onNavigate: (tab: any, filter?: string) => void;
  onOpenScanner: () => void;
  onSelectProduto: (produto: ProdutoSMG) => void;
  onCadastrarDireto: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  metadados,
  produtos,
  vencimentos,
  divergencias,
  onNavigate,
  onOpenScanner,
  onSelectProduto,
  onCadastrarDireto,
}) => {
  const hoje = new Date();
  const produtosMap = new Map<string, ProdutoSMG>();
  produtos.forEach((p) => produtosMap.set(p.codigo_interno, p));

  // Calculate dynamic metrics from REAL live data
  let vencemHojeCount = 0;
  let vencem3DiasCount = 0;
  let enviarCompradorCount = 0;
  let saidaInsuficienteCount = 0;
  let criticosCount = 0;

  const lotesCalculados = vencimentos.map((lote) => {
    const produto = produtosMap.get(lote.codigo_interno);
    const projecao = calcularProjecaoVencimento(lote, produto, hoje);

    if (projecao.dias_restantes === 0) vencemHojeCount++;
    if (projecao.dias_restantes <= 3) vencem3DiasCount++;
    if (lote.enviar_ao_comprador || projecao.status === 'ENVIAR_AO_COMPRADOR') enviarCompradorCount++;
    if (projecao.status === 'SAIDA_INSUFICIENTE') saidaInsuficienteCount++;
    if (projecao.status === 'CRITICO') criticosCount++;

    return { lote, produto, projecao };
  });

  // Calculate products without sales but with stock
  const semVendaCount = produtos.filter((p) => p.estoque_total > 0 && (p.vendas_qtde_30d === 0 || p.dias_sem_venda >= 20)).length;

  // Filter priority alerts (Critical, Saída Insuficiente, Enviar ao Comprador, Alerta)
  const alertasPrioritarios = lotesCalculados
    .filter(({ projecao, lote }) => {
      return (
        projecao.status === 'CRITICO' ||
        projecao.status === 'SAIDA_INSUFICIENTE' ||
        projecao.status === 'ALERTA' ||
        lote.enviar_ao_comprador
      );
    })
    .sort((a, b) => a.projecao.dias_restantes - b.projecao.dias_restantes)
    .slice(0, 6);

  return (
    <div id="view-dashboard" className="space-y-6 pb-20 max-w-5xl mx-auto">
      {/* 1. TOP CARD: FILIAL 172 CASCAVEL & BASE STATUS */}
      <div className="bg-white rounded-xl p-5 shadow-xs border border-gray-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-700" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                PAINEL DE CONTROLE
              </span>
              <span className="text-xs font-mono font-bold text-gray-500">
                SMGOI013
              </span>
            </div>
            <h2 className="text-xl font-black text-gray-900 uppercase tracking-tight leading-tight mt-1">
              Filial 172 - Cascavel
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-1 font-medium">
              <span className="flex items-center gap-1">
                <Database className="w-3.5 h-3.5 text-blue-600" />
                Base: <strong className="text-gray-900 font-bold uppercase">{metadados.status_base}</strong>
              </span>
              <span className="text-gray-300">•</span>
              <span className="flex items-center gap-1 font-mono">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                {metadados.ultima_atualizacao_smgoi013 ? (
                  <span>Atualizado em: <strong className="text-gray-800 font-bold">{metadados.ultima_atualizacao_smgoi013}</strong></span>
                ) : (
                  <span>Não importada</span>
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              id="dash-btn-import-shortcut"
              onClick={() => onNavigate('mais', 'importacao')}
              className="px-3.5 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-200 text-blue-700 text-xs font-black uppercase tracking-wide flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <RefreshCw className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Importar Dados</span>
            </button>
          </div>
        </div>

        {/* Demo banner notice if currently on demo data */}
        {metadados.status_base === 'DEMO' && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong className="font-black uppercase">Modo Demonstração:</strong> Você pode importar sua planilha <strong>SMGOI013</strong> real a qualquer momento.
              </span>
            </div>
            <button
              onClick={() => onNavigate('mais', 'importacao')}
              className="underline font-black text-amber-800 shrink-0 hover:text-amber-950 uppercase text-[11px]"
            >
              Importar agora →
            </button>
          </div>
        )}
      </div>

      {/* 2. DYNAMIC INDICATORS GRID (Bold Typography with colored left borders) */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-xs text-gray-500 uppercase font-black tracking-wider">
            Indicadores Operacionais
          </h3>
          <span className="text-[10px] font-mono uppercase font-bold text-gray-400">Tempo Real</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Card 1: Monitorados */}
          <button
            id="card-indicador-monitorados"
            onClick={() => onNavigate('consulta')}
            className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-blue-600 hover:border-blue-300 text-left transition-all active:scale-[0.98] group"
          >
            <p className="text-xs text-gray-500 uppercase font-black tracking-wider">Monitorados</p>
            <p className="text-3xl font-black text-gray-900 tracking-tight mt-1">{produtos.length}</p>
            <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5 truncate">
              {vencimentos.length} lotes ativos
            </p>
          </button>

          {/* Card 2: Vencem Hoje */}
          <button
            id="card-indicador-vencem-hoje"
            onClick={() => onNavigate('vencimentos', 'HOJE')}
            className={`p-4 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-red-500 hover:border-red-300 text-left transition-all active:scale-[0.98] group ${
              vencemHojeCount > 0 ? 'bg-red-50/40' : 'bg-white'
            }`}
          >
            <p className="text-xs text-red-700 uppercase font-black tracking-wider">Vencem Hoje</p>
            <p className="text-3xl font-black text-red-600 tracking-tight mt-1">
              {String(vencemHojeCount).padStart(2, '0')}
            </p>
            <p className="text-[10px] font-bold text-red-700 uppercase mt-0.5">Ação imediata</p>
          </button>

          {/* Card 3: Até 3 Dias */}
          <button
            id="card-indicador-vencem-3d"
            onClick={() => onNavigate('vencimentos', 'ATE_3_DIAS')}
            className={`p-4 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-orange-500 hover:border-orange-300 text-left transition-all active:scale-[0.98] group ${
              vencem3DiasCount > 0 ? 'bg-orange-50/40' : 'bg-white'
            }`}
          >
            <p className="text-xs text-orange-700 uppercase font-black tracking-wider">Até 3 Dias</p>
            <p className="text-3xl font-black text-orange-500 tracking-tight mt-1">
              {String(vencem3DiasCount).padStart(2, '0')}
            </p>
            <p className="text-[10px] font-bold text-orange-600 uppercase mt-0.5">Alto risco</p>
          </button>

          {/* Card 4: Risco Saída / Saída Insuficiente */}
          <button
            id="card-indicador-saida-insuficiente"
            onClick={() => onNavigate('vencimentos', 'SAIDA_INSUFICIENTE')}
            className={`p-4 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-purple-500 hover:border-purple-300 text-left transition-all active:scale-[0.98] group ${
              saidaInsuficienteCount > 0 ? 'bg-purple-50/40' : 'bg-white'
            }`}
          >
            <p className="text-xs text-purple-700 uppercase font-black tracking-wider">Risco Saída</p>
            <p className="text-3xl font-black text-purple-600 tracking-tight mt-1">
              {String(saidaInsuficienteCount).padStart(2, '0')}
            </p>
            <p className="text-[10px] font-bold text-purple-700 uppercase mt-0.5">Giro insuficiente</p>
          </button>
        </div>
      </div>

      {/* 3. MAIN DASHBOARD GRID: Left: Prioritários List / Right: Actions & Utilities */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Alertas Prioritários List (8 cols) */}
        <div className="lg:col-span-8 flex flex-col space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="font-black text-gray-800 uppercase text-xs tracking-wider flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600" />
                Alertas Prioritários
              </h2>
              <div className="flex items-center gap-2">
                {alertasPrioritarios.length > 0 && (
                  <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-1 rounded uppercase tracking-wide">
                    Ação Necessária ({alertasPrioritarios.length})
                  </span>
                )}
                <button
                  onClick={() => onNavigate('vencimentos')}
                  className="text-xs font-black text-blue-700 hover:underline uppercase tracking-wide"
                >
                  Ver Todos →
                </button>
              </div>
            </div>

            {alertasPrioritarios.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <h4 className="text-sm font-black text-gray-800 uppercase">Nenhum Alerta Crítico</h4>
                <p className="text-xs text-gray-500">
                  Todos os lotes cadastrados estão dentro do prazo normal.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-[10px] uppercase font-black text-gray-400 border-b border-gray-100 bg-white">
                    <tr>
                      <th className="p-3 sm:p-4">Descrição / Código</th>
                      <th className="p-3 sm:p-4 text-center">Estoque</th>
                      <th className="p-3 sm:p-4 text-center">Validade</th>
                      <th className="p-3 sm:p-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    {alertasPrioritarios.map(({ lote, produto, projecao }) => {
                      const diasFmt = formatarDiasRestantes(projecao.dias_restantes);

                      return (
                        <tr
                          key={lote.id}
                          onClick={() => {
                            if (produto) onSelectProduto(produto);
                          }}
                          className="hover:bg-blue-50/70 cursor-pointer transition-colors"
                        >
                          <td className="p-3 sm:p-4">
                            <p className="font-black text-gray-900 leading-snug">
                              {lote.descricao_produto || produto?.descricao}
                            </p>
                            <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                              {lote.codigo_exibicao || lote.codigo_interno}
                              {produto?.eans && produto.eans[0] ? ` | EAN: ${produto.eans[0]}` : ''}
                            </p>
                          </td>
                          <td className="p-3 sm:p-4 text-center font-mono font-bold text-gray-800">
                            {lote.quantidade_total_unidades} UN
                          </td>
                          <td className="p-3 sm:p-4 text-center">
                            <p className={`font-black font-mono ${projecao.dias_restantes <= 3 ? 'text-red-600' : 'text-orange-600'}`}>
                              {formatarDataBR(lote.data_validade)}
                            </p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase">
                              {diasFmt.texto}
                            </p>
                          </td>
                          <td className="p-3 sm:p-4 text-right">
                            <StatusBadge status={projecao.status} size="sm" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Ações de Campo & Utilidades (4 cols) */}
        <div className="lg:col-span-4 flex flex-col space-y-4">
          {/* Card: Ações de Campo (Blue Hero with Bold buttons) */}
          <div className="bg-blue-700 rounded-xl p-5 text-white shadow-md shadow-blue-900/10 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-blue-100">
                Ações de Campo
              </h3>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                id="btn-dash-consultar-mercadoria"
                onClick={() => onNavigate('consulta')}
                className="bg-white text-blue-800 p-3.5 rounded-lg font-black uppercase text-xs tracking-wider flex items-center justify-between hover:bg-blue-50 active:bg-blue-100 shadow-xs transition-all active:scale-98"
              >
                <span>Consultar Mercadoria</span>
                <Search className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              </button>

              <button
                id="btn-dash-escanear-ean"
                onClick={onOpenScanner}
                className="bg-blue-600 text-white p-3.5 rounded-lg font-black uppercase text-xs tracking-wider border border-blue-500 flex items-center justify-between hover:bg-blue-500 active:bg-blue-800 shadow-xs transition-all active:scale-98"
              >
                <span>Escanear EAN</span>
                <Camera className="w-4 h-4 text-white stroke-[2.5]" />
              </button>

              <button
                id="btn-dash-cadastrar-vencimento"
                onClick={onCadastrarDireto}
                className="bg-blue-600 text-white p-3.5 rounded-lg font-black uppercase text-xs tracking-wider border border-blue-500 flex items-center justify-between hover:bg-blue-500 active:bg-blue-800 shadow-xs transition-all active:scale-98"
              >
                <span>Cadastrar Vencimento</span>
                <Plus className="w-4 h-4 text-white stroke-[2.5]" />
              </button>
            </div>
          </div>

          {/* Card: Utilidades (Grid with bold badges) */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
            <h3 className="text-xs font-black text-gray-500 uppercase tracking-wider mb-3">
              Utilidades Operacionais
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => onNavigate('mais', 'saeou060')}
                className="flex flex-col items-center justify-center p-3 border border-blue-200 bg-blue-50/40 rounded-lg hover:bg-blue-100/60 transition-all text-center group text-blue-700"
              >
                <FileSpreadsheet className="w-5 h-5 text-blue-700 mb-1 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-black uppercase">SAEOU060</span>
              </button>

              <button
                onClick={() => onNavigate('mais', 'relatorios')}
                className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded-lg hover:bg-blue-50/50 hover:border-blue-300 transition-all text-center group"
              >
                <FileText className="w-5 h-5 text-blue-700 mb-1 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-black text-gray-700 uppercase">Relatórios PDF</span>
              </button>

              <button
                onClick={() => onNavigate('mais', 'importacao')}
                className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded-lg hover:bg-blue-50/50 hover:border-blue-300 transition-all text-center group"
              >
                <FileSpreadsheet className="w-5 h-5 text-emerald-600 mb-1 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-black text-gray-700 uppercase">Importar Planilhas</span>
              </button>

              <button
                onClick={() => onNavigate('mais', 'eans')}
                className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded-lg hover:bg-blue-50/50 hover:border-blue-300 transition-all text-center group"
              >
                <Users className="w-5 h-5 text-blue-600 mb-1 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-black text-gray-700 uppercase">Vínculos EAN</span>
              </button>
            </div>
          </div>

          {/* Card: Divergências Pendentes */}
          <button
            onClick={() => onNavigate('mais', 'divergencias')}
            className="bg-white p-4 rounded-xl shadow-sm border border-orange-200 hover:border-orange-300 text-left transition-all active:scale-98 group flex items-center justify-between"
          >
            <div>
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-wider">
                Divergências da Base
              </p>
              <p className="text-xl font-black text-gray-900 mt-0.5">
                {String(divergencias.length).padStart(2, '0')}{' '}
                <span className="text-xs font-bold text-gray-500 uppercase">
                  {divergencias.length === 1 ? 'item pendente' : 'itens pendentes'}
                </span>
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-orange-600 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
};
