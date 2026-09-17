import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  Calendar,
  Check,
  DollarSign,
  Eye,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Tag,
  TrendingDown,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { parseEmbalagem } from '../services/codeParser';
import { DuplicateValidationResult } from '../services/duplicateValidator';
import { calcularProjecaoVencimento, formatarDataBR } from '../services/projection';
import { formatarMoedaBR, parseMoedaBR } from '../services/deviceId';
import {
  addVencimento,
  checkDuplicateVencimento,
  getVencimentosByCodigoInterno,
  updateVencimento
} from '../services/storage';
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
  const [activeLoteParaEditar, setActiveLoteParaEditar] = useState<LoteVencimento | null>(
    loteParaEditar || null
  );
  const [isViewingExistingLote, setIsViewingExistingLote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = Boolean(activeLoteParaEditar);

  const [dataValidade, setDataValidade] = useState<string>(() => {
    if (loteParaEditar?.data_validade) return loteParaEditar.data_validade;
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  const [quantidadeStr, setQuantidadeStr] = useState<string>(() => {
    return loteParaEditar?.quantidade_total_unidades ? String(loteParaEditar.quantidade_total_unidades) : '12';
  });

  const [precoNormal, setPrecoNormal] = useState<string>(() => {
    const val = loteParaEditar?.precoNormal ?? loteParaEditar?.preco_normal;
    return val !== undefined && val !== null ? String(val).replace('.', ',') : '';
  });

  const [precoTrabalhado, setPrecoTrabalhado] = useState<string>(() => {
    const val = loteParaEditar?.precoTrabalhado ?? loteParaEditar?.preco_trabalhado;
    return val !== undefined && val !== null ? String(val).replace('.', ',') : '';
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
    setActiveLoteParaEditar(loteParaEditar || null);
    setIsViewingExistingLote(false);
    setIsSubmitting(false);

    if (loteParaEditar) {
      const pNorm = loteParaEditar.precoNormal ?? loteParaEditar.preco_normal;
      const pTrab = loteParaEditar.precoTrabalhado ?? loteParaEditar.preco_trabalhado;
      setDataValidade(loteParaEditar.data_validade || '');
      setQuantidadeStr(String(loteParaEditar.quantidade_total_unidades || '12'));
      setPrecoNormal(pNorm !== undefined && pNorm !== null ? String(pNorm).replace('.', ',') : '');
      setPrecoTrabalhado(pTrab !== undefined && pTrab !== null ? String(pTrab).replace('.', ',') : '');
      setDataPreco(loteParaEditar.data_preco || '');
      setObservacao(loteParaEditar.observacao || '');
      setLoteIdentificador(loteParaEditar.lote_identificador || '');
      setEnviarComprador(Boolean(loteParaEditar.enviar_ao_comprador));
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      setDataValidade(d.toISOString().slice(0, 10));
      setQuantidadeStr('12');
      setPrecoNormal('');
      setPrecoTrabalhado('');
      setDataPreco('');
      setObservacao('');
      setLoteIdentificador('');
      setEnviarComprador(false);
    }
    setErrorMsg(null);
  }, [loteParaEditar, isOpen]);

  // Handler for user switching to view/edit the existing registered lot
  const handleVerCadastroExistente = (existingLote: LoteVencimento) => {
    setActiveLoteParaEditar(existingLote);
    setIsViewingExistingLote(true);
    const pNorm = existingLote.precoNormal ?? existingLote.preco_normal;
    const pTrab = existingLote.precoTrabalhado ?? existingLote.preco_trabalhado;
    setDataValidade(existingLote.data_validade || '');
    setQuantidadeStr(String(existingLote.quantidade_total_unidades || '12'));
    setPrecoNormal(pNorm !== undefined && pNorm !== null ? String(pNorm).replace('.', ',') : '');
    setPrecoTrabalhado(pTrab !== undefined && pTrab !== null ? String(pTrab).replace('.', ',') : '');
    setDataPreco(existingLote.data_preco || '');
    setObservacao(existingLote.observacao || '');
    setLoteIdentificador(existingLote.lote_identificador || '');
    setEnviarComprador(Boolean(existingLote.enviar_ao_comprador));
    setErrorMsg(null);
  };

  // Handler for user returning to a new lot registration
  const handleVoltarNovoCadastro = () => {
    setActiveLoteParaEditar(null);
    setIsViewingExistingLote(false);
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setDataValidade(d.toISOString().slice(0, 10));
    setQuantidadeStr('12');
    setPrecoNormal('');
    setPrecoTrabalhado('');
    setDataPreco('');
    setObservacao('');
    setLoteIdentificador('');
    setEnviarComprador(false);
    setErrorMsg(null);
  };

  // Real-time check for duplicate lot (Same Product + Same Expiration Date)
  const duplicateInfo = useMemo(() => {
    if (!produto || !dataValidade) return null;
    const res = checkDuplicateVencimento(
      {
        codigo_interno: produto.codigo_interno,
        digito: produto.digito,
        codigo_exibicao: produto.codigo_exibicao,
        descricao_produto: produto.descricao,
        data_validade: dataValidade,
      },
      activeLoteParaEditar?.id
    );
    return res.isDuplicate ? res : null;
  }, [produto, dataValidade, activeLoteParaEditar]);

  // Existing lots for this product (excluding current if editing)
  const lotesExistentes = useMemo(() => {
    if (!produto) return [];
    return getVencimentosByCodigoInterno(produto.codigo_interno).filter(
      (l) => !isEditing || l.id !== activeLoteParaEditar?.id
    );
  }, [produto, isEditing, activeLoteParaEditar]);

  // Packaging calculation
  const embData = parseEmbalagem(produto?.embalagem || '');
  const quantidadeNum = parseInt(quantidadeStr, 10) || 0;
  const conversaoTexto = embData.descricao_formatada(quantidadeNum);

  // Price calculations & discount percentages
  const precoVendaBase = produto?.vendas_preco;
  const precoNormalNum = useMemo(() => parseMoedaBR(precoNormal), [precoNormal]);
  const precoTrabalhadoNum = useMemo(() => parseMoedaBR(precoTrabalhado), [precoTrabalhado]);

  // Preço base de cálculo comercial (DE): se o usuário informou o Preço Normal, usa ele; senão usa o preço de venda da SMG se houver
  const precoBaseReferencia = precoNormalNum !== null ? precoNormalNum : precoVendaBase;

  let percentualDesconto: number | null = null;
  let economiaPorUnidade: number | null = null;
  let precoInconsistente = false;

  if (precoNormalNum !== null && precoTrabalhadoNum !== null) {
    if (precoTrabalhadoNum >= precoNormalNum) {
      precoInconsistente = true;
    } else {
      economiaPorUnidade = Number((precoNormalNum - precoTrabalhadoNum).toFixed(2));
      percentualDesconto = Math.round(((precoNormalNum - precoTrabalhadoNum) / precoNormalNum) * 100);
    }
  } else if (precoBaseReferencia && precoBaseReferencia > 0 && precoTrabalhadoNum && precoTrabalhadoNum > 0) {
    if (precoTrabalhadoNum < precoBaseReferencia) {
      economiaPorUnidade = Number((precoBaseReferencia - precoTrabalhadoNum).toFixed(2));
      percentualDesconto = Math.round(((precoBaseReferencia - precoTrabalhadoNum) / precoBaseReferencia) * 100);
    }
  }

  // Quick discount calculation helper
  const handleApplyQuickDiscount = (pct: number) => {
    if (!precoBaseReferencia || precoBaseReferencia <= 0) return;
    const discounted = precoBaseReferencia * (1 - pct / 100);
    setPrecoTrabalhado(discounted.toFixed(2).replace('.', ','));
    if (!dataPreco) {
      setDataPreco(new Date().toISOString().slice(0, 10));
    }
  };

  // Temporary mock lot for live projection preview
  const previewLote: LoteVencimento | null = produto ? {
    id: activeLoteParaEditar?.id || 'preview',
    codigo_interno: produto.codigo_interno,
    digito: produto.digito,
    codigo_exibicao: produto.codigo_exibicao,
    descricao_produto: produto.descricao,
    embalagem: produto.embalagem,
    fator_embalagem: produto.fator_embalagem,
    data_validade: dataValidade,
    quantidade_total_unidades: quantidadeNum,
    preco_normal: precoNormalNum,
    precoNormal: precoNormalNum,
    preco_trabalhado: precoTrabalhadoNum,
    precoTrabalhado: precoTrabalhadoNum,
    data_preco: dataPreco || undefined,
    enviar_ao_comprador: enviarComprador,
    criado_em: activeLoteParaEditar?.criado_em || new Date().toISOString(),
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

    // 8. PROTEGER CONTRA CLIQUE DUPLO
    if (isSubmitting) return;

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

    if (precoNormal.trim()) {
      if (precoNormalNum === null || precoNormalNum < 0) {
        setErrorMsg('Informe um valor de Preço Normal (DE) válido (ex: 14,99).');
        return;
      }
    }

    if (precoTrabalhado.trim()) {
      if (precoTrabalhadoNum === null || precoTrabalhadoNum < 0) {
        setErrorMsg('Informe um valor de Preço de Rebaixe (POR) válido (ex: 9,99).');
        return;
      }
    }

    // Validação estrita: Preço de Rebaixe < Preço Normal (quando ambos informados)
    if (precoNormalNum !== null && precoTrabalhadoNum !== null && precoTrabalhadoNum >= precoNormalNum) {
      setErrorMsg(
        `Inconsistência de preços: O Preço de Rebaixe (${formatarMoedaBR(precoTrabalhadoNum)}) não pode ser maior ou igual ao Preço Normal (${formatarMoedaBR(precoNormalNum)}). Por favor, ajuste os valores.`
      );
      return;
    }

    const dataPrecoFinal = precoTrabalhadoNum !== null
      ? (dataPreco || new Date().toISOString().slice(0, 10))
      : undefined;

    // 7. VALIDAÇÃO NO MOMENTO DO SALVAMENTO (Não confiar somente em validação visual)
    // 1. Obter Código Interno
    // 2. Obter Dígito
    // 3. Normalizar a data
    // 4. Consultar os vencimentos existentes
    // 5. Procurar registro com o mesmo produto e mesma data
    // 6. Se existir -> BLOQUEAR
    const duplicateCheck = checkDuplicateVencimento(
      {
        codigo_interno: produto.codigo_interno,
        digito: produto.digito,
        codigo_exibicao: produto.codigo_exibicao,
        descricao_produto: produto.descricao,
        data_validade: dataValidade,
      },
      activeLoteParaEditar?.id
    );

    if (duplicateCheck.isDuplicate && duplicateCheck.existingLote) {
      setErrorMsg(
        duplicateCheck.message ||
          `Este produto já possui um vencimento cadastrado para ${duplicateCheck.dataValidadeFormatada || dataValidade}.`
      );
      return; // INTERROMPER GRAVAÇÃO! NÃO SALVAR!
    }

    // Trava de submissão (desabilita botão e previne cliques repetidos)
    setIsSubmitting(true);

    try {
      let loteResultado: LoteVencimento;

      if (isEditing && activeLoteParaEditar) {
        const updated = await updateVencimento(activeLoteParaEditar.id, {
          data_validade: dataValidade,
          quantidade_total_unidades: quantidadeNum,
          preco_normal: precoNormalNum,
          precoNormal: precoNormalNum,
          preco_trabalhado: precoTrabalhadoNum,
          precoTrabalhado: precoTrabalhadoNum,
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
          preco_normal: precoNormalNum,
          precoNormal: precoNormalNum,
          preco_trabalhado: precoTrabalhadoNum,
          precoTrabalhado: precoTrabalhadoNum,
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
    } catch (err: any) {
      console.error('Erro ao salvar vencimento:', err);
      setErrorMsg(err?.message || 'Erro inesperado ao salvar o lote.');
    } finally {
      setIsSubmitting(false);
    }
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
          {/* Header title */}
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
                {isViewingExistingLote
                  ? 'EDITAR VENCIMENTO EXISTENTE'
                  : isEditing
                  ? 'EDITAR VENCIMENTO'
                  : 'CADASTRAR VENCIMENTO'}
              </h2>
              <p className="text-xs text-blue-200 font-mono font-bold">
                CÓD: <strong>{produto.codigo_exibicao}</strong>
              </p>
            </div>
          </div>
          <button
            id="btn-close-cadastrar-modal"
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Active view mode indicator if viewing existing lote */}
          {isViewingExistingLote && (
            <div
              id="banner-modo-edicao-existente"
              className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-950 flex items-center justify-between gap-3 shadow-xs"
            >
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 block">
                  MODO DE EDIÇÃO
                </span>
                <p className="text-xs font-black uppercase text-blue-950">
                  Visualizando cadastro existente deste vencimento
                </p>
                <p className="text-[11px] text-blue-800 mt-0.5">
                  Você pode atualizar quantidade, preço ou observação deste lote.
                </p>
              </div>
              <button
                type="button"
                id="btn-voltar-novo-cadastro"
                onClick={handleVoltarNovoCadastro}
                className="shrink-0 text-xs font-black uppercase text-blue-800 hover:text-blue-950 bg-white hover:bg-blue-100 border border-blue-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                title="Voltar ao modo de cadastrar novo lote"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Novo</span>
              </button>
            </div>
          )}

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
                className={`w-full bg-white border-2 rounded-xl px-3.5 py-3 text-base font-black font-mono text-gray-900 focus:outline-hidden transition-all shadow-2xs ${
                  duplicateInfo
                    ? 'border-amber-500 bg-amber-50/40 text-amber-950'
                    : 'border-gray-300 focus:border-blue-700'
                }`}
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
                  className="px-2.5 py-1 rounded-md bg-gray-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-gray-200 text-gray-700 text-xs font-black uppercase transition-colors cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Alerta de Produto Já Cadastrado com a Mesma Data */}
            {duplicateInfo && (
              <div
                id="alerta-produto-duplicado"
                className="p-4 rounded-xl bg-amber-50 border-2 border-amber-500 text-amber-950 space-y-3 shadow-xs mt-2"
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-200 text-amber-900 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-black uppercase tracking-wider text-amber-800 block">
                      PRODUTO JÁ CADASTRADO
                    </span>
                    <h4 className="text-sm font-black uppercase text-gray-950 leading-tight">
                      {duplicateInfo.descricao || produto.descricao}
                    </h4>
                    <div className="text-xs text-amber-900 font-mono font-bold mt-1 space-y-0.5">
                      <p>
                        Código: <strong>{duplicateInfo.codigoExibicao || produto.codigo_exibicao}</strong>
                      </p>
                      <p>
                        Vencimento: <strong>{duplicateInfo.dataValidadeFormatada}</strong>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-amber-200 text-xs font-bold text-amber-950">
                  <p>
                    &ldquo;{duplicateInfo.message ||
                      `Este produto já possui um vencimento cadastrado para ${duplicateInfo.dataValidadeFormatada}.`}&rdquo;
                  </p>
                </div>

                {duplicateInfo.existingLote && (
                  <div className="pt-1">
                    <button
                      id="btn-ver-cadastro-existente"
                      type="button"
                      onClick={() => handleVerCadastroExistente(duplicateInfo.existingLote!)}
                      className="w-full py-2.5 px-3 rounded-lg bg-amber-700 hover:bg-amber-800 active:bg-amber-900 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                    >
                      <Eye className="w-4 h-4 stroke-[2.5]" />
                      <span>[ VER CADASTRO EXISTENTE ]</span>
                    </button>
                  </div>
                )}
              </div>
            )}
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

          {/* Section 3: Preço Normal (DE) e Preço de Rebaixe (POR) */}
          <div className="space-y-2.5 bg-amber-50/60 border-2 border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-amber-950 uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-amber-700 stroke-[2.5]" />
                <span>3. Preços Comerciais (DE / POR)</span>
              </label>
              <span className="text-[10px] uppercase font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                Ação Comercial
              </span>
            </div>

            {/* Inconsistency Alert if Preço Rebaixe >= Preço Normal */}
            {precoInconsistente && precoNormalNum !== null && precoTrabalhadoNum !== null && (
              <div className="p-3 bg-red-50 border-2 border-red-300 rounded-xl text-xs text-red-900 font-bold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-black">Inconsistência de Preços:</p>
                  <p className="font-normal text-[11px] text-red-800">
                    O Preço de Rebaixe ({formatarMoedaBR(precoTrabalhadoNum)}) deve ser menor que o Preço Normal ({formatarMoedaBR(precoNormalNum)}). Por favor, ajuste os valores.
                  </p>
                </div>
              </div>
            )}

            {/* Inputs: Preço Normal (DE), Preço Rebaixado (POR) and Data do Rebaixe */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Preço Normal (DE) */}
              <div>
                <label htmlFor="input-preco-normal" className="block text-[11px] font-bold text-gray-700 mb-1">
                  Preço Normal (DE):
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none text-xs font-black text-gray-500">
                    R$
                  </div>
                  <input
                    id="input-preco-normal"
                    type="text"
                    inputMode="decimal"
                    placeholder={produto.vendas_preco ? `Ex: ${produto.vendas_preco.toFixed(2).replace('.', ',')}` : 'Ex: 14,99'}
                    value={precoNormal}
                    onChange={(e) => setPrecoNormal(e.target.value)}
                    className="w-full pl-9 pr-8 py-2.5 bg-white border-2 border-amber-300 focus:border-amber-600 rounded-xl text-base font-black font-mono text-gray-900 focus:outline-hidden shadow-2xs"
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
                <label htmlFor="input-preco-rebaixe" className="block text-[11px] font-bold text-gray-700 mb-1">
                  Preço Rebaixado (POR):
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none text-xs font-black text-gray-500">
                    R$
                  </div>
                  <input
                    id="input-preco-rebaixe"
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
                    className={`w-full pl-9 pr-8 py-2.5 bg-white border-2 rounded-xl text-base font-black font-mono text-gray-900 focus:outline-hidden shadow-2xs ${
                      precoInconsistente ? 'border-red-500 focus:border-red-600' : 'border-amber-300 focus:border-amber-600'
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

              {/* Data do Rebaixe */}
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
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-black uppercase transition-colors shadow-2xs"
                    >
                      -{pct}% (R$ {(precoBaseReferencia * (1 - pct / 100)).toFixed(2).replace('.', ',')})
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
              disabled={isSubmitting}
              className="w-1/3 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-black uppercase text-xs hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              id="btn-salvar-vencimento"
              type="submit"
              disabled={isSubmitting || Boolean(duplicateInfo)}
              className={`flex-1 py-3 px-4 rounded-xl text-white font-black uppercase text-xs tracking-wider shadow-md flex items-center justify-center gap-2 transition-all ${
                isSubmitting || Boolean(duplicateInfo)
                  ? 'bg-gray-400 cursor-not-allowed opacity-75'
                  : 'bg-blue-700 hover:bg-blue-800 active:bg-blue-950 active:scale-[0.98] cursor-pointer'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Gravando...</span>
                </>
              ) : duplicateInfo ? (
                <>
                  <AlertTriangle className="w-4 h-4 stroke-[3]" />
                  <span>Vencimento Já Cadastrado</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>
                    {isViewingExistingLote
                      ? 'Salvar Alterações do Lote'
                      : isEditing
                      ? 'Atualizar Vencimento'
                      : 'Salvar Vencimento'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

