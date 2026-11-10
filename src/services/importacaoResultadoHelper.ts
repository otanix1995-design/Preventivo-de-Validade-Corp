import { ResultadoPublicacaoBase } from './firestorePublishGuard';

export type ImportModalPhase =
  | 'PROCESSING'
  | 'CONFIRMED'
  | 'AUTH_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'LOCAL_ONLY'
  | 'PENDING_CONFIRMATION'
  | 'ERROR';

export interface ImportacaoEstadoFinalUI {
  phase: ImportModalPhase;
  progressPercent: number;
  shouldAutoClose: boolean;
  titulo: string;
  mensagem: string;
  detalheTecnico?: string;
}

export function resolverEstadoPublicacaoImportacao(
  nomeBase: 'BASE RUB' | 'SPCOI007' | 'SAEOU060',
  resultado: ResultadoPublicacaoBase,
  ultimoProgressoAtual: number,
  resumoLocal: string
): ImportacaoEstadoFinalUI {
  const safeProgress = Math.min(96, Math.max(70, Math.round(ultimoProgressoAtual || 85)));

  if (resultado.sucesso && resultado.versaoConfirmadaNoServidor) {
    const semAlteracoesTexto = resultado.semAlteracoesPulouEnvio
      ? `Sem alterações em relação à versão ativa na nuvem (${resultado.versaoId || 'oficial'}) — 0 escritas consumidas.`
      : `Versão ativa confirmada no Firestore (${resultado.versaoId || 'oficial'}).`;

    return {
      phase: 'CONFIRMED',
      progressPercent: 100,
      shouldAutoClose: true,
      titulo: resultado.semAlteracoesPulouEnvio
        ? `${nomeBase} já atualizada e íntegra na nuvem`
        : `${nomeBase} publicada e confirmada na nuvem`,
      mensagem: `${resumoLocal} ${semAlteracoesTexto}`,
      detalheTecnico: resultado.mensagem,
    };
  }

  if (resultado.estadoPublicacao === 'AGUARDANDO_COTA' || resultado.aguardandoCota) {
    return {
      phase: 'QUOTA_EXCEEDED',
      progressPercent: Math.min(86, safeProgress),
      shouldAutoClose: false,
      titulo: `${nomeBase} salva localmente — Aguardando liberação da cota Firebase Spark`,
      mensagem:
        'A base foi gravada com segurança no IndexedDB deste dispositivo, mas o envio em nuvem está pausado porque a cota diária gratuita do Firebase Spark foi atingida (resource-exhausted). Nenhuma retentativa automática será disparada.',
      detalheTecnico: resultado.mensagem,
    };
  }

  if (resultado.estadoPublicacao === 'RECUSADA_PERMISSAO') {
    return {
      phase: 'AUTH_REQUIRED',
      progressPercent: Math.min(86, safeProgress),
      shouldAutoClose: false,
      titulo: `${nomeBase} salva localmente — Requer perfil GERENCIA_ADMIN`,
      mensagem:
        'Os dados foram gravados no IndexedDB deste dispositivo, porém apenas usuários autenticados com perfil GERENCIA_ADMIN podem publicar na nuvem central da Filial 172.',
      detalheTecnico: resultado.motivoRecusa || resultado.mensagem,
    };
  }

  if (resultado.estadoPublicacao === 'PENDENTE_CONFIRMACAO') {
    const chunkText =
      resultado.chunkFalhou !== undefined ? ` (parte pendente: chunk_${resultado.chunkFalhou})` : '';
    return {
      phase: 'PENDING_CONFIRMATION',
      progressPercent: safeProgress,
      shouldAutoClose: false,
      titulo: `${nomeBase} salva localmente — Confirmação na nuvem pendente`,
      mensagem:
        `A gravação local no IndexedDB foi concluída, mas o envio para o Firestore excedeu o tempo limite${chunkText}. A versão NÃO foi ativada na nuvem. Aguarde a conexão estabilizar antes de tentar novamente.`,
      detalheTecnico: resultado.mensagem,
    };
  }

  if (resultado.estadoPublicacao === 'LOCAL_SEM_NUVEM') {
    return {
      phase: 'LOCAL_ONLY',
      progressPercent: Math.min(86, safeProgress),
      shouldAutoClose: false,
      titulo: `${nomeBase} armazenada apenas localmente`,
      mensagem:
        'Os dados foram gravados com segurança no IndexedDB deste dispositivo, sem envio para a nuvem central no momento.',
      detalheTecnico: resultado.mensagem,
    };
  }

  return {
    phase: 'ERROR',
    progressPercent: safeProgress,
    shouldAutoClose: false,
    titulo: `${nomeBase} salva localmente — Falha na publicação em nuvem`,
    mensagem:
      'Os dados locais foram preservados no IndexedDB, mas a publicação na nuvem central falhou e a versão ativa anterior não foi substituída.',
    detalheTecnico: resultado.mensagem,
  };
}
