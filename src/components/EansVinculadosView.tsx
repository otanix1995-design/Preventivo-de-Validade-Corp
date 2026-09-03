import {
  Barcode,
  CheckCircle2,
  Link2,
  Plus,
  Search,
  Trash2,
  Users,
  X
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { normalizeCodigoSMGO } from '../services/codeParser';
import { desvincularEan } from '../services/storage';
import { ProdutoSMG, VinculoEan } from '../types';
import { LimparDadosAntigosModal } from './LimparDadosAntigosModal';

interface EansVinculadosViewProps {
  vinculos: VinculoEan[];
  produtos: ProdutoSMG[];
  onSelectProdutoByCodigo: (codigoInterno: string) => void;
  onNavigateToImport: () => void;
  onOpenVincularModal?: (initialEan?: string, initialProduto?: ProdutoSMG | null) => void;
}

export const EansVinculadosView: React.FC<EansVinculadosViewProps> = ({
  vinculos,
  produtos,
  onSelectProdutoByCodigo,
  onNavigateToImport,
  onOpenVincularModal,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('TODOS');
  const [isLimparModalOpen, setIsLimparModalOpen] = useState(false);

  const { produtosPorCodigo, produtosPorChave } = useMemo(() => {
    const mapCod = new Map<string, ProdutoSMG>();
    const mapChave = new Map<string, ProdutoSMG>();
    produtos.forEach((p) => {
      const norm = normalizeCodigoSMGO(p.codigo_original || p.codigo_exibicao || p.codigo_interno, p.digito);
      mapCod.set(norm.codigoInterno, p);
      if (norm.chaveNormalizada) mapChave.set(norm.chaveNormalizada, p);
      mapCod.set(p.codigo_interno, p);
    });
    return { produtosPorCodigo: mapCod, produtosPorChave: mapChave };
  }, [produtos]);

  // Dynamic counts
  const totalImportados = vinculos.length;
  const totalVinculados = vinculos.filter((v) => v.status_vinculo === 'VINCULADO').length;
  const totalAguardandoBase = vinculos.filter((v) => v.status_vinculo === 'AGUARDANDO_BASE').length;
  const totalNaoEncontrados = vinculos.filter((v) => v.status_vinculo === 'CODIGO_NAO_ENCONTRADO').length;
  const totalDuplicados = vinculos.filter((v) => v.status_vinculo === 'DUPLICADO').length;

  const filtrados = useMemo(() => {
    return vinculos.filter((v) => {
      // Status filter
      if (filterStatus !== 'TODOS' && v.status_vinculo !== filterStatus) {
        return false;
      }

      // Search query
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toUpperCase();
        const eanMatch = v.ean.includes(q);
        const codMatch = v.codigo_interno.includes(q);
        const descMatch = (v.descricao || '').toUpperCase().includes(q);
        return eanMatch || codMatch || descMatch;
      }

      return true;
    });
  }, [vinculos, filterStatus, searchTerm]);

  return (
    <div id="view-eans-vinculados" className="space-y-4 pb-24 max-w-4xl mx-auto">
      {/* Top Header & Summary Card with Bold Typography */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 space-y-3 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-700" />

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center border border-blue-200">
              <Users className="w-5 h-5 text-blue-700 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight text-gray-900 leading-tight">
                EANs VINCULADOS
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Cruzamento operacional pelo Código Interno
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenVincularModal && (
              <button
                type="button"
                onClick={() => onOpenVincularModal()}
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black uppercase tracking-wider text-xs shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                title="Cadastrar novo vínculo manual entre EAN e código interno"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                <span className="hidden sm:inline">Vincular Novo EAN</span>
                <span className="sm:hidden">Vincular</span>
              </button>
            )}

            <button
              onClick={() => setIsLimparModalOpen(true)}
              className="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
              title="Limpar Vínculos Órfãos e Dados Antigos"
            >
              <Trash2 className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden sm:inline">Limpar Antigos</span>
            </button>

            <button
              onClick={onNavigateToImport}
              className="px-3.5 py-2 rounded-lg bg-blue-700 text-white font-black uppercase tracking-wider text-xs shadow-xs hover:bg-blue-800 transition-colors cursor-pointer"
            >
              Importar EANs
            </button>
          </div>
        </div>

        {/* Dynamic Metric Cards with left colored borders */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
          <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-200">
            <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider">Total</span>
            <strong className="text-xl font-black font-mono text-gray-900">{totalImportados}</strong>
          </div>
          <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
            <span className="text-[10px] text-emerald-800 font-bold block uppercase tracking-wider">Vinculados</span>
            <strong className="text-xl font-black font-mono text-emerald-700">{totalVinculados}</strong>
          </div>
          <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
            <span className="text-[10px] text-amber-800 font-bold block uppercase tracking-wider">
              {totalAguardandoBase > 0 ? 'Aguardando Base' : 'Não Localiz.'}
            </span>
            <strong className="text-xl font-black font-mono text-amber-800">
              {totalAguardandoBase > 0 ? totalAguardandoBase : totalNaoEncontrados}
            </strong>
          </div>
          <div className="bg-purple-50 p-2.5 rounded-xl border border-purple-200">
            <span className="text-[10px] text-purple-800 font-bold block uppercase tracking-wider">Duplicados</span>
            <strong className="text-xl font-black font-mono text-purple-800">{totalDuplicados}</strong>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3 stroke-[2.5]" />
          <input
            id="input-busca-eans"
            type="text"
            placeholder="Buscar por EAN, código interno ou descrição..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 focus:border-blue-700 focus:bg-white rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-gray-900 focus:outline-hidden transition-all shadow-2xs"
          />
        </div>

        {/* Status Filter Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
          {[
            { id: 'TODOS', label: 'Todos' },
            { id: 'VINCULADO', label: 'Vinculados' },
            ...(totalAguardandoBase > 0 ? [{ id: 'AGUARDANDO_BASE', label: 'Aguardando Base' }] : []),
            { id: 'CODIGO_NAO_ENCONTRADO', label: 'Não Encontrados' },
            { id: 'DUPLICADO', label: 'Duplicados' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all select-none ${
                filterStatus === tab.id
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* EAN List */}
      <div className="space-y-2.5">
        {filtrados.length === 0 ? (
          <div className="bg-white rounded-xl p-8 border border-gray-200 text-center space-y-2">
            <Barcode className="w-10 h-10 text-gray-400 mx-auto stroke-[2]" />
            <p className="text-xs font-black text-gray-700 uppercase tracking-wide">
              Nenhum vínculo EAN encontrado com os filtros atuais.
            </p>
          </div>
        ) : (
          filtrados.map((v) => {
            const normV = normalizeCodigoSMGO(v.codigo_interno, v.digito);
            const prod = (normV.chaveNormalizada && produtosPorChave.get(normV.chaveNormalizada)) ||
                         produtosPorCodigo.get(normV.codigoInterno) ||
                         produtosPorCodigo.get(v.codigo_interno);
            const isVinculado = v.status_vinculo === 'VINCULADO' && !!prod;

            return (
              <div
                key={v.id}
                onClick={() => {
                  if (prod) onSelectProdutoByCodigo(prod.codigo_interno);
                }}
                className={`bg-white rounded-xl p-4 border transition-all ${
                  prod ? 'border-gray-200 hover:border-blue-500 cursor-pointer shadow-xs active:scale-[0.99]' : 'border-gray-200 opacity-90'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-black text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 flex items-center gap-1">
                        <Barcode className="w-3.5 h-3.5 text-blue-700 stroke-[2.5]" />
                        {v.ean}
                      </span>
                      <span className="text-xs font-mono text-gray-700 font-bold">
                        CÓD: <strong>{v.codigo_interno}</strong>
                        {v.digito ? `-${v.digito}` : ''}
                      </span>
                    </div>

                    <h4 className="text-sm font-black text-gray-900 mt-1.5 leading-snug uppercase">
                      {prod?.descricao || v.descricao || 'Descrição não vinculada'}
                    </h4>
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 ${
                      isVinculado
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : v.status_vinculo === 'AGUARDANDO_BASE'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : v.status_vinculo === 'CODIGO_NAO_ENCONTRADO'
                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                        : 'bg-purple-100 text-purple-800 border border-purple-200'
                    }`}
                  >
                    {isVinculado
                      ? 'VINCULADO'
                      : v.status_vinculo === 'AGUARDANDO_BASE'
                      ? 'AGUARDANDO BASE'
                      : v.status_vinculo === 'CODIGO_NAO_ENCONTRADO'
                      ? 'CÓDIGO NÃO LOCALIZADO'
                      : 'DUPLICADO'}
                  </span>
                </div>

                {prod ? (
                  <div className="flex items-center justify-between text-xs pt-2 mt-2 border-t border-gray-100 text-gray-500 font-medium">
                    <span>Estoque: <strong className="text-gray-900 font-mono font-bold">{prod.estoque_total} un</strong> ({prod.embalagem})</span>
                    <div className="flex items-center gap-2">
                      {onOpenVincularModal && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenVincularModal(v.ean, prod);
                          }}
                          className="text-[11px] font-bold text-slate-600 hover:text-blue-700 uppercase"
                        >
                          Alterar
                        </button>
                      )}
                      <span className="text-blue-700 font-black uppercase text-[11px] tracking-wider">Abrir Cadastro →</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs pt-2 mt-2 border-t border-gray-100 text-gray-500 font-medium">
                    <span className="text-[11px] text-amber-800 font-medium">
                      {v.status_vinculo === 'AGUARDANDO_BASE'
                        ? 'Aguardando importação da planilha SMGOI013'
                        : 'Código interno não encontrado na base'}
                    </span>
                    {onOpenVincularModal && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenVincularModal(v.ean);
                        }}
                        className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-[11px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Link2 className="w-3 h-3" />
                        <span>Vincular a Produto</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal Limpar Dados Antigos */}
      <LimparDadosAntigosModal
        isOpen={isLimparModalOpen}
        onClose={() => setIsLimparModalOpen(false)}
        initialPreset="TUDO"
      />
    </div>
  );
};
