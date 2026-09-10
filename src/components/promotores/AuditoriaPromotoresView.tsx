import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  Filter,
  History,
  RotateCcw,
  Search,
  ShieldAlert,
  Smartphone,
  User
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { promotorService } from '../../services/promotorService';
import {
  Promotor,
  RegistroAuditoriaPromotor,
  StatusSincronizacaoAuditoria,
  TipoAcaoAuditoria
} from '../../types';

interface AuditoriaPromotoresViewProps {
  filtroPromotorInicial?: string;
  onClearFiltroPromotor?: () => void;
  promotores: Promotor[];
}

export const AuditoriaPromotoresView: React.FC<AuditoriaPromotoresViewProps> = ({
  filtroPromotorInicial,
  onClearFiltroPromotor,
  promotores,
}) => {
  const [promotorFiltro, setPromotorFiltro] = useState<string>(filtroPromotorInicial || 'TODOS');
  const [tipoAcaoFiltro, setTipoAcaoFiltro] = useState<string>('TODOS');
  const [statusFiltro, setStatusFiltro] = useState<string>('TODOS');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 10;

  const todasAuditorias = promotorService.getAuditorias();

  const auditoriasFiltradas = useMemo(() => {
    return todasAuditorias.filter((reg) => {
      if (promotorFiltro !== 'TODOS' && reg.promotorId !== promotorFiltro) {
        return false;
      }
      if (tipoAcaoFiltro !== 'TODOS' && reg.tipoAcao !== tipoAcaoFiltro) {
        return false;
      }
      if (statusFiltro !== 'TODOS' && reg.statusSincronizacao !== statusFiltro) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNome = reg.promotorNome?.toLowerCase().includes(q);
        const matchAgencia = reg.agenciaNome?.toLowerCase().includes(q);
        const matchDesc = reg.descricao?.toLowerCase().includes(q);
        const matchCod = reg.codigoInterno?.includes(q);
        const matchVal = reg.valorNovo?.toLowerCase().includes(q);
        if (!matchNome && !matchAgencia && !matchDesc && !matchCod && !matchVal) {
          return false;
        }
      }
      return true;
    });
  }, [todasAuditorias, promotorFiltro, tipoAcaoFiltro, statusFiltro, searchQuery]);

  const totalPaginas = Math.ceil(auditoriasFiltradas.length / ITENS_POR_PAGINA) || 1;
  const auditoriasPaginadas = useMemo(() => {
    const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
    return auditoriasFiltradas.slice(inicio, inicio + ITENS_POR_PAGINA);
  }, [auditoriasFiltradas, paginaAtual]);

  const formatarDataHora = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}`;
    } catch {
      return iso;
    }
  };

  const getAcaoBadge = (tipo: TipoAcaoAuditoria) => {
    switch (tipo) {
      case 'CADASTROU_VENCIMENTO':
        return (
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200">
            Cadastrou Vencimento
          </span>
        );
      case 'ATUALIZOU_QUANTIDADE':
        return (
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200">
            Atualizou Quantidade
          </span>
        );
      case 'ENVIOU_COMPRADOR':
        return (
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
            Enviou ao Comprador
          </span>
        );
      case 'CONSULTOU_PRODUTO':
        return (
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
            Consultou Produto
          </span>
        );
      case 'SINCRONIZOU_ALTERACAO':
        return (
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200">
            Sincronizou Alteração
          </span>
        );
      case 'REMOVEU_ENVIO_COMPRADOR':
        return (
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-gray-100 text-gray-800 border border-gray-200">
            Removeu Envio Comprador
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-gray-100 text-gray-800">
            {tipo}
          </span>
        );
    }
  };

  const getStatusSyncBadge = (st: StatusSincronizacaoAuditoria) => {
    if (st === 'SINCRONIZADO') {
      return (
        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1 uppercase">
          <CheckCircle className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
          Sincronizado
        </span>
      );
    }
    if (st === 'PENDENTE') {
      return (
        <span className="text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 flex items-center gap-1 uppercase">
          <Clock className="w-3 h-3 text-amber-600 stroke-[2.5]" />
          Pendente
        </span>
      );
    }
    return (
      <span className="text-[10px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 flex items-center gap-1 uppercase">
        <AlertCircle className="w-3 h-3 text-rose-600 stroke-[2.5]" />
        Erro
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative grow">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPaginaAtual(1);
              }}
              placeholder="Pesquisar por promotor, produto ou código..."
              className="w-full pl-9 pr-3.5 py-2 text-xs font-semibold rounded-xl border border-gray-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all bg-gray-50/50"
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Filtro Promotor */}
            <select
              value={promotorFiltro}
              onChange={(e) => {
                setPromotorFiltro(e.target.value);
                setPaginaAtual(1);
              }}
              className="px-3 py-2 text-xs font-black uppercase rounded-xl border border-gray-200 bg-white text-gray-700 outline-hidden cursor-pointer"
            >
              <option value="TODOS">Todos os Promotores</option>
              {promotores.map((p) => (
                <option key={p.promotorId} value={p.promotorId}>
                  {p.nome}
                </option>
              ))}
            </select>

            {/* Filtro Ação */}
            <select
              value={tipoAcaoFiltro}
              onChange={(e) => {
                setTipoAcaoFiltro(e.target.value);
                setPaginaAtual(1);
              }}
              className="px-3 py-2 text-xs font-black uppercase rounded-xl border border-gray-200 bg-white text-gray-700 outline-hidden cursor-pointer"
            >
              <option value="TODOS">Todas as Ações</option>
              <option value="CADASTROU_VENCIMENTO">Cadastrou Vencimento</option>
              <option value="ATUALIZOU_QUANTIDADE">Atualizou Quantidade</option>
              <option value="ENVIOU_COMPRADOR">Enviou ao Comprador</option>
              <option value="CONSULTOU_PRODUTO">Consultou Produto</option>
              <option value="SINCRONIZOU_ALTERACAO">Sincronizou Alteração</option>
            </select>
          </div>
        </div>

        {/* Active Filter Indicators */}
        {(promotorFiltro !== 'TODOS' || tipoAcaoFiltro !== 'TODOS' || statusFiltro !== 'TODOS' || searchQuery) && (
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
            <span className="text-gray-500 font-medium">
              Filtrando {auditoriasFiltradas.length} registro(s) de auditoria
            </span>
            <button
              onClick={() => {
                setPromotorFiltro('TODOS');
                setTipoAcaoFiltro('TODOS');
                setStatusFiltro('TODOS');
                setSearchQuery('');
                setPaginaAtual(1);
                if (onClearFiltroPromotor) onClearFiltroPromotor();
              }}
              className="text-blue-700 hover:underline font-black uppercase flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Limpar Filtros
            </button>
          </div>
        )}
      </div>

      {/* Auditoria Logs List */}
      {auditoriasPaginadas.length === 0 ? (
        <div className="bg-white rounded-xl p-8 border border-gray-200 text-center space-y-2">
          <History className="w-10 h-10 text-gray-300 mx-auto stroke-[1.5]" />
          <h3 className="text-sm font-black text-gray-800 uppercase tracking-tight">
            Nenhuma atividade registrada
          </h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto font-medium">
            As ações de consulta, cadastros, alterações de quantidade e sincronizações dos promotores serão auditadas e listadas aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {auditoriasPaginadas.map((item) => (
            <div
              key={item.auditoriaId}
              className="bg-white rounded-xl p-4 border border-gray-200 shadow-2xs hover:border-blue-300 transition-all space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-xs font-black text-gray-900 uppercase">
                        {item.promotorNome}
                      </h4>
                      {item.agenciaNome && (
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          {item.agenciaNome}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-gray-500">
                      Filial {item.filialId} • Setor {item.setores ? item.setores.join(' • ') : item.setorId}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {getAcaoBadge(item.tipoAcao)}
                  {getStatusSyncBadge(item.statusSincronizacao)}
                </div>
              </div>

              {/* Action specific details */}
              <div className="bg-gray-50/70 rounded-lg p-2.5 text-xs border border-gray-100 space-y-1">
                {item.descricao && (
                  <p className="font-bold text-gray-900">
                    {item.codigoInterno && (
                      <span className="font-mono text-blue-900 mr-1.5">
                        [{item.codigoInterno}{item.digito ? `-${item.digito}` : ''}]
                      </span>
                    )}
                    {item.descricao}
                  </p>
                )}

                {item.valorNovo && (
                  <p className="text-gray-600 text-[11px] font-medium break-all">
                    {item.valorNovo}
                  </p>
                )}
              </div>

              {/* Timestamp & metadata footer */}
              <div className="flex items-center justify-between text-[11px] text-gray-400 font-medium pt-1">
                <span className="flex items-center gap-1 font-mono">
                  <Calendar className="w-3 h-3" />
                  {formatarDataHora(item.dataHora)}
                </span>
                {item.operationId && (
                  <span className="font-mono text-[10px] text-gray-400">
                    OP: {item.operationId.slice(-8)}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Pagination Controls */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-gray-200">
              <span className="text-xs font-medium text-gray-500">
                Página <strong className="text-gray-900">{paginaAtual}</strong> de <strong className="text-gray-900">{totalPaginas}</strong>
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={paginaAtual <= 1}
                  onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-black uppercase text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={paginaAtual >= totalPaginas}
                  onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-black uppercase text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
