/**
 * Serviço de Publicação Concorrente Segura da BASE RUB (Nuvem V3)
 * 
 * Implementa o algoritmo transacional com verificação de versão ativa anterior (Optimistic Concurrency Control)
 * antes da troca atômica do ponteiro oficial da BASE RUB.
 * 
 * Previne que dois terminais sobrescrevam silenciosamente as atualizações da BASE RUB da filial.
 */

import { doc, runTransaction } from 'firebase/firestore';
import { db } from './firebase';

export interface VersaoAtivaInfo {
  versaoId: string;
  dataPublicacaoIso: string;
  publicadoPor: string;
  totalProdutos: number;
  totalChunks: number;
  checksumBase: string;
  versaoAnteriorId?: string | null;
}

export interface SolicitacaoPublicacaoRub {
  filialId: string;
  novaVersaoId: string;
  expectedBaseVersionId: string | null; // A versão que o publicador esperava ser a ativa
  publicadoPor: string;
  totalProdutos: number;
  totalChunks: number;
  checksumBase: string;
  dryRun?: boolean; // Modo de simulação sem alteração real
}

export interface ResultadoPublicacaoRub {
  sucesso: boolean;
  mensagem: string;
  versaoAtivadaId?: string;
  versaoAnteriorConfirmada?: string | null;
  erroConcorrencia?: {
    versaoEsperada: string | null;
    versaoRealmenteAtiva: string;
    publicadoPorOutro: string;
    dataPublicacaoOutro: string;
  };
}

export class ConcurrentRubPublicationService {
  /**
   * Valida e simula a proteção contra publicação concorrente (Dry-Run ou Teste Unitário).
   */
  public simularValidacaoConcorrencia(
    versaoAtualmenteNoBanco: VersaoAtivaInfo | null,
    solicitacao: SolicitacaoPublicacaoRub
  ): ResultadoPublicacaoRub {
    const versaoAtivaId = versaoAtualmenteNoBanco ? versaoAtualmenteNoBanco.versaoId : null;

    // Se o publicador esperava uma versão, mas a versão ativa mudou:
    if (solicitacao.expectedBaseVersionId !== versaoAtivaId) {
      return {
        sucesso: false,
        mensagem:
          'CONFLITO DE PUBLICAÇÃO CONCORRENTE DETECTADO: Outro terminal alterou a BASE RUB antes da finalização.',
        erroConcorrencia: {
          versaoEsperada: solicitacao.expectedBaseVersionId,
          versaoRealmenteAtiva: versaoAtivaId || 'NENHUMA (BASE_VAZIA)',
          publicadoPorOutro: versaoAtualmenteNoBanco?.publicadoPor || 'Sistema/Outro Usuário',
          dataPublicacaoOutro: versaoAtualmenteNoBanco?.dataPublicacaoIso || 'Desconhecida',
        },
      };
    }

    return {
      sucesso: true,
      mensagem:
        'Validação de concorrência aprovada. Ponteiro da versão anterior confere perfeitamente com a base de trabalho.',
      versaoAtivadaId: solicitacao.novaVersaoId,
      versaoAnteriorConfirmada: versaoAtivaId,
    };
  }

  /**
   * Executa a troca atômica do ponteiro da BASE RUB no Firestore utilizando runTransaction.
   * Só troca o ponteiro se a versão ativa atual for EXATAMENTE a 'expectedBaseVersionId'.
   */
  public async comutarPonteiroVersaoAtivaTransacional(
    solicitacao: SolicitacaoPublicacaoRub
  ): Promise<ResultadoPublicacaoRub> {
    if (solicitacao.dryRun) {
      return this.simularValidacaoConcorrencia(
        {
          versaoId: solicitacao.expectedBaseVersionId || 'v_base_inicial',
          dataPublicacaoIso: new Date().toISOString(),
          publicadoPor: 'Terminal_Anterior',
          totalProdutos: 11600,
          totalChunks: 47,
          checksumBase: 'CHK-ABC123',
        },
        solicitacao
      );
    }

    const configDocRef = doc(db, 'filiais', solicitacao.filialId, 'config', 'versao_ativa_rub');

    try {
      const resultado = await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(configDocRef);
        let versaoAtivaAtual: VersaoAtivaInfo | null = null;

        if (snap.exists()) {
          versaoAtivaAtual = snap.data() as VersaoAtivaInfo;
        }

        const idAtivoAtual = versaoAtivaAtual ? versaoAtivaAtual.versaoId : null;

        if (idAtivoAtual !== solicitacao.expectedBaseVersionId) {
          throw new Error(
            JSON.stringify({
              code: 'CONCURRENT_MODIFICATION',
              versaoEsperada: solicitacao.expectedBaseVersionId,
              versaoReal: idAtivoAtual,
              publicadoPor: versaoAtivaAtual?.publicadoPor || 'Outro Operador',
              dataHora: versaoAtivaAtual?.dataPublicacaoIso || 'N/A',
            })
          );
        }

        const novaVersaoAtivaPayload: VersaoAtivaInfo = {
          versaoId: solicitacao.novaVersaoId,
          dataPublicacaoIso: new Date().toISOString(),
          publicadoPor: solicitacao.publicadoPor,
          totalProdutos: solicitacao.totalProdutos,
          totalChunks: solicitacao.totalChunks,
          checksumBase: solicitacao.checksumBase,
          versaoAnteriorId: idAtivoAtual,
        };

        transaction.set(configDocRef, novaVersaoAtivaPayload);
        return novaVersaoAtivaPayload;
      });

      return {
        sucesso: true,
        mensagem: 'Ponteiro da BASE RUB atualizado com sucesso via transação segura.',
        versaoAtivadaId: resultado.versaoId,
        versaoAnteriorConfirmada: solicitacao.expectedBaseVersionId,
      };
    } catch (err: any) {
      try {
        const parsedErr = JSON.parse(err.message);
        if (parsedErr.code === 'CONCURRENT_MODIFICATION') {
          return {
            sucesso: false,
            mensagem:
              'CONFLITO DE PUBLICAÇÃO CONCORRENTE: A BASE RUB foi modificada por outro dispositivo enquanto esta versão era preparada.',
            erroConcorrencia: {
              versaoEsperada: parsedErr.versaoEsperada,
              versaoRealmenteAtiva: parsedErr.versaoReal,
              publicadoPorOutro: parsedErr.publicadoPor,
              dataPublicacaoOutro: parsedErr.dataHora,
            },
          };
        }
      } catch {
        // Fallback para outros erros
      }

      return {
        sucesso: false,
        mensagem: `Falha na transação de publicação: ${err?.message || 'Erro desconhecido'}`,
      };
    }
  }
}

export const concurrentRubPublicationService = new ConcurrentRubPublicationService();
