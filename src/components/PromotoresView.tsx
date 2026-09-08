import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Filter,
  History,
  QrCode,
  RotateCcw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  Wifi,
  WifiOff
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { promotorService } from '../services/promotorService';
import { Promotor, SETORES_DISPONIVEIS, StatusPromotor } from '../types';
import { AuditoriaPromotoresView } from './promotores/AuditoriaPromotoresView';
import { CadastrarPromotorModal } from './promotores/CadastrarPromotorModal';
import { DetalhePromotorModal } from './promotores/DetalhePromotorModal';
import { GerarVinculoModal } from './promotores/GerarVinculoModal';

interface PromotoresViewProps {
  onBack: () => void;
}

export const PromotoresView: React.FC<PromotoresViewProps> = ({ onBack }) => {
  const [promotores, setPromotores] = useState<Promotor[]>([]);
  const [indicators, setIndicators] = useState({
    totalAtivos: 0,
    totalOffline: 0,
    pendenciasSincronizacao: 0,
    acoesHoje: 0,
  });

  const [activeTab, setActiveTab] = useState<'lista' | 'auditoria'>('lista');
  const [searchQuery, setSearchQuery] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');
  const [filtroSetor, setFiltroSetor] = useState<string>('TODOS');

  // Modals state
  const [isCadastrarModalOpen, setIsCadastrarModalOpen] = useState(false);
  const [isVinculoModalOpen, setIsVinculoModalOpen] = useState(false);
  const [isDetalheModalOpen, setIsDetalheModalOpen] = useState(false);
  const [selectedPromotor, setSelectedPromotor] = useState<Promotor | null>(null);

  // Auditoria filter state
  const [filtroPromotorAuditoria, setFiltroPromotorAuditoria] = useState<string | undefined>(undefined);

  const carregarDados = () => {
    setPromotores(promotorService.getPromotores());
    setIndicators(promotorService.getIndicators());
  };

  useEffect(() => {
    promotorService.init().then(() => {
      carregarDados();
    });

    const unsub = promotorService.subscribe(() => {
      carregarDados();
    });

    return () => unsub();
  }, []);

  // Filtered promoters
  const promotoresFiltrados = useMemo(() => {
    return promotores.filter((p) => {
      // Status filter
      if (filtroStatus === 'ATIVO' && p.status !== 'ATIVO') return false;
      if (filtroStatus === 'PENDENTE_VINCULO' && p.status !== 'PENDENTE_VINCULO') return false;
      if (filtroStatus === 'BLOQUEADO' && p.status !== 'BLOQUEADO') return false;
      if (filtroStatus === 'OFFLINE') {
        const online = promotorService.isPromotorOnline(p);
        if (online) return false;
      }

      // Setor filter
      if (filtroSetor !== 'TODOS' && p.setorId !== filtroSetor) return false;

      // Text Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNome = p.nome.toLowerCase().includes(q);
        const matchMat = p.matricula?.toLowerCase().includes(q);
        const matchSetor = p.setorNome.toLowerCase().includes(q);
        const matchFilial = p.filialNome.toLowerCase().includes(q);
        if (!matchNome && !matchMat && !matchSetor && !matchFilial) {
          return false;
        }
      }

      return true;
    });
  }, [promotores, filtroStatus, filtroSetor, searchQuery]);

  const handleOpenGerarVinculo = (promotor: Promotor) => {
    setSelectedPromotor(promotor);
    setIsVinculoModalOpen(true);
  };

  const handleOpenDetalhes = (promotor: Promotor) => {
    setSelectedPromotor(promotor);
    setIsDetalheModalOpen(true);
  };

  const handlePromotorCadastrado = (novo: Promotor) => {
    setIsCadastrarModalOpen(false);
    carregarDados();
    // Como solicitado no fluxo: após cadastrar, abre imediatamente o modal de gerar vínculo
    setSelectedPromotor(novo);
    setIsVinculoModalOpen(true);
  };

  const handleVerAuditoriaDoPromotor = (promotor: Promotor) => {
    setFiltroPromotorAuditoria(promotor.promotorId);
    setActiveTab('auditoria');
  };

  return (
    <div id="view-promotores" className="space-y-4 pb-24 max-w-5xl mx-auto">
      {/* Top Header with Back Button and System Info */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="text-xs font-bold text-blue-700 hover:text-blue-900 flex items-center gap-1.5 transition-colors cursor-pointer group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span>Voltar para Menu Mais</span>
        </button>

        {/* Phase Preparation Pill */}
        <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full text-[11px] font-black uppercase text-blue-900">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
          <span>APP PROMOTOR — Preparação concluída / aguardando aplicativo de campo</span>
        </div>
      </div>

      {/* Main Header Card */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-700" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded border border-blue-200">
                GESTÃO OPERACIONAL
              </span>
              <span className="text-xs font-mono font-bold text-gray-400">
                Filial 172 • Cascavel
              </span>
            </div>
            <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight mt-1">
              PROMOTORES
            </h1>
            <p className="text-xs text-gray-500 font-medium mt-0.5">
              Gerencie acessos, vínculos e atividades dos promotores de vendas e reposição.
            </p>
          </div>

          {/* Primary Action: Novo Promotor */}
          <button
            type="button"
            id="btn-novo-promotor"
            onClick={() => setIsCadastrarModalOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-98 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer shrink-0"
          >
            <UserPlus className="w-4 h-4 stroke-[2.5]" />
            <span>+ NOVO PROMOTOR</span>
          </button>
        </div>
      </div>

      {/* 4 Indicadores Operacionais */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Ativos */}
        <div className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase text-gray-500 tracking-wider">
              PROMOTORES ATIVOS
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <UserCheck className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-gray-900">
              {indicators.totalAtivos}
            </span>
            <span className="text-[10px] font-bold text-emerald-700 uppercase">
              habilitados
            </span>
          </div>
        </div>

        {/* Offline */}
        <div className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase text-gray-500 tracking-wider">
              PROMOTORES OFFLINE
            </span>
            <div className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center">
              <WifiOff className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-gray-900">
              {indicators.totalOffline}
            </span>
            <span className="text-[10px] font-bold text-gray-500 uppercase">
              sem atividade
            </span>
          </div>
        </div>

        {/* Pendências */}
        <div className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase text-gray-500 tracking-wider">
              PENDÊNCIAS DE VÍNCULO
            </span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <Clock className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-amber-900">
              {indicators.pendenciasSincronizacao}
            </span>
            <span className="text-[10px] font-bold text-amber-700 uppercase">
              aguardando
            </span>
          </div>
        </div>

        {/* Ações Hoje */}
        <div className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase text-gray-500 tracking-wider">
              AÇÕES HOJE
            </span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
              <Activity className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-blue-900">
              {indicators.acoesHoje}
            </span>
            <span className="text-[10px] font-bold text-blue-700 uppercase">
              auditadas
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs (Promotores Cadastrados vs Auditoria) */}
      <div className="flex items-center justify-between border-b border-gray-200 pt-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('lista')}
            className={`pb-3 px-3 text-xs font-black uppercase tracking-wider border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'lista'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="w-4 h-4 stroke-[2.5]" />
            <span>Promotores Cadastrados ({promotores.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('auditoria')}
            className={`pb-3 px-3 text-xs font-black uppercase tracking-wider border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'auditoria'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History className="w-4 h-4 stroke-[2.5]" />
            <span>Auditoria de Operações</span>
          </button>
        </div>

        {/* Shortcut to generate vínculo for first pending promoter */}
        {promotores.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const pending = promotores.find((p) => p.status === 'PENDENTE_VINCULO') || promotores[0];
              if (pending) handleOpenGerarVinculo(pending);
            }}
            className="hidden sm:flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-blue-700 hover:text-blue-900 pb-3 cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Gerar Vínculo Rápido</span>
          </button>
        )}
      </div>

      {/* Tab: LISTA DE PROMOTORES */}
      {activeTab === 'lista' && (
        <div className="space-y-4">
          {/* Search and Filters Card */}
          <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative grow">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar promotor por nome, matrícula ou setor..."
                  className="w-full pl-9 pr-3.5 py-2 text-xs font-semibold rounded-xl border border-gray-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all bg-gray-50/50"
                />
              </div>

              <div className="flex items-center gap-2">
                {/* Filtro de Status */}
                <select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value)}
                  className="px-3 py-2 text-xs font-black uppercase rounded-xl border border-gray-200 bg-white text-gray-700 outline-hidden cursor-pointer"
                >
                  <option value="TODOS">Todos os Status</option>
                  <option value="ATIVO">Ativos</option>
                  <option value="PENDENTE_VINCULO">Pendentes de Vínculo</option>
                  <option value="OFFLINE">Offline</option>
                  <option value="BLOQUEADO">Bloqueados</option>
                </select>

                {/* Filtro de Setor */}
                <select
                  value={filtroSetor}
                  onChange={(e) => setFiltroSetor(e.target.value)}
                  className="px-3 py-2 text-xs font-black uppercase rounded-xl border border-gray-200 bg-white text-gray-700 outline-hidden cursor-pointer"
                >
                  <option value="TODOS">Todos os Setores</option>
                  {SETORES_DISPONIVEIS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Filter Chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {[
                { id: 'TODOS', label: 'Todos' },
                { id: 'ATIVO', label: 'Ativos' },
                { id: 'PENDENTE_VINCULO', label: 'Pendentes de Vínculo' },
                { id: 'OFFLINE', label: 'Offline' },
                { id: 'BLOQUEADO', label: 'Bloqueados' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => setFiltroStatus(chip.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                    filtroStatus === chip.id
                      ? 'bg-blue-700 text-white shadow-2xs'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {chip.label}
                </button>
              ))}

              {(filtroStatus !== 'TODOS' || filtroSetor !== 'TODOS' || searchQuery) && (
                <button
                  onClick={() => {
                    setFiltroStatus('TODOS');
                    setFiltroSetor('TODOS');
                    setSearchQuery('');
                  }}
                  className="ml-auto text-blue-700 hover:underline text-[11px] font-black uppercase flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Limpar
                </button>
              )}
            </div>
          </div>

          {/* List or Empty State */}
          {promotoresFiltrados.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 border border-gray-200 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto border border-blue-100">
                <Users className="w-7 h-7 stroke-[1.8]" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900 uppercase tracking-tight">
                  NENHUM PROMOTOR CADASTRADO
                </h3>
                <p className="text-xs text-gray-500 font-medium max-w-sm mx-auto mt-1">
                  Cadastre um promotor para começar a preparar o acesso ao aplicativo de campo.
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setIsCadastrarModalOpen(true)}
                  className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-black uppercase tracking-wider inline-flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 stroke-[2.5]" />
                  <span>+ CADASTRAR PROMOTOR</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {promotoresFiltrados.map((promotor) => {
                const online = promotorService.isPromotorOnline(promotor);

                return (
                  <div
                    key={promotor.promotorId}
                    className="bg-white rounded-2xl p-5 border border-gray-200 shadow-2xs hover:border-blue-400 hover:shadow-xs transition-all space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Promotor Info */}
                      <div className="flex items-start gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0 font-black text-sm">
                          {promotor.nome.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-black text-gray-900 uppercase">
                              {promotor.nome}
                            </h3>
                            {promotor.matricula && (
                              <span className="text-[10px] font-mono font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                                {promotor.matricula}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 font-medium mt-0.5">
                            <span>
                              Filial <strong>{promotor.filialId}</strong> ({promotor.filialNome})
                            </span>
                            <span>•</span>
                            <span>
                              Setor: <strong className="text-gray-800">{promotor.setorNome}</strong>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Status & Presence Badges */}
                      <div className="flex items-center gap-2 shrink-0">
                        {promotor.status === 'ATIVO' && (
                          <span className="text-xs font-black text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 uppercase">
                            ● ATIVO
                          </span>
                        )}
                        {promotor.status === 'PENDENTE_VINCULO' && (
                          <span className="text-xs font-black text-amber-800 bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-200 uppercase">
                            ● PENDENTE DE VÍNCULO
                          </span>
                        )}
                        {promotor.status === 'BLOQUEADO' && (
                          <span className="text-xs font-black text-rose-800 bg-rose-100 px-2.5 py-1 rounded-lg border border-rose-200 uppercase">
                            ● BLOQUEADO
                          </span>
                        )}
                        {promotor.status === 'DESVINCULADO' && (
                          <span className="text-xs font-black text-gray-700 bg-gray-200 px-2.5 py-1 rounded-lg border border-gray-300 uppercase">
                            ● DESVINCULADO
                          </span>
                        )}

                        {/* Online/Offline Pill */}
                        {online ? (
                          <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200 flex items-center gap-1 uppercase">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            ONLINE
                          </span>
                        ) : (
                          <span className="text-[11px] font-black text-gray-500 bg-gray-100 px-2 py-1 rounded-lg border border-gray-200 flex items-center gap-1 uppercase">
                            <span className="w-2 h-2 rounded-full bg-gray-400" />
                            OFFLINE
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Operational Details row */}
                    <div className="bg-gray-50/70 rounded-xl p-3 text-xs border border-gray-100 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Smartphone className="w-4 h-4 text-blue-700 shrink-0" />
                        {promotor.dispositivoVinculado ? (
                          <span>
                            Aparelho: <strong className="text-gray-900">{promotor.dispositivoVinculado.dispositivoNome}</strong>
                          </span>
                        ) : (
                          <span className="text-amber-800 font-bold">
                            Nenhum aparelho vinculado
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-gray-500 text-[11px]">
                        <span>
                          Cadastro: <strong className="text-gray-700">{new Date(promotor.dataCadastro).toLocaleDateString('pt-BR')}</strong>
                        </span>
                        {promotor.ultimoAcesso && (
                          <span>
                            Último acesso: <strong className="text-gray-700">{new Date(promotor.ultimoAcesso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-100">
                      <div className="flex items-center gap-2">
                        {/* Gerar Vínculo */}
                        <button
                          type="button"
                          onClick={() => handleOpenGerarVinculo(promotor)}
                          disabled={promotor.status === 'BLOQUEADO'}
                          className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
                        >
                          <QrCode className="w-3.5 h-3.5 text-blue-700 stroke-[2.5]" />
                          <span>Gerar Vínculo (QR/Código)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleVerAuditoriaDoPromotor(promotor)}
                          className="px-3 py-1.5 rounded-lg text-gray-700 hover:bg-gray-100 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5 text-gray-500" />
                          <span>Atividades</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenDetalhes(promotor)}
                        className="px-3.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Ver Detalhes e Permissões →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: AUDITORIA DE OPERAÇÕES */}
      {activeTab === 'auditoria' && (
        <AuditoriaPromotoresView
          filtroPromotorInicial={filtroPromotorAuditoria}
          onClearFiltroPromotor={() => setFiltroPromotorAuditoria(undefined)}
          promotores={promotores}
        />
      )}

      {/* Modals */}
      <CadastrarPromotorModal
        isOpen={isCadastrarModalOpen}
        onClose={() => setIsCadastrarModalOpen(false)}
        onPromotorCadastrado={handlePromotorCadastrado}
      />

      <GerarVinculoModal
        isOpen={isVinculoModalOpen}
        onClose={() => {
          setIsVinculoModalOpen(false);
          carregarDados();
        }}
        promotor={selectedPromotor}
        onSuccess={() => carregarDados()}
      />

      <DetalhePromotorModal
        isOpen={isDetalheModalOpen}
        onClose={() => {
          setIsDetalheModalOpen(false);
          carregarDados();
        }}
        promotor={selectedPromotor}
        onGerarVinculo={handleOpenGerarVinculo}
        onVerAuditoria={handleVerAuditoriaDoPromotor}
        onRefresh={() => carregarDados()}
      />
    </div>
  );
};
