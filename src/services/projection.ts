import { LoteVencimento, ProdutoSMG, ProjecaoVencimento, StatusVencimento } from '../types';
import { isProdutoPesavel } from './codeParser';

/**
 * Calculates the operational projection and risk metrics for an expiration lot.
 */
export function calcularProjecaoVencimento(
  lote: LoteVencimento,
  produto?: ProdutoSMG,
  dataReferencia: Date = new Date()
): ProjecaoVencimento {
  // Normalize dates to midnight for accurate day difference
  const hoje = new Date(dataReferencia.getFullYear(), dataReferencia.getMonth(), dataReferencia.getDate());
  
  // Parse lot expiration date safely
  let dataValidade: Date;
  if (!lote.data_validade) {
    dataValidade = new Date();
  } else if (lote.data_validade.includes('-')) {
    const [ano, mes, dia] = lote.data_validade.split('-').map((v) => parseInt(v, 10));
    dataValidade = new Date(ano, (mes || 1) - 1, dia || 1);
  } else if (lote.data_validade.includes('/')) {
    const [dia, mes, ano] = lote.data_validade.split('/').map((v) => parseInt(v, 10));
    dataValidade = new Date(ano || 2026, (mes || 1) - 1, dia || 1);
  } else {
    dataValidade = new Date(lote.data_validade);
    if (isNaN(dataValidade.getTime())) {
      dataValidade = new Date();
    }
  }

  const diffMs = dataValidade.getTime() - hoje.getTime();
  const dias_restantes = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const vendas30d = produto?.vendas_qtde_30d ?? 0;
  const diasSemVenda = produto?.dias_sem_venda ?? 0;
  const media_diaria_30d = Number((vendas30d / 30).toFixed(2));

  // Check if product is sold by KG / weighable
  const isPesavel = produto?.embalagem
    ? isProdutoPesavel(produto.embalagem)
    : lote.embalagem
    ? isProdutoPesavel(lote.embalagem)
    : false;
  const unitStr = isPesavel ? 'KG' : 'un';

  // Projected sales until expiration date
  const diasParaCalculo = Math.max(0, dias_restantes);
  const saida_projetada_raw = media_diaria_30d * diasParaCalculo;
  const saida_projetada = Math.round(saida_projetada_raw * 100) / 100;

  // Estimated leftover units or kg
  const sobra_projetada_raw = (lote.quantidade_total_unidades || 0) - saida_projetada;
  const sobra_projetada = Math.max(0, Math.round(sobra_projetada_raw * 100) / 100);

  // Check if "Dias sem Venda" weakens historical projection confidence
  const alerta_dias_sem_venda = diasSemVenda >= 7 && vendas30d > 0;

  // If user flagged "Enviar ao Comprador"
  if (lote.enviar_ao_comprador || lote.status_customizado === 'ENVIAR_AO_COMPRADOR') {
    return {
      dias_restantes,
      media_diaria_30d,
      saida_projetada,
      sobra_projetada,
      status: 'ENVIAR_AO_COMPRADOR',
      motivo_alerta: 'Sinalizado para envio e negociação com o comprador.',
      alerta_dias_sem_venda,
      grau_risco: 'ALTO',
    };
  }

  // Determine status and alert reason
  let status: StatusVencimento = 'NORMAL';
  let motivo_alerta = 'Situação regular com saída projetada suficiente.';
  let grau_risco: 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO' = 'BAIXO';

  if (dias_restantes < 0) {
    status = 'CRITICO';
    motivo_alerta = `PRODUTO VENCIDO há ${Math.abs(dias_restantes)} dia(s)! Retirar imediatamente da área de vendas.`;
    grau_risco = 'CRITICO';
  } else if (dias_restantes === 0) {
    status = 'CRITICO';
    motivo_alerta = 'VENCE HOJE! Retirar ou aplicar ação emergencial de preço.';
    grau_risco = 'CRITICO';
  } else if (dias_restantes <= 3) {
    status = 'CRITICO';
    motivo_alerta = `Vence em ${dias_restantes} dia(s). Prazo crítico de permanência em loja.`;
    grau_risco = 'CRITICO';
  } else if (sobra_projetada > 0 && dias_restantes <= 20) {
    status = 'SAIDA_INSUFICIENTE';
    motivo_alerta = `Saída insuficiente: média diária de ${media_diaria_30d} ${unitStr}/dia projeta sobra de ${sobra_projetada} ${unitStr} até vencer.`;
    grau_risco = 'ALTO';
  } else if (dias_restantes <= 7) {
    status = 'ALERTA';
    motivo_alerta = `Vence em ${dias_restantes} dias. Necessário monitoramento diário.`;
    grau_risco = 'ALTO';
  } else if (dias_restantes <= 15) {
    status = 'ATENCAO';
    motivo_alerta = `Vence em ${dias_restantes} dias. Acompanhar evolução de saída.`;
    grau_risco = 'MEDIO';
  } else if (sobra_projetada > 0 && dias_restantes <= 30) {
    status = 'ALERTA';
    motivo_alerta = `Risco de sobra de ${sobra_projetada} ${unitStr} em 30 dias baseado no histórico de vendas.`;
    grau_risco = 'MEDIO';
  }

  // If custom status was explicitly set by user (and not default NORMAL), respect it
  if (lote.status_customizado && lote.status_customizado !== 'NORMAL') {
    status = lote.status_customizado;
  }

  return {
    dias_restantes,
    media_diaria_30d,
    saida_projetada,
    sobra_projetada,
    status,
    motivo_alerta,
    alerta_dias_sem_venda,
    grau_risco,
  };
}

export function formatarDataBR(isoDateStr: string): string {
  if (!isoDateStr) return '-';
  const parts = isoDateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDateStr;
}

export function formatarDiasRestantes(dias: number): { texto: string; cor: string } {
  if (dias < 0) {
    return { texto: `Vencido há ${Math.abs(dias)}d`, cor: 'text-red-700 font-bold' };
  }
  if (dias === 0) {
    return { texto: 'Vence HOJE', cor: 'text-red-600 font-bold' };
  }
  if (dias === 1) {
    return { texto: 'Vence amanhã (1d)', cor: 'text-red-600 font-semibold' };
  }
  if (dias <= 3) {
    return { texto: `${dias} dias restantes`, cor: 'text-red-600 font-semibold' };
  }
  if (dias <= 7) {
    return { texto: `${dias} dias restantes`, cor: 'text-amber-600 font-medium' };
  }
  if (dias <= 15) {
    return { texto: `${dias} dias restantes`, cor: 'text-yellow-700' };
  }
  return { texto: `${dias} dias restantes`, cor: 'text-slate-600' };
}
