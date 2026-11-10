import React, { useState } from 'react';
import {
  Cloud,
  CloudUpload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Database,
  Clock,
  FileSpreadsheet,
  Building2,
  CalendarClock,
} from 'lucide-react';
import { useTresBasesSyncStatus, baseSyncStatusService, BaseStatusItem } from '../services/baseSyncStatusService';
import { rubSyncService } from '../services/rubSyncService';
import { spcoiSyncService } from '../services/spcoiSyncService';
import { saeouSyncService } from '../services/saeouSyncService';
import { productRepository } from '../services/productRepository';
import { isvService } from '../services/isvService';
import { verificarLiberacaoCotaNoServidor } from '../services/firebase';
import { isModoAtualizacaoLocalAtivo } from '../services/localPackageMode';

interface BasesSyncStatusCardProps {
  compact?: boolean;
}

export const BasesSyncStatusCard: React.FC<BasesSyncStatusCardProps> = ({ compact = false }) => {
  const statusInfo = useTresBasesSyncStatus();
  const [sincronizandoTudo, setSincronizandoTudo] = useState(false);
  const [verificandoCota, setVerificandoCota] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const isQuotaBlocked = Boolean(statusInfo.quotaBloqueada?.bloqueado);
  const modoLocalAtivo = isModoAtualizacaoLocalAtivo();
  const anyPublishing = Boolean(
    statusInfo.rub.emAndamento || statusInfo.spcoi.emAndamento || statusInfo.saeou.emAndamento
  );

  const handleVerificarLiberacaoCota = async () => {
    if (verificandoCota) return;
    setVerificandoCota(true);
    setFeedbackMsg(null);
    try {
      const res = await verificarLiberacaoCotaNoServidor();
      setFeedbackMsg(res.mensagem);
    } finally {
      setVerificandoCota(false);
    }
  };

  const handleSincronizarTudo = async () => {
    if (isQuotaBlocked) {
      setFeedbackMsg('Cota diária gratuita do Firebase Spark aguardando liberação. Use "Verificar Liberação da Cota" após o reset diário.');
      return;
    }
    setSincronizandoTudo(true);
    setFeedbackMsg(null);
    try {
      await baseSyncStatusService.sincronizarTodasBases('172');
      setFeedbackMsg('Verificação das três bases concluída com sucesso!');
      setTimeout(() => setFeedbackMsg(null), 4000);
    } catch (e: any) {
      setFeedbackMsg(`Erro ao sincronizar: ${e?.message || 'Falha de conexão'}`);
    } finally {
      setSincronizandoTudo(false);
    }
  };

  const handlePublicarBase = async (id: 'BASE_RUB' | 'SPCOI007' | 'SAEOU060') => {
    setFeedbackMsg(null);
    try {
      if (id === 'BASE_RUB') {
        const produtos = productRepository.getProdutos();
        const meta = productRepository.getMetadados();
        const res = await rubSyncService.publicarBaseRubCentral(produtos, meta, '172');
        setFeedbackMsg(res.mensagem);
      } else if (id === 'SPCOI007') {
        const fornecedores = isvService.getFornecedores();
        const industrias = isvService.getIndustrias();
        const res = await spcoiSyncService.publicarSpcoiCentral(fornecedores, industrias, undefined, '172');
        setFeedbackMsg(res.mensagem);
      } else if (id === 'SAEOU060') {
        const saeou = productRepository.getSaeou060Registros();
        const res = await saeouSyncService.publicarSaeouCentral(saeou, '172');
        setFeedbackMsg(res.mensagem);
      }
      setTimeout(() => setFeedbackMsg(null), 5000);
    } catch (err: any) {
      setFeedbackMsg(`Erro: ${err?.message || 'Falha na publicação'}`);
    }
  };

  const renderBadge = (status: BaseStatusItem['status']) => {
    switch (status) {
      case 'SINCRONIZADO':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Sincronizado
          </span>
        );
      case 'PUBLICANDO':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300 animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
            Publicando...
          </span>
        );
      case 'PENDENTE_CONFIRMACAO':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-900 border border-orange-300">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
            Confirmação Pendente
          </span>
        );
      case 'BLOQUEADO_COTA':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-400">
            <Clock className="w-3.5 h-3.5 text-amber-700" />
            Aguardando Cota
          </span>
        );
      case 'ERRO':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-300">
            <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
            Erro
          </span>
        );
      case 'LOCAL':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            <Database className="w-3.5 h-3.5 text-amber-600" />
            Local
          </span>
        );
    }
  };

  const bases: { item: BaseStatusItem; icon: React.ReactNode }[] = [
    {
      item: statusInfo.rub,
      icon: <FileSpreadsheet className="w-5 h-5 text-indigo-600" />,
    },
    {
      item: statusInfo.spcoi,
      icon: <Building2 className="w-5 h-5 text-emerald-600" />,
    },
    {
      item: statusInfo.saeou,
      icon: <CalendarClock className="w-5 h-5 text-amber-600" />,
    },
  ];

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {bases.map(({ item }) => (
          <div
            key={item.id}
            className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-md"
            title={`${item.nome}: ${item.mensagem}`}
          >
            <span className="font-semibold text-slate-700">{item.nome}:</span>
            {renderBadge(item.status)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-800/40 rounded-xl p-4 sm:p-5 text-white shadow-lg mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-indigo-800/50">
        <div>
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-indigo-400" />
            <h3 className="font-bold text-base tracking-wide text-white">
              {modoLocalAtivo
                ? 'Situação Local das 3 Bases Operacionais — Filial 172'
                : 'Sincronização Nuvem das 3 Bases Operacionais — Filial 172'}
            </h3>
          </div>
          <p className="text-xs text-indigo-200/80 mt-0.5">
            {modoLocalAtivo
              ? 'Bases pesadas distribuídas via Arquivo Único (.zip) no IndexedDB. Firebase Spark reservado a Vencimentos e Vínculos EAN.'
              : 'Fonte mestre centralizada no Firebase com persistência durável no IndexedDB local'}
          </p>
        </div>

        {!modoLocalAtivo && (
          <button
            type="button"
            onClick={handleSincronizarTudo}
            disabled={sincronizandoTudo || isQuotaBlocked || anyPublishing}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sincronizandoTudo ? 'animate-spin' : ''}`} />
            {isQuotaBlocked
              ? 'Aguardando Cota Spark'
              : sincronizandoTudo
              ? 'Sincronizando...'
              : 'Verificar e Sincronizar Tudo'}
          </button>
        )}
      </div>

      {isQuotaBlocked && (
        <div
          id="spark-quota-lock-banner"
          className="mt-3 px-3.5 py-2.5 rounded-lg bg-amber-950/70 border border-amber-500/60 text-xs text-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="space-y-0.5">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Cota diária gratuita do Firebase Spark aguardando liberação ({statusInfo.quotaBloqueada.recurso})
              </span>
            </div>
            <p className="text-[11px] text-amber-100/90">
              Publicações em nuvem estão pausadas sem retentativas automáticas. Seus dados no IndexedDB e versões já ativas no Firestore permanecem 100% preservados.
            </p>
          </div>
          <button
            type="button"
            onClick={handleVerificarLiberacaoCota}
            disabled={verificandoCota}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] transition-colors disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${verificandoCota ? 'animate-spin' : ''}`} />
            {verificandoCota ? 'Verificando...' : 'Verificar Liberação da Cota (1 leitura)'}
          </button>
        </div>
      )}

      {feedbackMsg && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-indigo-900/60 border border-indigo-500/40 text-xs text-indigo-100 flex items-center justify-between">
          <span>{feedbackMsg}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="text-indigo-300 hover:text-white font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Grid das 3 bases */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-4">
        {bases.map(({ item, icon }) => (
          <div
            key={item.id}
            className="bg-slate-800/60 border border-indigo-800/40 rounded-lg p-3.5 flex flex-col justify-between hover:border-indigo-600/60 transition-colors"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-slate-900/80 border border-slate-700/60">
                    {icon}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-white">{item.nome}</h4>
                    <span className="text-[11px] text-slate-300 leading-none">
                      {item.totalRegistros.toLocaleString('pt-BR')} registros
                    </span>
                  </div>
                </div>
                {renderBadge(item.status)}
              </div>

              <p className="text-[11px] text-slate-300 line-clamp-2 mb-3">
                {item.mensagem}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-mono text-[10px]">
                {item.versaoId ? item.versaoId.split('_').slice(0, 3).join('_') : 'v_local'}
              </span>

              {!modoLocalAtivo &&
                (item.status === 'LOCAL' ||
                  item.status === 'ERRO' ||
                  item.status === 'PENDENTE_CONFIRMACAO' ||
                  item.status === 'BLOQUEADO_COTA') &&
                item.totalRegistros > 0 && (
                <button
                  type="button"
                  onClick={() => handlePublicarBase(item.id)}
                  disabled={item.emAndamento || anyPublishing || isQuotaBlocked}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300 hover:text-white disabled:opacity-40 bg-indigo-900/50 hover:bg-indigo-800/80 px-2 py-0.5 rounded border border-indigo-700/60 transition-colors"
                  title={
                    isQuotaBlocked
                      ? 'Publicação aguardando liberação da cota diária do Firebase Spark'
                      : 'Publicar esta base local no Firestore central da filial 172'
                  }
                >
                  <CloudUpload className="w-3 h-3" />
                  Publicar Central
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
