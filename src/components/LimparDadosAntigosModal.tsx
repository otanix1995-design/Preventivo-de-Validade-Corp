import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  History,
  Layers,
  Sparkles,
  Trash2,
  Unlink,
  X
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import {
  clearDadosAntigos,
  getDivergencias,
  getHistoricoImportacoes,
  getVencimentos,
  getVinculosEan,
  OpcoesLimpezaDados,
  ResultadoLimpezaDados
} from '../services/storage';

interface LimparDadosAntigosModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPreset?: 'VENCIDOS' | 'HISTORICO' | 'TUDO';
  onCompleted?: (resultado: ResultadoLimpezaDados) => void;
}

export const LimparDadosAntigosModal: React.FC<LimparDadosAntigosModalProps> = ({
  isOpen,
  onClose,
  initialPreset = 'VENCIDOS',
  onCompleted,
}) => {
  const [limparLotes, setLimparLotes] = useState(true);
  const [diasMargemLotes, setDiasMargemLotes] = useState<number>(
    initialPreset === 'VENCIDOS' ? 0 : 0
  );
  const [limparHistorico, setLimparHistorico] = useState(initialPreset === 'HISTORICO');
  const [limparDivergencias, setLimparDivergencias] = useState(false);
  const [limparVinculosOrfaos, setLimparVinculosOrfaos] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLimpezaDados | null>(null);

  // Live count computations
  const lotes = getVencimentos();
  const historico = getHistoricoImportacoes();
  const divergencias = getDivergencias();
  const vinculos = getVinculosEan();

  const hojeStr = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0];
  }, []);

  const d15Str = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 15);
    return d.toISOString().split('T')[0];
  }, []);

  const d30Str = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);

  const countLotesVencidosHoje = useMemo(() => {
    return lotes.filter((l) => l.data_validade < hojeStr).length;
  }, [lotes, hojeStr]);

  const countLotesVencidos15 = useMemo(() => {
    return lotes.filter((l) => l.data_validade <= d15Str).length;
  }, [lotes, d15Str]);

  const countLotesVencidos30 = useMemo(() => {
    return lotes.filter((l) => l.data_validade <= d30Str).length;
  }, [lotes, d30Str]);

  const countVinculosOrfaos = useMemo(() => {
    return vinculos.filter((v) => v.status_vinculo !== 'VINCULADO').length;
  }, [vinculos]);

  if (!isOpen) return null;

  const handleExecutarLimpeza = async () => {
    const opcoes: OpcoesLimpezaDados = {
      limparLotesVencidos: limparLotes,
      diasMargemLotes,
      limparHistoricoImportacoes: limparHistorico,
      limparDivergencias,
      limparVinculosOrfaos,
    };

    const res = await clearDadosAntigos(opcoes);
    setResultado(res);
    setIsSuccess(true);
    if (onCompleted) {
      onCompleted(res);
    }
  };

  const handleClose = () => {
    setIsSuccess(false);
    setResultado(null);
    onClose();
  };

  const hasAnySelected =
    limparLotes || limparHistorico || limparDivergencias || limparVinculosOrfaos;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div
        id="modal-limpar-dados-antigos"
        className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-gray-200 animate-scale-up"
      >
        {/* Header */}
        <div className="bg-linear-to-r from-red-800 to-rose-700 p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <Trash2 className="w-5 h-5 text-white stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-base font-black uppercase tracking-tight">
                Limpar Dados Antigos
              </h3>
              <p className="text-xs text-rose-100 font-medium">
                Remova registros expirados, histórico e divergências
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {isSuccess && resultado ? (
            <div className="space-y-4 py-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto stroke-[2.5]" />
                <h4 className="text-sm font-black text-emerald-900 uppercase">
                  Limpeza Realizada com Sucesso!
                </h4>
                <p className="text-xs text-emerald-700">
                  Os dados selecionados foram limpos e a base local foi atualizada.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <span className="text-[10px] text-gray-500 font-bold uppercase block">
                    Lotes Removidos
                  </span>
                  <strong className="text-lg font-mono font-black text-gray-900">
                    {resultado.lotesRemovidos}
                  </strong>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <span className="text-[10px] text-gray-500 font-bold uppercase block">
                    Histórico Limpo
                  </span>
                  <strong className="text-lg font-mono font-black text-gray-900">
                    {resultado.historicoRemovido}
                  </strong>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <span className="text-[10px] text-gray-500 font-bold uppercase block">
                    Divergências Limpas
                  </span>
                  <strong className="text-lg font-mono font-black text-gray-900">
                    {resultado.divergenciasRemovidas}
                  </strong>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <span className="text-[10px] text-gray-500 font-bold uppercase block">
                    Vínculos Órfãos
                  </span>
                  <strong className="text-lg font-mono font-black text-gray-900">
                    {resultado.vinculosOrfaosRemovidos}
                  </strong>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="w-full py-3 bg-gray-900 hover:bg-black text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-sm"
              >
                Concluir e Fechar
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-600 font-medium">
                Selecione quais categorias de registros antigos ou finalizados deseja remover da base local:
              </p>

              {/* Option 1: Lotes Vencidos */}
              <div
                className={`p-4 rounded-xl border transition-all ${
                  limparLotes
                    ? 'bg-rose-50/50 border-rose-300 shadow-2xs'
                    : 'bg-gray-50 border-gray-200 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={limparLotes}
                      onChange={(e) => setLimparLotes(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-red-600 border-gray-300 focus:ring-red-500"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-rose-700 stroke-[2.5]" />
                        <span className="text-xs font-black uppercase text-gray-900">
                          Lotes de Vencimento Antigos
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 font-medium">
                        Remove lotes de mercadorias cuja data de validade já expirou.
                      </p>
                    </div>
                  </label>

                  <span className="text-xs font-mono font-black text-rose-800 bg-rose-100 px-2 py-0.5 rounded border border-rose-200 shrink-0">
                    {countLotesVencidosHoje} vencidos
                  </span>
                </div>

                {limparLotes && (
                  <div className="mt-3 pt-3 border-t border-rose-200/60 pl-7 space-y-2">
                    <span className="text-[10px] font-black uppercase text-rose-900 tracking-wider block">
                      Critério de Limpeza de Lotes:
                    </span>
                    <div className="space-y-1.5 text-xs text-gray-800">
                      <label className="flex items-center gap-2 cursor-pointer font-medium">
                        <input
                          type="radio"
                          name="criterioLotes"
                          checked={diasMargemLotes === 0}
                          onChange={() => setDiasMargemLotes(0)}
                          className="w-3.5 h-3.5 text-red-600"
                        />
                        <span>
                          Todos os já vencidos (validade anterior a hoje):{' '}
                          <strong className="font-mono">{countLotesVencidosHoje}</strong>
                        </span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer font-medium">
                        <input
                          type="radio"
                          name="criterioLotes"
                          checked={diasMargemLotes === 15}
                          onChange={() => setDiasMargemLotes(15)}
                          className="w-3.5 h-3.5 text-red-600"
                        />
                        <span>
                          Vencidos há mais de 15 dias:{' '}
                          <strong className="font-mono">{countLotesVencidos15}</strong>
                        </span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer font-medium">
                        <input
                          type="radio"
                          name="criterioLotes"
                          checked={diasMargemLotes === 30}
                          onChange={() => setDiasMargemLotes(30)}
                          className="w-3.5 h-3.5 text-red-600"
                        />
                        <span>
                          Vencidos há mais de 30 dias:{' '}
                          <strong className="font-mono">{countLotesVencidos30}</strong>
                        </span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer text-red-800 font-bold">
                        <input
                          type="radio"
                          name="criterioLotes"
                          checked={diasMargemLotes === -1}
                          onChange={() => setDiasMargemLotes(-1)}
                          className="w-3.5 h-3.5 text-red-600"
                        />
                        <span>
                          Todos os lotes cadastrados no sistema ({lotes.length} lotes)
                        </span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Option 2: Histórico de Importações */}
              <div
                className={`p-4 rounded-xl border transition-all ${
                  limparHistorico
                    ? 'bg-blue-50/50 border-blue-300 shadow-2xs'
                    : 'bg-gray-50 border-gray-200 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={limparHistorico}
                      onChange={(e) => setLimparHistorico(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-blue-700 stroke-[2.5]" />
                        <span className="text-xs font-black uppercase text-gray-900">
                          Histórico de Importações
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 font-medium">
                        Limpa a listagem de planilhas importadas anteriormente.
                      </p>
                    </div>
                  </label>

                  <span className="text-xs font-mono font-black text-blue-800 bg-blue-100 px-2 py-0.5 rounded border border-blue-200 shrink-0">
                    {historico.length} logs
                  </span>
                </div>
              </div>

              {/* Option 3: Divergências Antigas */}
              <div
                className={`p-4 rounded-xl border transition-all ${
                  limparDivergencias
                    ? 'bg-purple-50/50 border-purple-300 shadow-2xs'
                    : 'bg-gray-50 border-gray-200 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={limparDivergencias}
                      onChange={(e) => setLimparDivergencias(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-purple-600 border-gray-300 focus:ring-purple-500"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <AlertOctagon className="w-4 h-4 text-purple-700 stroke-[2.5]" />
                        <span className="text-xs font-black uppercase text-gray-900">
                          Registro de Divergências
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 font-medium">
                        Apaga o histórico de divergências e inconsistências reportadas.
                      </p>
                    </div>
                  </label>

                  <span className="text-xs font-mono font-black text-purple-800 bg-purple-100 px-2 py-0.5 rounded border border-purple-200 shrink-0">
                    {divergencias.length} alertas
                  </span>
                </div>
              </div>

              {/* Option 4: Vínculos EAN Órfãos */}
              <div
                className={`p-4 rounded-xl border transition-all ${
                  limparVinculosOrfaos
                    ? 'bg-amber-50/50 border-amber-300 shadow-2xs'
                    : 'bg-gray-50 border-gray-200 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={limparVinculosOrfaos}
                      onChange={(e) => setLimparVinculosOrfaos(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-amber-600 border-gray-300 focus:ring-amber-500"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Unlink className="w-4 h-4 text-amber-700 stroke-[2.5]" />
                        <span className="text-xs font-black uppercase text-gray-900">
                          Vínculos EAN Não Localizados (Órfãos)
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 font-medium">
                        Remove códigos de barras importados sem mercadoria correspondente na SMGOI013.
                      </p>
                    </div>
                  </label>

                  <span className="text-xs font-mono font-black text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-200 shrink-0">
                    {countVinculosOrfaos} órfãos
                  </span>
                </div>
              </div>

              {/* Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-black uppercase tracking-wider transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleExecutarLimpeza}
                  disabled={!hasAnySelected}
                  className="px-5 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 stroke-[2.5]" />
                  <span>Limpar Selecionados</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
