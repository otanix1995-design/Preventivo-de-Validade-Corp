import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  DollarSign,
  Download,
  FileSpreadsheet,
  Layers,
  Pencil,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { LoteVencimento, ProdutoSMG } from '../types';
import {
  exportarCartazesTagsellXLSX,
  ItemCartazValidacao,
  TAGSELL_COLUNAS_OFICIAIS,
  validarItemParaCartaz,
} from '../services/tagsellCartazesService';
import { formatarMoedaBR } from '../services/deviceId';

interface GerarCartazesModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLotes: LoteVencimento[];
  produtosMap: Map<string, ProdutoSMG>;
  onRemoveFromSelection: (loteId: string) => void;
  onEditLote?: (produto?: ProdutoSMG, lote?: LoteVencimento) => void;
}

export const GerarCartazesModal: React.FC<GerarCartazesModalProps> = ({
  isOpen,
  onClose,
  selectedLotes,
  produtosMap,
  onRemoveFromSelection,
  onEditLote,
}) => {
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Mapear e validar cada item selecionado
  const itensValidados = useMemo<ItemCartazValidacao[]>(() => {
    return selectedLotes.map((lote) => {
      const produto = produtosMap.get(lote.codigo_interno);
      return validarItemParaCartaz(lote, produto);
    });
  }, [selectedLotes, produtosMap]);

  const itensInvalidos = useMemo(() => {
    return itensValidados.filter((it) => !it.valido);
  }, [itensValidados]);

  const itensValidos = useMemo(() => {
    return itensValidados.filter((it) => it.valido);
  }, [itensValidados]);

  const todosValidos = itensValidados.length > 0 && itensInvalidos.length === 0;

  if (!isOpen) return null;

  const handleGerarXlsx = () => {
    setExportError(null);
    setDownloadSuccess(null);

    if (itensValidados.length === 0) {
      setExportError('Nenhum produto selecionado para gerar cartazes.');
      return;
    }

    if (itensInvalidos.length > 0) {
      setExportError(
        `${itensInvalidos.length} produto(s) precisam de atenção antes da geração. Corrija os preços ou remova os itens para prosseguir.`
      );
      return;
    }

    setIsExporting(true);
    try {
      const resultado = exportarCartazesTagsellXLSX(itensValidados);
      if (resultado.sucesso) {
        setDownloadSuccess(
          `Arquivo "${resultado.nomeArquivo}" gerado com sucesso contendo ${resultado.totalProdutos} produtos (${resultado.totalLinhas} linhas) no modelo oficial Tagsell de 19 colunas.`
        );
      } else {
        setExportError(resultado.erros?.join(' | ') || 'Erro ao gerar a planilha.');
      }
    } catch (err: any) {
      setExportError(err.message || 'Erro inesperado na geração do arquivo XLSX.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      id="modal-gerar-cartazes-overlay"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="modal-gerar-cartazes-container"
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-scaleUp"
      >
        {/* CABEÇALHO DO MODAL */}
        <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-yellow-600 text-white p-4 sm:p-5 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-xl border border-white/20 backdrop-blur-xs">
              <Tag className="w-6 h-6 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black tracking-tight leading-tight">
                  GERADOR DE CARTAZES
                </h2>
                <span className="text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full border border-white/30 uppercase tracking-wider">
                  Tagsell • 19 Colunas
                </span>
              </div>
              <p className="text-xs text-amber-100 font-medium mt-0.5">
                Conferência de produtos selecionados do Controle de Vencimentos
              </p>
            </div>
          </div>

          <button
            id="btn-fechar-modal-cartazes"
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
            title="Fechar conferência"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* CORPO DO MODAL (CONFERÊNCIA) */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {/* BANNER DE STATUS / VALIDAÇÃO GERAL */}
          {itensInvalidos.length > 0 ? (
            <div className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-xl flex items-start gap-3 text-amber-900 text-xs">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-black text-sm">
                  {itensInvalidos.length}{' '}
                  {itensInvalidos.length === 1
                    ? 'produto precisa de atenção antes da geração'
                    : 'produtos precisam de atenção antes da geração'}
                </p>
                <p className="text-amber-800 leading-relaxed font-medium">
                  O modelo oficial Tagsell exige que cada produto possua{' '}
                  <strong>Preço Normal (DE)</strong> e <strong>Preço de Rebaixe (POR)</strong>, com
                  o Preço de Rebaixe estritamente menor que o Preço Normal.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between gap-3 text-emerald-900 text-xs font-semibold">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Todos os <strong>{itensValidados.length}</strong> produtos estão conferidos e prontos para o Tagsell.
                </span>
              </div>
              <span className="text-[11px] font-mono text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded font-bold">
                19 Colunas OK
              </span>
            </div>
          )}

          {/* SUCESSO DO DOWNLOAD */}
          {downloadSuccess && (
            <div className="p-3.5 bg-blue-50 border-2 border-blue-300 rounded-xl flex items-start gap-2.5 text-blue-900 text-xs">
              <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">Arquivo baixado com sucesso!</p>
                <p className="text-blue-800 mt-0.5">{downloadSuccess}</p>
                <p className="text-[11px] text-blue-700 mt-1 font-mono">
                  Pronto para importar diretamente no sistema Tagsell.
                </p>
              </div>
            </div>
          )}

          {/* ERRO DE EXPORTAÇÃO */}
          {exportError && (
            <div className="p-3.5 bg-red-50 border-2 border-red-300 rounded-xl flex items-start gap-2.5 text-red-900 text-xs">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">Atenção na Exportação:</p>
                <p className="text-red-800 mt-0.5">{exportError}</p>
              </div>
            </div>
          )}

          {/* RESUMO RÁPIDO DO MAPEAMENTO OFICIAL */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 space-y-1.5">
            <div className="flex items-center justify-between font-bold text-slate-800 uppercase tracking-wide text-[11px]">
              <span className="flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-amber-600" />
                Parâmetros do Modelo Validado
              </span>
              <span className="text-slate-500 font-mono">EXATAMENTE 19 COLUNAS</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
              <div className="bg-white p-1.5 rounded border border-slate-200">
                <span className="text-slate-400 block text-[9px] uppercase font-sans font-bold">Dinâmica:</span>
                <span className="font-bold text-slate-900">DE POR</span>
              </div>
              <div className="bg-white p-1.5 rounded border border-slate-200">
                <span className="text-slate-400 block text-[9px] uppercase font-sans font-bold">Formato:</span>
                <span className="font-bold text-slate-900">A6 - Paisagem</span>
              </div>
              <div className="bg-white p-1.5 rounded border border-slate-200">
                <span className="text-slate-400 block text-[9px] uppercase font-sans font-bold">Layout:</span>
                <span className="font-bold text-slate-900">sas46.A9</span>
              </div>
              <div className="bg-white p-1.5 rounded border border-slate-200">
                <span className="text-slate-400 block text-[9px] uppercase font-sans font-bold">Campanha:</span>
                <span className="font-bold text-slate-900">OFERTA</span>
              </div>
            </div>
          </div>

          {/* LISTA DE PRODUTOS SELECIONADOS PARA CONFERÊNCIA */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <span>Produtos na Planilha</span>
                <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full text-[10px] font-bold">
                  {itensValidados.length}
                </span>
              </h3>
              <span className="text-[11px] text-slate-500">
                1 linha de cabeçalho + {itensValidados.length} {itensValidados.length === 1 ? 'linha' : 'linhas'}
              </span>
            </div>

            {itensValidados.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-500 space-y-2">
                <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-xs font-bold uppercase">Nenhum produto selecionado</p>
                <p className="text-xs">Feche esta janela e selecione ao menos um lote no Controle de Vencimentos.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {itensValidados.map((item, index) => {
                  return (
                    <div
                      key={item.lote.id}
                      id={`cartaz-item-conferencia-${item.lote.id}`}
                      className={`p-3.5 rounded-xl border transition-all ${
                        !item.valido
                          ? 'bg-amber-50/50 border-amber-300 shadow-2xs'
                          : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {/* Identificação e Descrição */}
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-300 text-slate-700 font-black text-[10px] flex items-center justify-center font-mono shrink-0">
                              {index + 1}
                            </span>
                            <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                              CÓD: {item.codigoRaiz}
                            </span>
                            {item.gramagem && (
                              <span className="font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                                {item.gramagem}
                              </span>
                            )}
                            {item.marca && (
                              <span className="font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                                {item.marca}
                              </span>
                            )}
                            {item.ean && (
                              <span className="font-mono text-[10px] text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                EAN: {item.ean}
                              </span>
                            )}
                          </div>

                          <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase leading-snug">
                            {item.descricao}
                          </h4>

                          {/* Validade */}
                          <div className="text-xs text-slate-600 font-mono font-semibold pt-0.5 flex items-center gap-1.5">
                            <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-bold">
                              {item.validadeFormatada}
                            </span>
                          </div>
                        </div>

                        {/* Ações Rápidas por Item */}
                        <div className="flex items-center gap-1 shrink-0">
                          {onEditLote && (
                            <button
                              type="button"
                              onClick={() => onEditLote(item.produto, item.lote)}
                              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-blue-200 transition-colors"
                              title="Editar este lote para corrigir preços"
                            >
                              <Pencil className="w-3.5 h-3.5 stroke-[2.5]" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onRemoveFromSelection(item.lote.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Remover produto desta lista de cartazes"
                          >
                            <Trash2 className="w-3.5 h-3.5 stroke-[2.5]" />
                          </button>
                        </div>
                      </div>

                      {/* BLOCO DE PREÇOS (DE / POR) */}
                      <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* DE */}
                          <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">DE (PREÇO):</span>
                            {item.precoNormal !== null ? (
                              <span className="font-mono font-bold text-slate-800">
                                {formatarMoedaBR(item.precoNormal)}
                              </span>
                            ) : (
                              <span className="text-red-600 font-bold text-[11px] italic">
                                Não informado
                              </span>
                            )}
                          </div>

                          {/* POR */}
                          <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-lg">
                            <span className="text-[10px] font-bold text-amber-700 uppercase">
                              POR (PREÇO VAREJO):
                            </span>
                            {item.precoRebaixe !== null ? (
                              <span className="font-mono font-black text-amber-950">
                                {formatarMoedaBR(item.precoRebaixe)}
                              </span>
                            ) : (
                              <span className="text-red-600 font-bold text-[11px] italic">
                                Não informado
                              </span>
                            )}
                          </div>

                          {/* DESCONTO */}
                          {item.descontoPercentual !== null && item.descontoPercentual > 0 && (
                            <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-1 rounded-lg border border-emerald-300">
                              -{item.descontoPercentual}%
                            </span>
                          )}
                        </div>

                        {/* Status de Validação do Item */}
                        <div>
                          {item.valido ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Pronto para Cartaz
                            </span>
                          ) : (
                            <div className="space-y-0.5 text-right">
                              {item.erros.map((err, errIdx) => (
                                <span
                                  key={errIdx}
                                  className="block text-[11px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200 text-left"
                                >
                                  ⚠ {err}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RODAPÉ COM AÇÕES */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 sm:p-5 flex items-center justify-between gap-3 shrink-0">
          <button
            id="btn-voltar-cartazes"
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-2xs active:scale-95"
          >
            <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
            <span>Voltar</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              id="btn-gerar-xlsx-tagsell"
              type="button"
              disabled={!todosValidos || isExporting}
              onClick={handleGerarXlsx}
              className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-md active:scale-95 ${
                todosValidos && !isExporting
                  ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer hover:shadow-lg'
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed border border-slate-400'
              }`}
              title={
                !todosValidos
                  ? 'Corrija os produtos com pendências ou remova-os para habilitar a geração'
                  : 'Exportar planilha .xlsx compatível com Tagsell'
              }
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>
                {isExporting ? 'Gerando XLSX...' : `Gerar XLSX (${itensValidados.length} produtos)`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
