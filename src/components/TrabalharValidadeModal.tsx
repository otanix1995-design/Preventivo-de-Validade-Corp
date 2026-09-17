import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Barcode,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  HelpCircle,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Save,
  ShoppingBag,
  Store,
  Tag,
  TrendingDown,
  User,
  X,
  XCircle
} from 'lucide-react';
import { LoteVencimento, ProdutoSMG, RegistroSaeou060, StatusSaeou060 } from '../types';
import { parseEmbalagem } from '../services/codeParser';
import { formatarMoedaBR, parseMoedaBR } from '../services/deviceId';

interface TrabalharValidadeModalProps {
  registro: RegistroSaeou060;
  produto?: ProdutoSMG;
  isOpen: boolean;
  onClose: () => void;
  onAdicionarAoControle: (registroId: string, customData?: Partial<LoteVencimento>) => Promise<void>;
  onDesconsiderar: (registroId: string, motivo: string) => Promise<void>;
  onRestaurar?: (registroId: string) => Promise<void>;
  onSalvarTrabalho: (registroId: string, dados: {
    data_vencimento?: string;
    data_vencimento_exibicao?: string;
    quantidade?: number;
    preco_normal?: number;
    precoNormal?: number;
    preco_trabalhado?: number;
    precoTrabalhado?: number;
    data_preco?: string;
    observacao?: string;
  }) => Promise<void>;
  onNavigateToControle?: () => void;
}

