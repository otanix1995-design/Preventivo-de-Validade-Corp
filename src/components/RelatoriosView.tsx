import {
  Calendar,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  Sparkles,
  User
} from 'lucide-react';
import React, { useState } from 'react';
import { exportarCsvVencimentos, gerarPdfPreventivo } from '../services/pdfReport';
import { LoteVencimento, ProdutoSMG } from '../types';

interface RelatoriosViewProps {
  vencimentos: LoteVencimento[];
  produtos: ProdutoSMG[];
}

export const RelatoriosView: React.FC<RelatoriosViewProps> = ({
  vencimentos,
  produtos,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [setorSelecionado, setSetorSelecionado] = useState('SETOR FRIOS');
  const [liderNome, setLiderNome] = useState('LIDER JOAO');
  const [fonteDados, setFonteDados] = useState<'TODOS' | 'VENCIMENTOS' | 'SAEOU060'>('TODOS');

  const handleGerarPreventivoOficial = (filtroStatus?: string) => {
    setIsGenerating(true);
    setTimeout(() => {
      gerarPdfPreventivo({
        setor: setorSelecionado,
        lider: liderNome,
        filtroStatus,
        sourceType: fonteDados,
      });
      setIsGenerating(false);
    }, 150);
  };

  const reportPresets = [
    {
      id: 'TODOS',
      title: 'Preventivo Completo de Validades',
      desc: 'Todas as mercadorias com código, dígito, embalagem, comprador, estoque unificado e preços.',
      badge: `${vencimentos.length} LOTES ATIVOS`,
      color: 'blue',
    },
    {
      id: 'ATE_3_DIAS',
      title: 'Preventivo Crítico (Até 3 Dias)',
      desc: 'Mercadorias prioritárias para recolhimento, quebra ou rebaixa imediata.',
      badge: 'PRIORIDADE MÁXIMA',
      color: 'red',
    },
    {
      id: 'SAIDA_INSUFICIENTE',
      title: 'Preventivo Comercial / Risco de Venda',
      desc: 'Produtos com velocidade insuficiente de venda antes da validade.',
      badge: 'AÇÃO COMERCIAL',
      color: 'amber',
    },
    {
      id: 'ENVIAR_AO_COMPRADOR',
      title: 'Preventivo de Trocas e Compradores',
      desc: 'Lista consolidada para negociação de trocas e devoluções junto aos fornecedores.',
      badge: 'NEGOCIAÇÃO',
      color: 'indigo',
    },
  ];

  return (
    <div id="view-relatorios" className="space-y-4 pb-24 max-w-4xl mx-auto">
      {/* Top Card with Bold Typography */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 space-y-3 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-orange-500" />

        <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center border border-orange-200">
              <Printer className="w-5 h-5 text-orange-600 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight text-gray-900 leading-tight">
                EMISSÃO DO PREVENTIVO OFICIAL
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Layout padrão A4 Paisagem com grade preta, cabeçalho laranja e colunas amarelas
              </p>
            </div>
          </div>

          <button
            onClick={exportarCsvVencimentos}
            className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-black uppercase tracking-wider text-xs flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 stroke-[2.5]" />
            <span>Exportar CSV</span>
          </button>
        </div>

        {/* Painel de Configuração do Preventivo */}
        <div className="bg-orange-50/60 p-4 rounded-xl border border-orange-200 space-y-3 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-orange-950 block mb-1">
                Setor do Preventivo
              </label>
              <select
                value={setorSelecionado}
                onChange={(e) => setSetorSelecionado(e.target.value)}
                className="w-full bg-white border border-orange-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-900 focus:outline-hidden focus:border-orange-500 shadow-2xs"
              >
                <option value="SETOR FRIOS">SETOR FRIOS</option>
                <option value="SETOR AÇOUGUE">SETOR AÇOUGUE</option>
                <option value="SETOR MERCEARIA">SETOR MERCEARIA</option>
                <option value="SETOR HORTIFRUTI">SETOR HORTIFRUTI</option>
                <option value="SETOR PADARIA">SETOR PADARIA</option>
                <option value="SETOR LATICÍNIOS">SETOR LATICÍNIOS</option>
                <option value="GERAL / TODOS">GERAL / TODOS</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-orange-950 block mb-1">
                Líder Responsável
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={liderNome}
                  onChange={(e) => setLiderNome(e.target.value)}
                  placeholder="Ex: LIDER JOAO"
                  className="w-full bg-white border border-orange-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-900 uppercase focus:outline-hidden focus:border-orange-500 shadow-2xs"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-orange-950 block mb-1">
                Fonte dos Dados
              </label>
              <select
                value={fonteDados}
                onChange={(e) => setFonteDados(e.target.value as any)}
                className="w-full bg-white border border-orange-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-900 focus:outline-hidden focus:border-orange-500 shadow-2xs"
              >
                <option value="TODOS">Controle de Vencimentos</option>
                <option value="SAEOU060">Planilha SAEOU060</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between flex-wrap gap-2 border-t border-orange-200/80">
            <span className="text-[11px] text-orange-900 font-bold">
              Estrutura: CÓDIGO | DIG | DESCRIÇÃO | EMBALAGEM | COMPRADOR | EMB1 | EMB9 | VENCIMENTO | PRECO
            </span>

            <button
              onClick={() => handleGerarPreventivoOficial()}
              disabled={isGenerating}
              className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white font-black uppercase tracking-wider text-xs flex items-center gap-2 shadow-md transition-all active:scale-95 disabled:opacity-50"
            >
              <Printer className="w-4 h-4 stroke-[3]" />
              <span>GERAR PDF DO PREVENTIVO</span>
            </button>
          </div>
        </div>
      </div>

      {/* Relatórios Presets List */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-gray-500 uppercase tracking-wider px-1">
          Filtros Específicos para Emissão do Preventivo
        </h3>

        {reportPresets.map((preset) => (
          <div
            key={preset.id}
            className="bg-white rounded-xl p-4 border border-gray-200 hover:border-orange-400 shadow-xs space-y-3 transition-all"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-800 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                  {preset.badge}
                </span>
                <h4 className="text-sm font-black text-gray-900 uppercase mt-1.5 leading-snug">
                  {preset.title}
                </h4>
                <p className="text-xs text-gray-600 mt-1 font-medium">
                  {preset.desc}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2.5 border-t border-gray-100">
              <span className="text-[11px] text-gray-400 font-medium">
                Layout Oficial: Topo Laranja + Grade Amarela
              </span>

              <button
                onClick={() => handleGerarPreventivoOficial(preset.id)}
                disabled={isGenerating}
                className="px-4 py-2 rounded-lg bg-gray-900 hover:bg-black active:bg-gray-800 text-white font-black uppercase tracking-wider text-xs flex items-center gap-1.5 shadow-xs transition-all active:scale-95 disabled:opacity-50"
              >
                <Download className="w-4 h-4 stroke-[2.5]" />
                <span>GERAR PDF</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

