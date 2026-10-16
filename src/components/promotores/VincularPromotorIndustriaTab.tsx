import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Filter,
  Layers,
  Link,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unlink,
  UserCheck,
  Users
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { isvService } from '../../services/isvService';
import { Industria, Promotor, VinculoPromotorIndustria } from '../../types';

interface VincularPromotorIndustriaTabProps {
  promotores: Promotor[];
}

export const VincularPromotorIndustriaTab: React.FC<VincularPromotorIndustriaTabProps> = ({
  promotores,
}) => {
  const [selectedPromotorId, setSelectedPromotorId] = useState<string>('');
  const [searchPromotor, setSearchPromotor] = useState('');
  const [searchIndustria, setSearchIndustria] = useState('');
  const [filtroPromotores, setFiltroPromotores] = useState<'TODOS' | 'COM_VINCULO' | 'SEM_VINCULO'>('TODOS');
  const [filtroIndustrias, setFiltroIndustrias] = useState<'TODAS' | 'COM_PROMOTOR' | 'SEM_PROMOTOR'>('TODAS');
  const [feedback, setFeedback] = useState<{ tipo: 'success' | 'error'; msg: string } | null>(null);

  const industrias = isvService.getIndustrias();
  const vinculos = isvService.getVinculosPromotorIndustria();

  const selectedPromotor = useMemo(() => {
    return promotores.find((p) => p.promotorId === selectedPromotorId) || null;
  }, [promotores, selectedPromotorId]);

  // Vínculos do promotor atualmente selecionado
  const cnpjsVinculadosAoPromotor = useMemo(() => {
    if (!selectedPromotorId) return new Set<string>();
    return new Set(
      vinculos
        .filter((v) => v.promotorId === selectedPromotorId)
        .map((v) => v.cnpj)
    );
  }, [vinculos, selectedPromotorId]);

  // Promotores filtrados
  const promotoresFiltrados = useMemo(() => {
    return promotores.filter((p) => {
      // Filtro de situação de vínculo
      const temVinculo = vinculos.some((v) => v.promotorId === p.promotorId);
      if (filtroPromotores === 'COM_VINCULO' && !temVinculo) return false;
      if (filtroPromotores === 'SEM_VINCULO' && temVinculo) return false;

      // Busca por nome ou agência
      if (searchPromotor.trim()) {
        const q = searchPromotor.toLowerCase().trim();
        const matchNome = p.nome.toLowerCase().includes(q);
        const matchAgencia = (p.agenciaNome || '').toLowerCase().includes(q);
        return matchNome || matchAgencia;
      }
      return true;
    });
  }, [promotores, vinculos, filtroPromotores, searchPromotor]);

  // Indústrias filtradas
  const industriasFiltradas = useMemo(() => {
    return industrias.filter((ind) => {
      const temPromotor = vinculos.some((v) => v.cnpj === ind.cnpj);
      if (filtroIndustrias === 'COM_PROMOTOR' && !temPromotor) return false;
      if (filtroIndustrias === 'SEM_PROMOTOR' && temPromotor) return false;

      if (searchIndustria.trim()) {
        const q = searchIndustria.toLowerCase().trim();
        const matchNome = (ind.nome_exibicao || '').toLowerCase().includes(q);
        const matchRazao = (ind.razao_social || '').toLowerCase().includes(q);
        const matchCnpj = ind.cnpj.includes(q) || (ind.cnpj_formatado || '').includes(q);
        return matchNome || matchRazao || matchCnpj;
      }
      return true;
    });
  }, [industrias, vinculos, filtroIndustrias, searchIndustria]);

  const handleToggleVinculo = async (industria: Industria) => {
    if (!selectedPromotor) {
      setFeedback({
        tipo: 'error',
        msg: 'Selecione primeiro um promotor na coluna da esquerda.',
      });
      setTimeout(() => setFeedback(null), 3500);
      return;
    }

    const estaVinculado = cnpjsVinculadosAoPromotor.has(industria.cnpj);

    try {
      if (estaVinculado) {
        await isvService.desvincularPromotorIndustria(
          selectedPromotor.promotorId,
          industria.cnpj,
          selectedPromotor.filialId || '172'
        );
        setFeedback({
          tipo: 'success',
          msg: `Indústria "${industria.nome_exibicao}" desvinculada de ${selectedPromotor.nome}.`,
        });
      } else {
        await isvService.vincularPromotorIndustria(
          selectedPromotor,
          industria.cnpj,
          selectedPromotor.filialId || '172'
        );
        setFeedback({
          tipo: 'success',
          msg: `Indústria "${industria.nome_exibicao}" vinculada a ${selectedPromotor.nome} com sucesso!`,
        });
      }
    } catch (err: any) {
      setFeedback({
        tipo: 'error',
        msg: `Erro na operação: ${err.message || 'Falha ao vincular'}`,
      });
    }

    setTimeout(() => setFeedback(null), 3500);
  };

  // Carteira de produtos calculada on-the-fly para o promotor selecionado
  const totalProdutosCarteira = useMemo(() => {
    if (!selectedPromotorId) return 0;
    const cnpjs = Array.from(cnpjsVinculadosAoPromotor);
    return industrias
      .filter((i) => cnpjs.includes(i.cnpj))
      .reduce((acc, i) => acc + (i.total_produtos_loja || 0), 0);
  }, [selectedPromotorId, cnpjsVinculadosAoPromotor, industrias]);

  return (
    <div className="space-y-4">
      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 animate-fadeIn ${
            feedback.tipo === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.tipo === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedback.msg}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Regra de Ouro / Banner Informativo */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-xs text-blue-900 flex items-start gap-3">
        <Building2 className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-black text-sm">
            VINCULAÇÃO PROMOTOR ↔ INDÚSTRIA (POR CNPJ NORMALIZADO)
          </p>
          <p className="text-blue-800 leading-relaxed font-medium">
            A hierarquia operacional segue estritamente: <strong>Agência → Promotor → CNPJ da Indústria → Produtos</strong>.
            Ao vincular uma indústria ao promotor, sua carteira de produtos da filial é calculada automaticamente a partir da base SMGOI013 e SPCOI007.
          </p>
        </div>
      </div>

      {/* Grid Principal: Promotores (Esquerda) e Indústrias (Direita) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* COLUNA 1: SELETOR DE PROMOTORES (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-2xs p-4 space-y-3 flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              <h3 className="text-xs font-black uppercase text-slate-800">
                1. Selecione o Promotor
              </h3>
            </div>
            <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
              {promotoresFiltrados.length} Promotores
            </span>
          </div>

          {/* Busca de Promotor */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Buscar promotor ou agência..."
              value={searchPromotor}
              onChange={(e) => setSearchPromotor(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden"
            />
          </div>

          {/* Filtros Rápidos de Promotores */}
          <div className="flex items-center gap-1 text-[10px] font-bold">
            <button
              onClick={() => setFiltroPromotores('TODOS')}
              className={`px-2 py-1 rounded-md transition-colors ${
                filtroPromotores === 'TODOS'
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFiltroPromotores('COM_VINCULO')}
              className={`px-2 py-1 rounded-md transition-colors ${
                filtroPromotores === 'COM_VINCULO'
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Com Indústria
            </button>
            <button
              onClick={() => setFiltroPromotores('SEM_VINCULO')}
              className={`px-2 py-1 rounded-md transition-colors ${
                filtroPromotores === 'SEM_VINCULO'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Sem Indústria
            </button>
          </div>

          {/* Lista de Promotores */}
          <div className="overflow-y-auto max-h-[460px] space-y-2 pr-1">
            {promotoresFiltrados.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs font-medium">
                Nenhum promotor encontrado com os filtros aplicados.
              </div>
            ) : (
              promotoresFiltrados.map((p) => {
                const isSelected = p.promotorId === selectedPromotorId;
                const totalInds = vinculos.filter((v) => v.promotorId === p.promotorId).length;

                return (
                  <div
                    key={p.promotorId}
                    onClick={() => setSelectedPromotorId(p.promotorId)}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-blue-50/80 border-blue-600 shadow-sm ring-1 ring-blue-600'
                        : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-black text-slate-900 uppercase">
                            {p.nome}
                          </h4>
                          {isSelected && (
                            <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.2 rounded uppercase">
                              Ativo
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-medium">
                          Agência: <strong className="text-slate-700 font-semibold">{p.agenciaNome || 'Não informada'}</strong>
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            totalInds > 0
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {totalInds} {totalInds === 1 ? 'Indústria' : 'Indústrias'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* COLUNA 2: INDÚSTRIAS DISPONÍVEIS E VINCULAÇÃO (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-2xs p-4 space-y-3 flex flex-col">
          {/* Header da Coluna com Status do Promotor Selecionado */}
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-600 stroke-[2.5]" />
                <h3 className="text-xs font-black uppercase text-slate-800">
                  2. Indústrias & CNPJs Cadastrados
                </h3>
              </div>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                {selectedPromotor ? (
                  <>
                    Vinculando a: <strong className="text-blue-700 font-bold">{selectedPromotor.nome}</strong> ({selectedPromotor.agenciaNome})
                  </>
                ) : (
                  'Selecione um promotor ao lado para gerenciar seus vínculos.'
                )}
              </p>
            </div>

            {selectedPromotor && (
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="bg-blue-100 text-blue-900 px-2 py-0.5 rounded font-bold border border-blue-200">
                  {cnpjsVinculadosAoPromotor.size} Indústrias
                </span>
                <span className="bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded font-bold border border-emerald-200">
                  {totalProdutosCarteira} Produtos na Loja
                </span>
              </div>
            )}
          </div>

          {/* Busca de Indústria */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por Nome Comercial, Razão Social ou CNPJ..."
                value={searchIndustria}
                onChange={(e) => setSearchIndustria(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-hidden"
              />
            </div>

            {/* Filtro Indústrias */}
            <div className="flex items-center gap-1 text-[10px] font-bold">
              <button
                onClick={() => setFiltroIndustrias('TODAS')}
                className={`px-2 py-1.5 rounded-md transition-colors ${
                  filtroIndustrias === 'TODAS'
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Todas
              </button>
              <button
                onClick={() => setFiltroIndustrias('SEM_PROMOTOR')}
                className={`px-2 py-1.5 rounded-md transition-colors ${
                  filtroIndustrias === 'SEM_PROMOTOR'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title="Indústrias que ainda não possuem nenhum promotor responsável"
              >
                Sem Promotor
              </button>
            </div>
          </div>

          {/* Lista de Indústrias com Check/Ação de Vínculo */}
          <div className="overflow-y-auto max-h-[460px] space-y-2.5 pr-1">
            {industriasFiltradas.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs font-medium space-y-1">
                <AlertCircle className="w-6 h-6 text-slate-300 mx-auto" />
                <p>Nenhuma indústria cadastrada ou encontrada com os filtros.</p>
                <p className="text-[11px] text-slate-500">
                  Importe a planilha SPCOI007 na aba de importação para carregar o catálogo de fornecedores.
                </p>
              </div>
            ) : (
              industriasFiltradas.map((ind) => {
                const estaVinculadoAoSelecionado = cnpjsVinculadosAoPromotor.has(ind.cnpj);
                const todosPromotoresDestaIndustria = vinculos
                  .filter((v) => v.cnpj === ind.cnpj)
                  .map((v) => v.promotorNome);

                return (
                  <div
                    key={ind.cnpj}
                    className={`p-3.5 rounded-xl border text-xs transition-all ${
                      estaVinculadoAoSelecionado
                        ? 'bg-emerald-50/60 border-emerald-400 shadow-2xs'
                        : 'bg-white hover:bg-slate-50/80 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-black text-slate-900 text-sm uppercase">
                            {ind.nome_exibicao || ind.razao_social}
                          </h4>
                          <span className="font-mono text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                            CNPJ: {ind.cnpj_formatado || ind.cnpj}
                          </span>
                          <span className="font-mono text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                            {ind.total_produtos_loja || 0} PRODUTOS
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-500 font-medium">
                          Razão Social: <span className="text-slate-700 font-semibold">{ind.razao_social}</span>
                        </p>

                        {/* Promotores que já atendem esta indústria */}
                        <div className="pt-1 flex items-center gap-1.5 flex-wrap text-[10px]">
                          <span className="text-slate-400 font-bold uppercase">Promotores:</span>
                          {todosPromotoresDestaIndustria.length > 0 ? (
                            todosPromotoresDestaIndustria.map((nome, nIdx) => (
                              <span
                                key={nIdx}
                                className={`px-1.5 py-0.2 rounded font-bold ${
                                  selectedPromotor && selectedPromotor.nome === nome
                                    ? 'bg-emerald-200 text-emerald-950 border border-emerald-400'
                                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                                }`}
                              >
                                {nome}
                              </span>
                            ))
                          ) : (
                            <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                              Nenhum promotor vinculado
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Botão de Ação: Vincular / Desvincular */}
                      <div className="shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleToggleVinculo(ind)}
                          disabled={!selectedPromotor}
                          className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                            !selectedPromotor
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                              : estaVinculadoAoSelecionado
                              ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-300'
                              : 'bg-blue-700 hover:bg-blue-800 text-white shadow-2xs active:scale-95'
                          }`}
                          title={
                            !selectedPromotor
                              ? 'Selecione um promotor ao lado primeiro'
                              : estaVinculadoAoSelecionado
                              ? 'Remover vínculo deste promotor'
                              : 'Vincular esta indústria ao promotor selecionado'
                          }
                        >
                          {estaVinculadoAoSelecionado ? (
                            <>
                              <Unlink className="w-3.5 h-3.5" />
                              <span>Desvincular</span>
                            </>
                          ) : (
                            <>
                              <Link className="w-3.5 h-3.5" />
                              <span>Vincular</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