export const TrabalharValidadeModal: React.FC<TrabalharValidadeModalProps> = ({
  registro,
  produto,
  isOpen,
  onClose,
  onAdicionarAoControle,
  onDesconsiderar,
  onRestaurar,
  onSalvarTrabalho,
  onNavigateToControle,
}) => {
  // Form State
  const [dataValidade, setDataValidade] = useState(registro?.data_vencimento || '');
  const [quantidade, setQuantidade] = useState<number>(registro?.quantidade || 1);
  const [precoNormal, setPrecoNormal] = useState<string>(
    registro?.preco_normal !== undefined
      ? String(registro.preco_normal)
      : (registro as any)?.precoNormal !== undefined
      ? String((registro as any).precoNormal)
      : produto?.vendas_preco !== undefined && produto.vendas_preco > 0
      ? String(produto.vendas_preco)
      : ''
  );
  const [precoTrabalhado, setPrecoTrabalhado] = useState<string>(
    registro?.preco_trabalhado !== undefined
      ? String(registro.preco_trabalhado)
      : (registro as any)?.precoTrabalhado !== undefined
      ? String((registro as any).precoTrabalhado)
      : ''
  );
  const [dataPreco, setDataPreco] = useState(registro?.data_preco || '');
  const [observacao, setObservacao] = useState(registro?.observacao || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal de confirmação de desconsiderar
  const [showDesconsiderarDialog, setShowDesconsiderarDialog] = useState(false);
  const [motivoDesconsiderar, setMotivoDesconsiderar] = useState(
    'Validade não confirmada em gôndola ou já tratada na loja.'
  );

  // Sync state when registro, produto or isOpen changes
  useEffect(() => {
    if (isOpen && registro) {
      setDataValidade(registro.data_vencimento || '');
      setQuantidade(registro.quantidade || 1);
      setPrecoNormal(
        registro.preco_normal !== undefined
          ? String(registro.preco_normal)
          : (registro as any)?.precoNormal !== undefined
          ? String((registro as any).precoNormal)
          : produto?.vendas_preco !== undefined && produto.vendas_preco > 0
          ? String(produto.vendas_preco)
          : ''
      );
      setPrecoTrabalhado(
        registro.preco_trabalhado !== undefined
          ? String(registro.preco_trabalhado)
          : (registro as any)?.precoTrabalhado !== undefined
          ? String((registro as any).precoTrabalhado)
          : ''
      );
      setDataPreco(registro.data_preco || '');
      setObservacao(registro.observacao || '');
      setShowDesconsiderarDialog(false);
    }
  }, [isOpen, registro, produto]);

  const embInfo = parseEmbalagem(produto?.embalagem || registro?.embalagem || '');
  const fator = embInfo.fator || produto?.fator_embalagem || 1;

  // Cálculo de caixas e unidades
  const caixasCalculadas = Math.floor(quantidade / fator);
  const unidadesSobrando = quantidade % fator;

  // Cálculo de dias restantes
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  let diasRestantes: number | null = null;
  if (dataValidade) {
    const vcto = new Date(dataValidade + 'T00:00:00');
    diasRestantes = Math.floor((vcto.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  }

  const isNoControle = registro?.status_saeou === 'JA_NO_CONTROLE';
  const isDesconsiderado = registro?.status_saeou === 'DESCONSIDERADO';

  // Preço parsing and consistency check
  const precoNormalNum = parseMoedaBR(precoNormal);
  const precoTrabalhadoNum = parseMoedaBR(precoTrabalhado);

  // Inconsistência de preços: Preço de Rebaixe >= Preço Normal (quando ambos preenchidos)
  const precoInconsistente =
    precoNormalNum !== null &&
    precoTrabalhadoNum !== null &&
    precoTrabalhadoNum >= precoNormalNum;

  // Preço base de referência para cálculo comercial
  const precoBaseReferencia = precoNormalNum ?? produto?.vendas_preco;

  let percentualDesconto: number | null = null;
  let economiaPorUnidade: number | null = null;
  if (precoBaseReferencia && precoBaseReferencia > 0 && precoTrabalhadoNum !== null && precoTrabalhadoNum < precoBaseReferencia) {
    percentualDesconto = Math.round(((precoBaseReferencia - precoTrabalhadoNum) / precoBaseReferencia) * 100);
    economiaPorUnidade = precoBaseReferencia - precoTrabalhadoNum;
  }

  const handleApplyQuickDiscount = (percentual: number) => {
    if (!precoBaseReferencia || precoBaseReferencia <= 0) return;
    const novoValor = precoBaseReferencia * (1 - percentual / 100);
    setPrecoTrabalhado(novoValor.toFixed(2).replace('.', ','));
    if (!dataPreco) {
      setDataPreco(new Date().toISOString().slice(0, 10));
    }
  };

  const handleSalvarApenas = async () => {
    if (!registro) return;
    if (precoInconsistente && precoNormalNum !== null && precoTrabalhadoNum !== null) {
      alert(`Inconsistência de Preços: O Preço de Rebaixe (${formatarMoedaBR(precoTrabalhadoNum)}) deve ser menor que o Preço Normal (${formatarMoedaBR(precoNormalNum)}).`);
      return;
    }
    setIsSubmitting(true);
    try {
      let dataExibicao = dataValidade;
      if (dataValidade.includes('-')) {
        const [y, m, d] = dataValidade.split('-');
        dataExibicao = `${d}/${m}/${y}`;
      }

      await onSalvarTrabalho(registro.id, {
        data_vencimento: dataValidade,
        data_vencimento_exibicao: dataExibicao,
        quantidade: Number(quantidade),
        preco_normal: precoNormalNum ?? undefined,
        precoNormal: precoNormalNum ?? undefined,
        preco_trabalhado: precoTrabalhadoNum ?? undefined,
        precoTrabalhado: precoTrabalhadoNum ?? undefined,
        data_preco: dataPreco,
        observacao,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdicionarControleClick = async () => {
    if (!registro) return;
    if (precoInconsistente && precoNormalNum !== null && precoTrabalhadoNum !== null) {
      alert(`Inconsistência de Preços: O Preço de Rebaixe (${formatarMoedaBR(precoTrabalhadoNum)}) deve ser menor que o Preço Normal (${formatarMoedaBR(precoNormalNum)}).`);
      return;
    }
    setIsSubmitting(true);
    try {
      await onAdicionarAoControle(registro.id, {
        data_validade: dataValidade,
        quantidade_total_unidades: Number(quantidade),
        preco_normal: precoNormalNum ?? undefined,
        precoNormal: precoNormalNum ?? undefined,
        preco_trabalhado: precoTrabalhadoNum ?? undefined,
        precoTrabalhado: precoTrabalhadoNum ?? undefined,
        data_preco: dataPreco,
        observacao: observacao || `Importado via SAEOU060 (Promotor: ${registro.promotor || 'N/I'})`,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmarDesconsiderar = async () => {
    if (!registro) return;
    setIsSubmitting(true);
    try {
      await onDesconsiderar(registro.id, motivoDesconsiderar);
      setShowDesconsiderarDialog(false);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestaurarClick = async () => {
    if (!onRestaurar || !registro) return;
    setIsSubmitting(true);
    try {
      await onRestaurar(registro.id);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !registro) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
        {/* Header da Tela Trabalhar Validade */}
        <div className="bg-blue-600 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-700/80 rounded-xl border border-blue-400">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">TRABALHAR VALIDADE</h2>
                <span className="bg-blue-500/80 text-[11px] font-mono px-2 py-0.5 rounded text-white border border-blue-400">
                  {registro.codigo_exibicao || registro.codigo_interno}
                </span>
              </div>
              <p className="text-xs text-blue-100 line-clamp-1 mt-0.5">
                {produto?.descricao || registro.descricao || 'Produto do Cadastro SMGOI013'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-blue-700 rounded-xl text-blue-100 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo do Modal com Scroll */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-slate-800">
          {/* Status do Registro */}
          <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div className="text-xs">
              <span className="text-slate-500 font-medium">Status Atual do SAEOU060:</span>
              <div className="font-bold text-slate-800 mt-0.5 flex items-center gap-1.5">
                {isNoControle ? (
                  <span className="text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Já no Controle de Vencimentos
                  </span>
                ) : isDesconsiderado ? (
                  <span className="text-slate-600 flex items-center gap-1">
                    <XCircle className="w-4 h-4 text-slate-400" /> Desconsiderado da Rotina
                  </span>
                ) : diasRestantes !== null && diasRestantes <= 7 ? (
                  <span className="text-amber-800 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Precisa de Ação / Vence em até 7 dias
                  </span>
                ) : (
                  <span className="text-blue-700 flex items-center gap-1">
                    <Clock className="w-4 h-4 text-blue-600" /> Novo Registro a Trabalhar
                  </span>
                )}
              </div>
            </div>

            {isDesconsiderado && (
              <span className="text-xs text-slate-400">
                {registro.desconsiderado_em ? `Em: ${registro.desconsiderado_em}` : ''}
              </span>
            )}
          </div>

          {/* SEÇÃO 1: DADOS DO PRODUTO */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <Package className="w-3.5 h-3.5 text-blue-600" />
              <span>1. Dados Oficiais do Produto (SMGOI013)</span>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3 text-xs">
              <div>
                <span className="text-slate-500 font-medium">Descrição da Mercadoria:</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
                  {produto?.descricao || registro.descricao || 'DESCRIÇÃO NÃO ENCONTRADA NA SMGOI013'}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/60">
                <div>
                  <span className="text-slate-500">Cód. Interno:</span>
                  <p className="font-mono font-bold text-slate-800">{registro.codigo_interno}</p>
                </div>
                <div>
                  <span className="text-slate-500">Dígito:</span>
                  <p className="font-mono font-bold text-slate-800">{registro.digito || produto?.digito || '-'}</p>
                </div>
                <div>
                  <span className="text-slate-500">Embalagem:</span>
                  <p className="font-bold text-slate-800">{produto?.embalagem || registro.embalagem || 'UN 1'}</p>
                </div>
                <div>
                  <span className="text-slate-500">Fator Emb.:</span>
                  <p className="font-bold text-slate-800">{fator} UN</p>
                </div>
              </div>

              {/* Vínculos EAN */}
              {produto?.eans && produto.eans.length > 0 && (
                <div className="pt-2 border-t border-slate-200/60">
                  <span className="text-slate-500 block mb-1.5 flex items-center gap-1 font-medium">
                    <Barcode className="w-3.5 h-3.5 text-blue-600" />
                    Código(s) de Barras EAN Vinculados ({produto.eans.length}):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {produto.eans.map((ean, idx) => (
                      <span
                        key={idx}
                        className="font-mono text-[11px] bg-white border border-slate-200 px-2 py-0.5 rounded-md text-slate-700 font-semibold shadow-2xs"
                      >
                        {ean}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SEÇÃO 2: INFORMAÇÕES OPERACIONAIS SMGOI013 */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <Store className="w-3.5 h-3.5 text-blue-600" />
              <span>2. Informações Operacionais da Loja (SMGOI013)</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium">Estoque Atual</span>
                <p className="text-base font-bold text-slate-900 mt-0.5">
                  {produto?.estoque_total !== undefined ? produto.estoque_total : '-'} {produto?.unidade_medida || 'UN'}
                </p>
                {produto?.estoque_total !== undefined && fator > 1 && (
                  <span className="text-[10px] text-slate-500">
                    ≈ {(produto.estoque_total / fator).toFixed(1)} CXA
                  </span>
                )}
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium">Venda 30 Dias</span>
                <p className="text-base font-bold text-blue-700 mt-0.5">
                  {produto?.vendas_qtde_30d !== undefined ? produto.vendas_qtde_30d : '-'}
                </p>
                <span className="text-[10px] text-slate-400">Giro médio mensal</span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium">Dias Sem Venda</span>
                <p className="text-base font-bold text-amber-700 mt-0.5">
                  {produto?.dias_sem_venda !== undefined ? `${produto.dias_sem_venda}d` : '-'}
                </p>
                <span className="text-[10px] text-slate-400">Tempo sem saída</span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 font-medium">Última Entrada</span>
                <p className="text-xs font-bold text-slate-800 mt-1">
                  {produto?.data_ultima_entrada || '-'}
                </p>
                <span className="text-[10px] text-slate-500">
                  Qtd: {produto?.qtde_ultima_entrada || '-'}
                </span>
              </div>
            </div>
          </div>

          {/* SEÇÃO 3: DADOS DA VALIDADE */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                <span>3. Conferência de Validade e Quantidade</span>
              </div>
              {registro.promotor && (
                <span className="text-xs text-blue-700 font-semibold flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md">
                  <User className="w-3 h-3" /> Promotor: {registro.promotor}
                </span>
              )}
            </div>

            <div className="bg-blue-50/60 rounded-xl p-4 border border-blue-200 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Data de Validade:
                  </label>
                  <input
                    type="date"
                    value={dataValidade}
                    onChange={(e) => setDataValidade(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {diasRestantes !== null && (
                    <div className="mt-1.5 flex items-center gap-1 text-xs">
                      {diasRestantes < 0 ? (
                        <span className="font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded">
                          Venceu há {Math.abs(diasRestantes)} dias
                        </span>
                      ) : diasRestantes === 0 ? (
                        <span className="font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded animate-pulse">
                          VENCE HOJE!
                        </span>
                      ) : diasRestantes <= 7 ? (
                        <span className="font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          ÚLTIMOS 7 DIAS ({diasRestantes} dias restantes)
                        </span>
                      ) : (
                        <span className="text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {diasRestantes} dias até o vencimento
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Quantidade Apontada (Unidades):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      value={quantidade}
                      onChange={(e) => setQuantidade(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-xs font-bold text-slate-500 px-2 py-2 bg-white rounded-lg border border-slate-200">
                      {produto?.unidade_medida || 'UN'}
                    </span>
                  </div>

                  {fator > 1 && (
                    <div className="text-[11px] text-slate-600 mt-1.5">
                      Equivale a: <strong className="text-blue-800">{caixasCalculadas} CXA</strong>{' '}
                      {unidadesSobrando > 0 && <span>e <strong>{unidadesSobrando} UN</strong></span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* SEÇÃO 4: TRATAMENTO E AÇÕES OPERACIONAIS */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <Tag className="w-3.5 h-3.5 text-blue-600" />
                <span>4. Tratamento Operacional (Preços DE / POR & Observações)</span>
              </div>
              <span className="text-[10px] uppercase font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                Ação Comercial
              </span>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
              {/* Alerta de Inconsistência se Preço Rebaixe >= Preço Normal */}
              {precoInconsistente && precoNormalNum !== null && precoTrabalhadoNum !== null && (
                <div className="p-3 bg-red-50 border-2 border-red-300 rounded-xl text-xs text-red-900 font-bold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-black">Inconsistência de Preços:</p>
                    <p className="font-normal text-[11px] text-red-800">
                      O Preço de Rebaixe ({formatarMoedaBR(precoTrabalhadoNum)}) deve ser menor que o Preço Normal ({formatarMoedaBR(precoNormalNum)}).
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Preço Normal (DE) */}
                <div>
                  <label htmlFor="input-saeou-preco-normal" className="block text-xs font-semibold text-slate-700 mb-1">
                    Preço Normal (DE):
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                      R$
                    </span>
                    <input
                      id="input-saeou-preco-normal"
                      type="text"
                      inputMode="decimal"
                      placeholder={produto?.vendas_preco ? `Ex: ${produto.vendas_preco.toFixed(2).replace('.', ',')}` : 'Ex: 14,99'}
                      value={precoNormal}
                      onChange={(e) => setPrecoNormal(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    {precoNormal && (
                      <button
                        type="button"
                        onClick={() => setPrecoNormal('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                        title="Limpar preço normal"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Preço Rebaixado (POR) */}
                <div>
                  <label htmlFor="input-saeou-preco-rebaixe" className="block text-xs font-semibold text-slate-700 mb-1">
                    Preço Rebaixado (POR):
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                      R$
                    </span>
                    <input
                      id="input-saeou-preco-rebaixe"
                      type="text"
                      inputMode="decimal"
                      placeholder="Ex: 9,99"
                      value={precoTrabalhado}
                      onChange={(e) => {
                        setPrecoTrabalhado(e.target.value);
                        if (e.target.value && !dataPreco) {
                          setDataPreco(new Date().toISOString().slice(0, 10));
                        }
                      }}
                      className={`w-full pl-9 pr-8 py-2 bg-white border rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${
                        precoInconsistente ? 'border-red-500' : 'border-slate-300'
                      }`}
                    />
                    {precoTrabalhado && (
                      <button
                        type="button"
                        onClick={() => setPrecoTrabalhado('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                        title="Limpar preço trabalhado"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Data do Preço */}
                <div>
                  <label htmlFor="input-saeou-data-preco" className="block text-xs font-semibold text-slate-700 mb-1">
                    Data do Rebaixe:
                  </label>
                  <input
                    id="input-saeou-data-preco"
                    type="date"
                    value={dataPreco}
                    onChange={(e) => setDataPreco(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Quick Discount Shortcuts based on Normal Price */}
              {precoBaseReferencia !== undefined && precoBaseReferencia > 0 && (
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-gray-600 uppercase flex items-center gap-1">
                      <TrendingDown className="w-3 h-3 text-amber-700" />
                      Atalhos de Rebaixe sobre Preço Normal ({formatarMoedaBR(precoBaseReferencia)}):
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[10, 20, 30, 40, 50].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => handleApplyQuickDiscount(pct)}
                        className="px-2 py-0.5 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold uppercase transition-colors"
                      >
                        -{pct}% ({formatarMoedaBR(precoBaseReferencia * (1 - pct / 100))})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Discount Evaluation Banner */}
              {!precoInconsistente && percentualDesconto !== null && economiaPorUnidade !== null && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
                    <span>
                      DE {precoBaseReferencia ? formatarMoedaBR(precoBaseReferencia) : ''} POR {precoTrabalhadoNum ? formatarMoedaBR(precoTrabalhadoNum) : ''} (<strong>-{percentualDesconto}%</strong>)
                    </span>
                  </span>
                  <span className="font-mono text-emerald-800">
                    Economia: <strong>{formatarMoedaBR(economiaPorUnidade)}</strong>/un
                  </span>
                </div>
              )}

              <div>
                <label htmlFor="input-saeou-observacao" className="block text-xs font-semibold text-slate-700 mb-1">
                  Observação Operacional:
                </label>
                <textarea
                  id="input-saeou-observacao"
                  rows={2}
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Ex: Mercadoria posicionada na ponta da gôndola, promotor avisado, etc."
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé de Ações */}
        <div className="bg-slate-50 px-4 py-3.5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {!isDesconsiderado ? (
              <button
                type="button"
                onClick={() => setShowDesconsiderarDialog(true)}
                disabled={isSubmitting}
                className="w-full sm:w-auto px-3.5 py-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 border border-red-200 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <XCircle className="w-4 h-4 text-red-600" />
                Desconsiderar Validade
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRestaurarClick}
                disabled={isSubmitting}
                className="w-full sm:w-auto px-3.5 py-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4 text-blue-600" />
                Restaurar Validade
              </button>
            )}

            <button
              type="button"
              onClick={handleSalvarApenas}
              disabled={isSubmitting}
              className="w-full sm:w-auto px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <Save className="w-4 h-4 text-slate-600" />
              Salvar Alterações
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {isNoControle && onNavigateToControle && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigateToControle();
                }}
                className="w-full sm:w-auto px-4 py-2.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold rounded-xl transition-colors inline-flex items-center justify-center gap-1.5 border border-emerald-300"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                Ver no Controle
              </button>
            )}

            <button
              type="button"
              onClick={handleAdicionarControleClick}
              disabled={isSubmitting}
              className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-xl shadow-md transition-all inline-flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : isNoControle ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>
                {isNoControle
                  ? 'Atualizar no Controle de Vencimentos'
                  : 'Adicionar ao Controle de Vencimentos'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Dialog de Confirmação para Desconsiderar */}
      {showDesconsiderarDialog && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-red-100 text-red-700 rounded-xl shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Desconsiderar esta validade do SAEOU060?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  O registro <strong>não será apagado</strong> do histórico, mas ficará marcado como
                  desconsiderado e não gerará alertas na rotina diária.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Motivo / Justificativa Operacional:
              </label>
              <textarea
                rows={2}
                value={motivoDesconsiderar}
                onChange={(e) => setMotivoDesconsiderar(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDesconsiderarDialog(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarDesconsiderar}
                disabled={isSubmitting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
              >
                Confirmar e Desconsiderar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
