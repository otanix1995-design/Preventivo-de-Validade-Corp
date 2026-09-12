import {
  AlertOctagon,
  ArrowRight,
  Cloud,
  Database,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  UserCheck,
  Users,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { clearAllData, loadDemoData } from '../services/storage';
import { MetadadosBase } from '../types';
import { LimparDadosAntigosModal } from './LimparDadosAntigosModal';
import { SincronizacaoCentralModal } from './SincronizacaoCentralModal';

interface MaisMenuViewProps {
  metadados: MetadadosBase;
  onNavigateSub: (subView: string) => void;
  onRefreshData: () => void;
}

export const MaisMenuView: React.FC<MaisMenuViewProps> = ({
  metadados,
  onNavigateSub,
  onRefreshData,
}) => {
  const [isLimparModalOpen, setIsLimparModalOpen] = useState(false);
  const [isNuvemModalOpen, setIsNuvemModalOpen] = useState(false);

  const menuItems = [
    {
      id: 'nuvem',
      icon: Cloud,
      iconColor: 'text-indigo-700',
      iconBg: 'bg-indigo-100',
      title: 'Base Central Firestore & Nuvem',
      desc: 'Sincronizar base SMGOI013 com o Firestore e executar testes de validação central.',
      badge: 'Fase Central',
      onClick: () => setIsNuvemModalOpen(true),
    },
    {
      id: 'promotores',
      icon: UserCheck,
      iconColor: 'text-blue-700',
      iconBg: 'bg-blue-100',
      title: 'Promotores',
      desc: 'Gerencie acessos, vínculos e atividades dos promotores.',
      badge: 'Novo',
    },
    {
      id: 'saeou060',
      icon: FileSpreadsheet,
      iconColor: 'text-blue-700',
      iconBg: 'bg-blue-100',
      title: 'Módulo SAEOU060',
      desc: 'Entrada de apontamentos de vencimentos dos promotores e cruzamento com a SMGOI013.',
      badge: 'Novo Módulo',
    },
    {
      id: 'importacao',
      icon: FileSpreadsheet,
      iconColor: 'text-emerald-700',
      iconBg: 'bg-emerald-100',
      title: 'Importar Planilhas (SMGOI013, EANs & SAEOU060)',
      desc: 'Atualize o estoque, giro de 30 dias e vínculos EAN sem perder os lotes cadastrados.',
      badge: 'Principal',
    },
    {
      id: 'eans',
      icon: Users,
      iconColor: 'text-blue-700',
      iconBg: 'bg-blue-100',
      title: 'EANs Vinculados',
      desc: 'Consultar códigos de barras cruzados pelo Código Interno, não encontrados e duplicados.',
    },
    {
      id: 'sem_venda',
      icon: TrendingDown,
      iconColor: 'text-amber-700',
      iconBg: 'bg-amber-100',
      title: 'Produtos Sem Venda / Baixo Giro',
      desc: 'Mercadorias com estoque físico na filial e zero vendas ou longo período sem saída.',
    },
    {
      id: 'divergencias',
      icon: AlertOctagon,
      iconColor: 'text-purple-700',
      iconBg: 'bg-purple-100',
      title: 'Controle de Divergências',
      desc: 'Registro e acompanhamento de inconsistências de estoque físico vs sistema.',
    },
    {
      id: 'relatorios',
      icon: FileText,
      iconColor: 'text-blue-700',
      iconBg: 'bg-blue-100',
      title: 'Relatórios Operacionais e PDF',
      desc: 'Emissão e exportação em PDF e planilhas CSV para negociação com compras.',
    },
  ];

  return (
    <div id="view-mais-menu" className="space-y-4 pb-24 max-w-4xl mx-auto">
      {/* Top Card: Info Filial with Bold Typography */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 space-y-2 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-700" />

        <div className="flex items-center justify-between pt-1">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              CONFIGURAÇÕES E MÓDULOS
            </span>
            <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight leading-tight mt-1">
              Filial 172 - Cascavel
            </h2>
          </div>
          <span className="text-xs font-mono font-black text-blue-900 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md uppercase">
            v2.0 Mobile
          </span>
        </div>
        <p className="text-xs text-gray-500 font-medium">
          Base operacional: <strong className="text-gray-900 font-bold uppercase">{metadados.status_base}</strong> | Última atualização: <strong className="text-gray-900 font-mono font-bold">{metadados.ultima_atualizacao_smgoi013 || 'Nenhuma'}</strong>
        </p>
      </div>

      {/* Cloud Firestore Central Card */}
      <div className="bg-gradient-to-br from-blue-900 via-indigo-900 to-slate-900 text-white rounded-xl p-4 shadow-sm border border-blue-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border border-white/20">
              <Cloud className="w-4 h-4 text-blue-300 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Base Central Firestore
              </h3>
              <p className="text-[11px] text-blue-200 font-medium">
                Conexão Nuvem entre App Principal e App Promotor
              </p>
            </div>
          </div>
          <span className="text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded">
            Pronto
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            id="btn-abrir-nuvem-central"
            onClick={() => setIsNuvemModalOpen(true)}
            className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Sincronizar Base com a Nuvem</span>
          </button>

          <button
            id="btn-abrir-testes-central"
            onClick={() => setIsNuvemModalOpen(true)}
            className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Validar 5 Testes Obrigatórios</span>
          </button>
        </div>
      </div>

      {/* Menu Options Grid */}
      <div className="space-y-2.5">
        {menuItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              id={`menu-item-${item.id}`}
              onClick={() => {
                if (item.onClick) {
                  item.onClick();
                } else {
                  onNavigateSub(item.id);
                }
              }}
              className="w-full bg-white rounded-xl p-4 border border-gray-200 hover:border-blue-500 hover:shadow-xs transition-all flex items-center justify-between gap-3 text-left active:scale-[0.99] group cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div className={`w-11 h-11 rounded-xl ${item.iconBg} flex items-center justify-center shrink-0 border border-black/5`}>
                  <Icon className={`w-5 h-5 ${item.iconColor} stroke-[2.5]`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-gray-900 uppercase group-hover:text-blue-700 transition-colors">
                      {item.title}
                    </h3>
                    {item.badge && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-black uppercase px-2 py-0.5 rounded border border-emerald-200">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 font-medium">
                    {item.desc}
                  </p>
                </div>
              </div>

              <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-700 group-hover:translate-x-1 transition-all shrink-0 stroke-[2.5]" />
            </button>
          );
        })}
      </div>

      {/* Quick Database Reset / Reload Buttons */}
      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3 mt-4">
        <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider">
          Gerenciamento de Dados Locais
        </h4>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIsLimparModalOpen(true)}
            className="px-3.5 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-700 stroke-[2.5]" />
            <span>Limpar Dados Antigos</span>
          </button>

          <button
            onClick={() => {
              if (confirm('Recarregar base de demonstração da Filial 172?')) {
                loadDemoData();
                onRefreshData();
              }
            }}
            className="px-3.5 py-2 rounded-lg bg-white hover:bg-gray-100 border border-gray-300 text-gray-800 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500 stroke-[2.5]" />
            <span>Recarregar Base Demo</span>
          </button>

          <button
            onClick={() => {
              if (confirm('ATENÇÃO: Deseja apagar todos os dados locais?')) {
                clearAllData();
                onRefreshData();
              }
            }}
            className="px-3.5 py-2 rounded-lg bg-white hover:bg-red-50 border border-red-200 text-red-700 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5 text-red-600 stroke-[2.5]" />
            <span>Limpar Todos os Dados</span>
          </button>
        </div>
      </div>

      {/* Modal Limpar Dados Antigos */}
      <LimparDadosAntigosModal
        isOpen={isLimparModalOpen}
        onClose={() => {
          setIsLimparModalOpen(false);
          onRefreshData();
        }}
        initialPreset="TUDO"
      />

      {/* Modal Sincronização e Validação Central Firestore */}
      <SincronizacaoCentralModal
        isOpen={isNuvemModalOpen}
        onClose={() => {
          setIsNuvemModalOpen(false);
          onRefreshData();
        }}
        metadados={metadados}
        onRefreshData={onRefreshData}
      />
    </div>
  );
};
