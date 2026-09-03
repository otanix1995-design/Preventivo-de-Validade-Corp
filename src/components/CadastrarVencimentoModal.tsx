import {
  AlertCircle,
  Boxes,
  Calendar,
  Check,
  DollarSign,
  Package,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Tag,
  TrendingDown,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { parseEmbalagem } from '../services/codeParser';
import { calcularProjecaoVencimento, formatarDataBR } from '../services/projection';
import { addVencimento, getVencimentosByCodigoInterno, updateVencimento } from '../services/storage';
import { LoteVencimento, ProdutoSMG } from '../types';
import { StatusBadge } from './StatusBadge';

interface CadastrarVencimentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  produto: ProdutoSMG | null;
  loteParaEditar?: LoteVencimento | null;
  eanConsultado?: string;
  onChangeProduto?: () => void;
  onSuccess?: (loteCriado: LoteVencimento) => void;
}

export const CadastrarVencimentoModal: React.FC<CadastrarVencimentoModalProps> = ({
  isOpen,
  onClose,
  produto,
  loteParaEditar,
  eanConsultado,
  onChangeProduto,
  onSuccess,
}) => {
  const isEditing = Boolean(loteParaEditar);

  const [dataValidade, setDataValidade] = useState<string>(() => {
    if (loteParaEditar?.data_validade) return loteParaEditar.data_validade;
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  const [quantidadeStr, setQuantidadeStr] = useState<string>(() => {
    return loteParaEditar?.quantidade_total_unidades ? String(loteParaEditar.quantidade_total_unidades) : '12';
  });

  const [precoTrabalhado, setPrecoTrabalhado] = useState<string>(() => {
    return loteParaEditar?.preco_trabalhado !== undefined ? String(loteParaEditar.preco_trabalhado) : '';
  });

  const [dataPreco, setDataPreco] = useState<string>(() => {
    return loteParaEditar?.data_preco || '';
  });

  const [observacao, setObservacao] = useState<string>(() => {
    return loteParaEditar?.observacao || '';
  });

  const [loteIdentificador, setLoteIdentificador] = useState<string>(() => {
    return loteParaEditar?.lote_identificador || '';
  });

  const [enviarComprador, setEnviarComprador] = useState<boolean>(() => {
    return Boolean(loteParaEditar?.enviar_ao_comprador);
  });

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync state when loteParaEditar or open changes
  useEffect(() => {
    if (loteParaEditar) {
      setDataValidade(loteParaEditar.data_validade || '');
      setQuantidadeStr(String(loteParaEditar.quantidade_total_unidades || '12'));
      setPrecoTrabalhado(loteParaEditar.preco_trabalhado !== undefined ? String(loteParaEditar.preco_trabalhado) : '');
      setDataPreco(loteParaEditar.data_preco || '');
      setObservacao(loteParaEditar.observacao || '');
      setLoteIdentificador(loteParaEditar.lote_identificador || '');
      setEnviarComprador(Boolean(loteParaEditar.enviar_ao_comprador));
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      setDataValidade(d.toISOString().slice(0, 10));
      setQuantidadeStr('12');
      setPrecoTrabalhado('');
      setDataPreco('');
      setObservacao('');
      setLoteIdentificador('');
      setEnviarComprador(false);
    }
    setErrorMsg(null);
  }, [loteParaEditar, isOpen]);

  // Existing lots for this product (excluding current if editing)
  const lotesExistentes = useMemo(() => {
    if (!produto) return [];
    return getVencimentosByCodigoInterno(produto.codigo_interno).filter(
      (l) => !isEditing || l.id !== loteParaEditar?.id
    );
  }, [produto, isEditing, loteParaEditar]);

  // Packaging calculation
  const embData = parseEmbalagem(produto?.embalagem || '');
  const quantidadeNum = parseInt(quantidadeStr, 10) || 0;
  const conversaoTexto = embData.descricao_formatada(quantidadeNum);

  // Price calculations & discount percentages
  const precoVendaBase = produto?.vendas_preco;
  const precoTrabalhadoNum = precoTrabalhado ? parseFloat(precoTrabalhado.replace(',', '.')) : undefined;

  let percentualDesconto: number | null = null;
  let economiaPorUnidade: number | null = null;

  if (precoVendaBase && precoVendaBase > 0 && precoTrabalhadoNum && precoTrabalhadoNum > 0) {
    if (precoTrabalhadoNum < precoVendaBase) {
      economiaPorUnidade = precoVendaBase - precoTrabalhadoNum;
      percentualDesconto = Math.round(((precoVendaBase - precoTrabalhadoNum) / precoVendaBase) * 100);
    }
  }

  // Quick discount calculation helper
  const handleApplyQuickDiscount = (pct: number) => {
    if (!precoVendaBase || precoVendaBase <= 0) return;
    const discounted = precoVendaBase * (1 - pct / 100);
    setPrecoTrabalhado(discounted.toFixed(2));
    if (!dataPreco) {
      setDataPreco(new Date().toISOString().slice(0, 10));
    }
  };

  // Temporary mock lot for live projection preview
  const previewLote: LoteVencimento | null = produto ? {
    id: loteParaEditar?.id || 'preview',
    codigo_interno: produto.codigo_interno,
    digito: produto.digito,
    codigo_exibicao: produto.codigo_exibicao,
    descricao_produto: produto.descricao,
    embalagem: produto.embalagem,
    fator_embalagem: produto.fator_embalagem,
    data_validade: dataValidade,
    quantidade_total_unidades: quantidadeNum,
    preco_trabalhado: precoTrabalhadoNum,
    data_preco: dataPreco || undefined,
    enviar_ao_comprador: enviarComprador,
    criado_em: loteParaEditar?.criado_em || new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  } : null;

  const projecaoPreview = (dataValidade && previewLote && produto)
    ? calcularProjecaoVencimento(previewLote, produto)
    : null;

  // Preset helpers
  const handleSetPresetDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setDataValidade(d.toISOString().slice(0, 10));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!produto) return;

    if (!dataValidade) {
      setErrorMsg('Informe a data de validade.');
      return;
    }

    if (quantidadeNum <= 0) {
      setErrorMsg('Informe uma quantidade válida maior que zero.');
      return;
    }

    const precoFinal = precoTrabalhado.trim()
      ? parseFloat(precoTrabalhado.trim().replace(',', '.'))
      : undefined;

    if (precoFinal !== undefined && (isNaN(precoFinal) || precoFinal < 0)) {
      setErrorMsg('Informe um valor de preço válido.');
      return;
    }

    const dataPrecoFinal = precoFinal !== undefined
      ? (dataPreco || new Date().toISOString().slice(0, 10))
      : undefined;

    let loteResultado: LoteVencimento;

    if (isEditing && loteParaEditar) {
      const updated = await updateVencimento(loteParaEditar.id, {
        data_validade: dataValidade,
        quantidade_total_unidades: quantidadeNum,
        preco_trabalhado: precoFinal,
        data_preco: dataPrecoFinal,
        observacao: observacao.trim() || undefined,
        lote_identificador: loteIdentificador.trim() || undefined,
        enviar_ao_comprador: enviarComprador,
        status_customizado: enviarComprador ? 'ENVIAR_AO_COMPRADOR' : undefined,
      });
      if (!updated) {
        setErrorMsg('Erro ao atualizar o lote.');
        return;
      }
      loteResultado = updated;
    } else {
      loteResultado = await addVencimento({
        codigo_interno: produto.codigo_interno,
        digito: produto.digito,
        codigo_exibicao: produto.codigo_exibicao,
        descricao_produto: produto.descricao,
        embalagem: produto.embalagem,
        fator_embalagem: produto.fator_embalagem || embData.fator,
        data_validade: dataValidade,
        quantidade_total_unidades: quantidadeNum,
        preco_trabalhado: precoFinal,
        data_preco: dataPrecoFinal,
        observacao: observacao.trim() || undefined,
        lote_identificador: loteIdentificador.trim() || undefined,
        enviar_ao_comprador: enviarComprador,
        status_customizado: enviarComprador ? 'ENVIAR_AO_COMPRADOR' : undefined,
      });
    }

    if (onSuccess) {
      onSuccess(loteResultado);
    }
    onClose();
  };

  if (!isOpen || !produto) return null;

  return (
    <div
      id="cadastrar-vencimento-modal"
      className="fixed inset-0 z-50 bg-gray-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden border border-gray-200">
        {/* Modal Header with Bold Typography */}
        <div className="bg-blue-700 text-white px-5 py-4 flex items-center justify-between shrink-0 border-b border-blue-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center border border-white/20">
              {isEditing ? (
                <Pencil className="w-5 h-5 text-white stroke-[2.5]" />
              ) : (
                <Plus className="w-5 h-5 text-white stroke-[2.5]" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight">
                {isEditing ? 'EDITAR VENCIMENTO' : 'CADASTRAR VENCIMENTO'}
              </h2>
              <p className="text-xs text-blue-200 font-mono font-bold">
                CÓD: <strong>{produto.codigo_exibicao}</strong>
              </p>
            </div>
          </div>
          <button
            id="btn-close-cadastrar-modal"
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Product Summary Card */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-gray-900 uppercase leading-snug">
                  {produto.descricao}
                </h3>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 mt-1">
                  <span className="flex items-center gap-1 font-bold">
                    <Package className="w-3.5 h-3.5 text-blue-700 stroke-[2.5]" />
                    <span>{produto.embalagem}</span>
                  </span>
                  {eanConsultado && (
                    <span className="font-mono text-gray-500 font-bold">
                      EAN: {eanConsultado}
                    </span>
                  )}
                </div>
              </div>

              {!isEditing && onChangeProduto && (
                <button
                  type="button"
                  id="btn-trocar-produto-cadastro"
                  onClick={onChangeProduto}
                  className="shrink-0 text-xs font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Trocar mercadoria a cadastrar"
                >
                  <Search className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Trocar</span>
                </button>
              )}
            </div>

            <div className="pt-2 border-t border-gray-200 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
              <span>
                Estoque atual: <strong className="text-gray-900 font-mono font-bold">{produto.estoque_total} un</strong>
              </span>
              <span>
                Venda 30d: <strong className="text-gray-900 font-mono font-bold">{produto.vendas_qtde_30d} un</strong> (~{(produto.vendas_qtde_30d / 30).toFixed(1)}/dia)
              </span>
              {precoVendaBase !== undefined && precoVendaBase > 0 && (
                <span className="text-blue-900 font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  Preço Venda Normal: <strong className="font-mono">R$ {precoVendaBase.toFixed(2).replace('.', ',')}</strong>
                </span>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-black flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 stroke-[2.5]" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Data de Validade */}
          <div className="space-y-2">
            <label htmlFor="input-data-validade" className="block text-xs font-black text-gray-800 uppercase tracking-wider">
              1. Data de Validade *
            </label>
            <div className="relative">
              <input
                id="input-data-validade"
                type="date"
                required
                value={dataValidade}
                onChange={(e) => setDataValidade(e.target.value)}
                className="w-full bg-white border-2 border-gray-300 focus:border-blue-700 rounded-xl px-3.5 py-3 text-base font-black font-mono text-gray-900 focus:outline-hidden transition-all shadow-2xs"
              />
            </div>

            {/* Quick preset buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[11px] font-bold text-gray-400 self-center mr-1 uppercase">Atalhos:</span>
              {[
                { label: '+3 dias', days: 3 },
                { label: '+7 dias', days: 7 },
                { label: '+15 dias', days: 15 },
                { label: '+30 dias', days: 30 },
                { label: '+60 dias', days: 60 },
              ].map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => handleSetPresetDays(preset.days)}
                  className="px-2.5 py-1 rounded-md bg-gray-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-gray-200 text-gray-700 text-xs font-black uppercase transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Section 2: Quantidade Total em Unidades & Packaging Conversion */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="input-quantidade-lote" className="block text-xs font-black text-gray-800 uppercase tracking-wider">
                2. Quantidade Total (Unidades) *
              </label>
              <span className="text-xs text-blue-700 font-bold flex items-center gap-1 uppercase">
                <Boxes className="w-3.5 h-3.5 stroke-[2.5]" />
                Conversão Automática
              </span>
            </div>

            <div className="flex gap-2">
              <input
                id="input-quantidade-lote"
                type="number"
                min="1"
                step="1"
                required
                inputMode="numeric"
                value={quantidadeStr}
                onChange={(e) => setQuantidadeStr(e.target.value)}
                placeholder="Ex: 17"
                className="w-1/2 bg-white border-2 border-gray-300 focus:border-blue-700 rounded-xl px-3.5 py-3 text-lg font-black text-gray-900 focus:outline-hidden transition-all shadow-2xs font-mono"
              />

              {/* Converted Box result card */}
              <div className="w-1/2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 flex flex-col justify-center">
                <span className="text-[10px] uppercase font-black text-blue-700 tracking-wider">
                  Equivalência Embalagem
                </span>
                <span className="text-xs font-black text-blue-950 leading-tight">
                  {conversaoTexto}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-gray-500 font-medium">
              * Digite a quantidade total em unidades avulsas ({produto.embalagem}).
            </p>
          </div>

          {/* Section 3: Preço de Rebaixe / Preço Trabalhado (NOVA SEÇÃO DESTAQUE) */}
          <div className="space-y-2.5 bg-amber-50/60 border-2 border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <label htmlFor="input-preco-rebaixe" className="text-xs font-black text-amber-950 uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-amber-700 stroke-[2.5]" />
                <span>3. Preço de Rebaixe / Preço Trabalhado</span>
              </label>
              <span className="text-[10px] uppercase font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                Ação Comercial
              </span>
            </div>

            {/* Price input + Date of Markdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="input-preco-rebaixe" className="block text-[11px] font-bold text-gray-700 mb-1">
                  Preço Rebaixado (R$):
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none text-xs font-black text-gray-500">
                    R$
                  </div>
                  <input
                    id="input-preco-rebaixe"
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 8,90"
                    value={precoTrabalhado}
                    onChange={(e) => {
                      setPrecoTrabalhado(e.target.value);
                      if (e.target.value && !dataPreco) {
                        setDataPreco(new Date().toISOString().slice(0, 10));
                      }
                    }}
                    className="w-full pl-9 pr-8 py-2.5 bg-white border-2 border-amber-300 focus:border-amber-600 rounded-xl text-base font-black font-mono text-gray-900 focus:outline-hidden shadow-2xs"
                  />
                  {precoTrabalhado && (
                    <button
                      type="button"
                      onClick={() => setPrecoTrabalhado('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                      title="Limpar preço"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="input-data-preco" className="block text-[11px] font-bold text-gray-700 mb-1">
                  Data do Rebaixe:
                </label>
                <input
                  id="input-data-preco"
                  type="date"
                  value={dataPreco}
                  onChange={(e) => setDataPreco(e.target.value)}
                  className="w-full py-2.5 px-3 bg-white border-2 border-gray-300 focus:border-amber-600 rounded-xl text-xs font-bold font-mono text-gray-900 focus:outline-hidden shadow-2xs"
                />
              </div>
            </div>

            {/* Quick Discount Percentage Buttons based on Normal Price */}
            {precoVendaBase !== undefined && precoVendaBase > 0 && (
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-gray-600 uppercase flex items-center gap-1">
                    <TrendingDown className="w-3 h-3 text-amber-700" />
                    Atalhos de Rebaixe sobre R$ {precoVendaBase.toFixed(2).replace('.', ',')}:
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[10, 20, 30, 40, 50].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleApplyQuickDiscount(pct)}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-black uppercase transition-colors shadow-2xs"
                    >
                      -{pct}% (R$ {(precoVendaBase * (1 - pct / 100)).toFixed(2).replace('.', ',')})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Discount Evaluation Banner */}
            {percentualDesconto !== null && economiaPorUnidade !== null && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
                  <span>Desconto de <strong>-{percentualDesconto}%</strong> aplicado</span>
                </span>
                <span className="font-mono text-emerald-800">
                  Economia de <strong>R$ {economiaPorUnidade.toFixed(2).replace('.', ',')}</strong>/un
                </span>
              </div>
            )}
          </div>

          {/* Section: Live Projection Preview */}
          {projecaoPreview && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-blue-700 stroke-[2.5]" />
                  Avaliação Operacional Prévia
                </span>
                <StatusBadge status={projecaoPreview.status} size="sm" />
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-white p-2 rounded-lg border border-gray-200">
                  <span className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider">Dias Restantes</span>
                  <strong className={`text-sm font-black font-mono ${projecaoPreview.dias_restantes <= 3 ? 'text-red-600' : 'text-gray-900'}`}>
                    {projecaoPreview.dias_restantes} dias
                  </strong>
                </div>
                <div className="bg-white p-2 rounded-lg border border-gray-200">
                  <span className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider">Saída Proj.</span>
                  <strong className="text-sm font-black font-mono text-gray-900">
                    {projecaoPreview.saida_projetada} un
                  </strong>
                </div>
                <div className="bg-white p-2 rounded-lg border border-gray-200">
                  <span className="block text-[10px] text-gray-400 font-bold uppercase tracking-wider">Sobra Estim.</span>
                  <strong className={`text-sm font-black font-mono ${projecaoPreview.sobra_projetada > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {projecaoPreview.sobra_projetada} un
                  </strong>
                </div>
              </div>

              <p className="text-xs text-gray-600 font-medium">
                {projecaoPreview.motivo_alerta}
              </p>
            </div>
          )}

          {/* Section: Informações Opcionais (Lote, Obs, Enviar ao Comprador) */}
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="input-lote-id" className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Nº do Lote (Opcional)
                </label>
                <input
                  id="input-lote-id"
                  type="text"
                  value={loteIdentificador}
                  onChange={(e) => setLoteIdentificador(e.target.value)}
                  placeholder="Ex: L1029"
                  className="w-full bg-white border border-gray-300 focus:border-blue-700 rounded-lg px-3 py-2 text-xs font-bold font-mono text-gray-900 focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="input-observacao-lote" className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Localização / Obs
                </label>
                <input
                  id="input-observacao-lote"
                  type="text"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Ex: Ponta de gôndola, rebaixado..."
                  className="w-full bg-white border border-gray-300 focus:border-blue-700 rounded-lg px-3 py-2 text-xs font-bold text-gray-900 focus:outline-hidden"
                />
              </div>
            </div>

            {/* Checkbox: Enviar ao Comprador */}
            <label className="flex items-center gap-2.5 p-3 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100/70 cursor-pointer select-none">
              <input
                id="checkbox-enviar-comprador"
                type="checkbox"
                checked={enviarComprador}
                onChange={(e) => setEnviarComprador(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
              />
              <div className="flex-1">
                <span className="text-xs font-black text-purple-900 uppercase flex items-center gap-1">
                  <Send className="w-3.5 h-3.5 text-purple-700 stroke-[2.5]" />
                  Sinalizar para "Enviar ao Comprador"
                </span>
                <span className="block text-[10px] text-purple-700 font-medium">
                  Marca para inclusão imediata no relatório de negociação/troca com compras.
                </span>
              </div>
            </label>
          </div>

          {/* List of other existing lots already registered for this product */}
          {lotesExistentes.length > 0 && (
            <div className="border-t border-gray-200 pt-3">
              <span className="text-xs font-black uppercase text-gray-700 block mb-2">
                Outros Lotes deste produto ({lotesExistentes.length}):
              </span>
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {lotesExistentes.map((lote) => (
                  <div
                    key={lote.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-gray-100 text-xs text-gray-700 border border-gray-200 font-medium"
                  >
                    <div>
                      <span className="font-black font-mono text-gray-900 mr-2">
                        Val: {formatarDataBR(lote.data_validade)}
                      </span>
                      <span className="text-gray-600 font-bold font-mono">
                        {lote.quantidade_total_unidades} un
                      </span>
                      {lote.preco_trabalhado !== undefined && (
                        <span className="text-amber-800 font-bold ml-1.5 font-mono">
                          (R$ {Number(lote.preco_trabalhado).toFixed(2).replace('.', ',')})
                        </span>
                      )}
                      {lote.lote_identificador && (
                        <span className="text-[10px] text-gray-400 ml-1 font-mono">
                          [{lote.lote_identificador}]
                        </span>
                      )}
                    </div>
                    {lote.enviar_ao_comprador && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-black uppercase">
                        Comprador
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex gap-2">
            <button
              id="btn-cancelar-lote"
              type="button"
              onClick={onClose}
              className="w-1/3 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-black uppercase text-xs hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              id="btn-salvar-vencimento"
              type="submit"
              className="flex-1 py-3 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-950 text-white font-black uppercase text-xs tracking-wider shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>{isEditing ? 'Atualizar Vencimento' : 'Salvar Vencimento'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

