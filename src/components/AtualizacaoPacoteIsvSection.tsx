import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  Info,
  Loader2,
  Lock,
  PackageCheck,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { EstadoAuthServidor, firebaseAuthService } from '../services/firebaseAuthService';
import { localUpdatePackageService } from '../services/localUpdatePackageService';
import {
  IsvPacoteStatusLocal,
  ResolucaoConflitoPacote,
  ResultadoInspecaoPacoteIsv,
  ResultadoInstalacaoPacoteIsv,
} from '../types';

interface AtualizacaoPacoteIsvSectionProps {
  onPackageInstalled?: () => void;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return 'Indisponível neste navegador';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const AtualizacaoPacoteIsvSection: React.FC<AtualizacaoPacoteIsvSectionProps> = ({
  onPackageInstalled,
}) => {
  const [statusPacote, setStatusPacote] = useState<IsvPacoteStatusLocal>(() =>
    localUpdatePackageService.getStatusPacote()
  );
  const [authEstado, setAuthEstado] = useState<EstadoAuthServidor>(() =>
    firebaseAuthService.getEstado()
  );
  const [storageInfo, setStorageInfo] = useState<{
    usage: number | null;
    quota: number | null;
  }>({ usage: null, quota: null });

  const [emOperacao, setEmOperacao] = useState(false);
  const [progressoPct, setProgressoPct] = useState(0);
  const [progressoTexto, setProgressoTexto] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tipo: 'sucesso' | 'erro' | 'aviso';
    titulo: string;
    mensagem: string;
  } | null>(null);

  // Estado do Modal de Inspeção / Confirmação de Importação
  const [inspecaoAtual, setInspecaoAtual] = useState<ResultadoInspecaoPacoteIsv | null>(null);
  const [modalImportOpen, setModalImportOpen] = useState(false);
  const [confirmouDowngrade, setConfirmouDowngrade] = useState(false);
  const [resolucaoConflito, setResolucaoConflito] =
    useState<ResolucaoConflitoPacote>('SUBSTITUIR_PELO_PACOTE');
  const [resultadoInstalacao, setResultadoInstalacao] =
    useState<ResultadoInstalacaoPacoteIsv | null>(null);

  const fileInputZipRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localUpdatePackageService.init().catch(() => {});
    const unsubPkg = localUpdatePackageService.subscribe(setStatusPacote);
    const unsubAuth = firebaseAuthService.subscribe(setAuthEstado);

    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((est) => {
          setStorageInfo({
            usage: typeof est.usage === 'number' ? est.usage : null,
            quota: typeof est.quota === 'number' ? est.quota : null,
          });
        })
        .catch(() => {});
    }

    return () => {
      unsubPkg();
      unsubAuth();
    };
  }, []);

  const permAdmin = localUpdatePackageService.verificarPermissaoExportacaoAdmin();
  const podeExportar = permAdmin.permitido && statusPacote.basesObrigatoriasOk && !emOperacao;

  const handleLoginGerencia = async () => {
    setFeedback(null);
    const res = await firebaseAuthService.loginComGoogle();
    if (!res.sucesso) {
      setFeedback({
        tipo: 'aviso',
        titulo: 'Login Google não concluído',
        mensagem: res.mensagem,
      });
    }
  };

  const handleBaixarAtualizacaoIsv = async () => {
    if (emOperacao) return;
    setFeedback(null);
    setEmOperacao(true);
    setProgressoPct(0);
    setProgressoTexto('Validando permissões e preparando pacote...');

    try {
      const res = await localUpdatePackageService.gerarPacoteAtualizacaoIsv((pct, msg) => {
        setProgressoPct(pct);
        setProgressoTexto(msg);
      });

      if (!res.sucesso || !res.blob || !res.fileName) {
        setFeedback({
          tipo: 'erro',
          titulo: 'Geração do Pacote Bloqueada',
          mensagem: res.mensagem,
        });
        return;
      }

      // Aciona o download apenas em resposta direta ao clique explícito do usuário
      localUpdatePackageService.dispararDownloadPacoteBrowser(res.blob, res.fileName);

      setFeedback({
        tipo: 'sucesso',
        titulo: `Pacote ${res.fileName} Gerado (${formatBytes(res.tamanhoBytes)})`,
        mensagem: `${res.mensagem} Versão: ${res.manifesto?.versaoId}. Integridade SHA-256 incluída (sem assinatura PKI).`,
      });
    } finally {
      setEmOperacao(false);
    }
  };

  const handleSelecionarArquivoZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFeedback(null);
    setResultadoInstalacao(null);
    setConfirmouDowngrade(false);
    setResolucaoConflito('SUBSTITUIR_PELO_PACOTE');
    setEmOperacao(true);
    setProgressoPct(0);
    setProgressoTexto(`Inspecionando arquivo ${file.name}...`);

    try {
      const insp = await localUpdatePackageService.inspecionarPacoteAtualizacaoIsv(
        file,
        (pct, msg) => {
          setProgressoPct(pct);
          setProgressoTexto(msg);
        }
      );

      setInspecaoAtual(insp);
      setModalImportOpen(true);
    } finally {
      setEmOperacao(false);
      if (fileInputZipRef.current) fileInputZipRef.current.value = '';
    }
  };

  const handleConfirmarInstalacao = async () => {
    if (!inspecaoAtual || !inspecaoAtual.validoParaInstalacao || emOperacao) return;

    const exigeDowngrade = Boolean(inspecaoAtual.resumoComparacao?.exigeConfirmacaoDowngrade);
    if (exigeDowngrade && !confirmouDowngrade) {
      return;
    }

    const temConflitos = (inspecaoAtual.resumoComparacao?.conflitosComerciais.length || 0) > 0;

    setEmOperacao(true);
    setProgressoPct(0);
    setProgressoTexto('Iniciando instalação segura com staging local...');

    try {
      const resInst = await localUpdatePackageService.instalarPacoteAtualizacaoIsv(
        inspecaoAtual,
        {
          confirmarSubstituicaoBases: true,
          confirmarDowngrade: exigeDowngrade ? confirmouDowngrade : true,
          resolucaoConflitoComercial: temConflitos ? resolucaoConflito : undefined,
        },
        (pct, msg) => {
          setProgressoPct(pct);
          setProgressoTexto(msg);
        }
      );

      setResultadoInstalacao(resInst);
      if (resInst.sucesso) {
        if (onPackageInstalled) onPackageInstalled();
      }
    } finally {
      setEmOperacao(false);
    }
  };

  const fecharModalImportacao = () => {
    if (emOperacao) return;
    setModalImportOpen(false);
    setInspecaoAtual(null);
    setResultadoInstalacao(null);
    setProgressoTexto(null);
  };

  const { contagensAtuais, detalhesBasesObrigatorias } = statusPacote;

  return (
    <section
      id="secao-atualizacao-bases-filial-172"
      className="bg-white rounded-xl border-2 border-slate-900 shadow-sm overflow-hidden"
    >
      {/* Cabeçalho Institucional Escuro + Faixa Laranja */}
      <div className="bg-slate-900 text-white px-5 py-4 border-b-4 border-orange-600 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-600 flex items-center justify-center shrink-0">
            <Archive className="w-5 h-5 text-white stroke-[2.5]" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-300 block">
              DISTRIBUIÇÃO POR ARQUIVO ÚNICO (.ZIP) • SEM COTA DE LEITURA/ESCRITA EM MASSA
            </span>
            <h2 className="text-base sm:text-lg font-black tracking-tight uppercase text-white">
              ATUALIZAÇÃO DAS BASES — FILIAL 172
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Compartilhe BASE RUB, SPCOI007, SAEOU060, Promotores, Agências e Vínculos via WhatsApp, Drive ou pendrive. Vencimentos e EANs continuam no Firebase Spark gratuito.
            </p>
          </div>
        </div>

        <div className="text-left sm:text-right font-mono text-xs shrink-0 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2">
          <div className="text-[10px] text-slate-400 uppercase">Versão Instalada</div>
          <div className="font-bold text-amber-300">
            {statusPacote.versaoInstaladaId || 'NENHUM PACOTE INSTALADO'}
          </div>
          <div className="text-[10px] text-slate-300 mt-0.5">
            {statusPacote.ultimaAtualizacaoIso
              ? `Atualizado em ${new Date(statusPacote.ultimaAtualizacaoIso).toLocaleString('pt-BR')}`
              : 'Aguardando geração ou importação'}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Aviso de Atualização Pronta (Candidata) após alterações locais */}
        {statusPacote.atualizacaoDisponivel && (
          <div
            id="banner-pacote-desatualizado"
            className="bg-orange-50 border border-orange-300 rounded-lg p-3.5 text-xs text-orange-950 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-black uppercase text-orange-900">
                Alterações locais detectadas — gere um novo pacote quando desejar distribuir
              </div>
              <p className="text-[11px] text-orange-900">
                O sistema consolidou localmente as alterações abaixo e aguarda ação manual em <strong>BAIXAR ATUALIZAÇÃO ISV</strong> (nenhum download é iniciado automaticamente):
              </p>
              <ul className="list-disc list-inside text-[11px] font-medium text-orange-950">
                {statusPacote.motivosDesatualizacao.slice(0, 4).map((m, idx) => (
                  <li key={idx}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Verificação das 3 Bases Obrigatórias */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div
            className={`rounded-lg p-3 border ${
              detalhesBasesObrigatorias.baseRubOk
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-amber-50 border-amber-300 text-amber-950'
            }`}
          >
            <div className="flex items-center justify-between font-black uppercase">
              <span>1. BASE RUB (36 Col.)</span>
              {detalhesBasesObrigatorias.baseRubOk ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
            </div>
            <div className="mt-1 font-mono text-[11px] font-bold">
              {contagensAtuais.produtos.toLocaleString('pt-BR')} produtos /{' '}
              {contagensAtuais.registrosOperacionais.toLocaleString('pt-BR')} op.
            </div>
            {detalhesBasesObrigatorias.baseRubMotivo && (
              <p className="text-[11px] mt-1">{detalhesBasesObrigatorias.baseRubMotivo}</p>
            )}
          </div>

          <div
            className={`rounded-lg p-3 border ${
              detalhesBasesObrigatorias.spcoi007Ok
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-amber-50 border-amber-300 text-amber-950'
            }`}
          >
            <div className="flex items-center justify-between font-black uppercase">
              <span>2. SPCOI007 (Fornec.)</span>
              {detalhesBasesObrigatorias.spcoi007Ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
            </div>
            <div className="mt-1 font-mono text-[11px] font-bold">
              {contagensAtuais.fornecedores.toLocaleString('pt-BR')} forn. /{' '}
              {contagensAtuais.industrias.toLocaleString('pt-BR')} indústrias
            </div>
            {detalhesBasesObrigatorias.spcoi007Motivo && (
              <p className="text-[11px] mt-1">{detalhesBasesObrigatorias.spcoi007Motivo}</p>
            )}
          </div>

          <div
            className={`rounded-lg p-3 border ${
              detalhesBasesObrigatorias.saeou060Ok
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-amber-50 border-amber-300 text-amber-950'
            }`}
          >
            <div className="flex items-center justify-between font-black uppercase">
              <span>3. SAEOU060</span>
              {detalhesBasesObrigatorias.saeou060Ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
            </div>
            <div className="mt-1 font-mono text-[11px] font-bold">
              {contagensAtuais.saeou060.toLocaleString('pt-BR')} registros
            </div>
            {detalhesBasesObrigatorias.saeou060Motivo && (
              <p className="text-[11px] mt-1">{detalhesBasesObrigatorias.saeou060Motivo}</p>
            )}
          </div>
        </div>

        {/* Grid de Quantidades Consolidadas */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center">
          {[
            { label: 'Produtos', valor: contagensAtuais.produtos },
            { label: 'Fornecedores', valor: contagensAtuais.fornecedores },
            { label: 'Indústrias', valor: contagensAtuais.industrias },
            { label: 'Promotores', valor: contagensAtuais.promotores },
            { label: 'Agências', valor: contagensAtuais.agencias },
            { label: 'Vínculos Comerc.', valor: contagensAtuais.vinculos },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2"
            >
              <span className="text-[10px] font-bold uppercase text-slate-500 block">
                {stat.label}
              </span>
              <span className="text-base font-black font-mono tabular-nums text-slate-900">
                {stat.valor.toLocaleString('pt-BR')}
              </span>
            </div>
          ))}
        </div>

        {/* Painel de Autorização Administrativa & Transparência */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div
            className={`rounded-lg p-3 border flex flex-col justify-between gap-2 ${
              permAdmin.permitido
                ? 'bg-blue-50 border-blue-200 text-blue-950'
                : 'bg-slate-50 border-slate-300 text-slate-800'
            }`}
          >
            <div className="flex items-start gap-2">
              {permAdmin.permitido ? (
                <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
              ) : (
                <Lock className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <div className="font-black uppercase text-[11px]">
                  {permAdmin.permitido
                    ? `GERÊNCIA VERIFICADA (${authEstado.email || authEstado.perfil?.nome})`
                    : 'Geração Restrita à Gerência (GERENCIA_ADMIN)'}
                </div>
                <p className="text-[11px] leading-snug">
                  {permAdmin.permitido
                    ? 'Sessão autenticada e verificada no servidor para gerar o arquivo único da Filial 172.'
                    : 'Para baixar/exportar o pacote oficial, autentique-se com conta Google autorizada como GERENCIA_ADMIN. A troca visual local de perfil não concede permissão administrativa. Já a importação funciona em qualquer dispositivo sem login.'}
                </p>
              </div>
            </div>
            {!permAdmin.permitido && (
              <button
                type="button"
                id="btn-login-google-gerencia-pacote"
                onClick={handleLoginGerencia}
                className="self-start px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-black uppercase text-[11px] tracking-wide transition-colors cursor-pointer"
              >
                Entrar com Google (Gerência)
              </button>
            )}
          </div>

          <div className="rounded-lg p-3 border border-slate-200 bg-slate-50 text-slate-700 space-y-1.5">
            <div className="flex items-center gap-1.5 font-black uppercase text-[11px] text-slate-900">
              <HardDrive className="w-4 h-4 text-slate-700 shrink-0" />
              <span>Armazenamento Local & Segurança do Pacote</span>
            </div>
            <p className="text-[11px] leading-snug">
              <strong>Uso estimado IndexedDB:</strong>{' '}
              <span className="font-mono">{formatBytes(storageInfo.usage)}</span>
              {storageInfo.quota ? ` de ${formatBytes(storageInfo.quota)}` : ''}. Os dados locais pertencem à origem do navegador e podem sofrer políticas de limpeza do sistema em falta extrema de espaço.
            </p>
            <p className="text-[11px] leading-snug text-slate-600">
              <strong>Integridade:</strong> Verificação SHA-256 por arquivo (sem assinatura criptográfica PKI de servidor; nenhuma chave privada é embutida no aplicativo).
            </p>
          </div>
        </div>

        {/* Botões Principais */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
          <button
            type="button"
            id="btn-baixar-atualizacao-isv"
            onClick={handleBaixarAtualizacaoIsv}
            disabled={!podeExportar}
            title={
              !permAdmin.permitido
                ? permAdmin.motivo
                : !statusPacote.basesObrigatoriasOk
                ? 'Importe primeiro as 3 bases obrigatórias (BASE RUB, SPCOI007 e SAEOU060).'
                : 'Gerar e baixar o arquivo único ISV_FILIAL_172_ATUALIZACAO_YYYY-MM-DD.zip'
            }
            className="flex-1 py-3 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:bg-slate-200 disabled:text-slate-500 text-white font-black uppercase tracking-wider text-xs shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            {emOperacao && progressoTexto?.toLowerCase().includes('empacotando') ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4 stroke-[2.5]" />
            )}
            <span>BAIXAR ATUALIZAÇÃO ISV (.ZIP)</span>
          </button>

          <input
            ref={fileInputZipRef}
            id="input-importar-atualizacao-isv"
            type="file"
            accept=".zip,application/zip"
            onChange={handleSelecionarArquivoZip}
            disabled={emOperacao}
            className="hidden"
          />

          <button
            type="button"
            id="btn-importar-atualizacao-isv"
            onClick={() => fileInputZipRef.current?.click()}
            disabled={emOperacao}
            className="flex-1 py-3 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-black uppercase tracking-wider text-xs shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Upload className="w-4 h-4 stroke-[2.5]" />
            <span>IMPORTAR ATUALIZAÇÃO ISV (.ZIP)</span>
          </button>
        </div>

        {/* Barra de Progresso de Operação do Pacote */}
        {emOperacao && (
          <div className="bg-slate-900 text-white rounded-lg p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                <span>{progressoTexto || 'Processando pacote...'}</span>
              </span>
              <span className="font-mono text-orange-300">{progressoPct}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 transition-all duration-200"
                style={{ width: `${progressoPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Banner de Feedback */}
        {feedback && !emOperacao && (
          <div
            className={`rounded-lg p-3.5 border text-xs flex items-start justify-between gap-2 ${
              feedback.tipo === 'sucesso'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : feedback.tipo === 'erro'
                ? 'bg-rose-50 border-rose-300 text-rose-950'
                : 'bg-amber-50 border-amber-300 text-amber-950'
            }`}
          >
            <div className="flex items-start gap-2">
              {feedback.tipo === 'sucesso' ? (
                <PackageCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : feedback.tipo === 'erro' ? (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-black uppercase">{feedback.titulo}</div>
                <p className="mt-0.5">{feedback.mensagem}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="p-1 hover:bg-black/5 rounded cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Modal de Inspeção, Comparação e Confirmação Explícita de Instalação */}
      {modalImportOpen && inspecaoAtual && (
        <div
          id="modal-confirmacao-pacote-isv"
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
            <div className="bg-slate-900 text-white px-5 py-4 border-b-4 border-blue-700 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-blue-300 block">
                  INSTALAÇÃO SEGURA EM STAGING • FILIAL 172
                </span>
                <h3 className="text-base font-black uppercase">
                  Conferência do Pacote de Atualização ISV
                </h3>
              </div>
              {!emOperacao && (
                <button
                  type="button"
                  onClick={fecharModalImportacao}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Resultado Final Pós-Instalação */}
              {resultadoInstalacao && (
                <div
                  className={`rounded-xl p-4 border space-y-2 ${
                    resultadoInstalacao.sucesso
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                      : 'bg-rose-50 border-rose-300 text-rose-950'
                  }`}
                >
                  <div className="flex items-center gap-2 font-black uppercase text-sm">
                    {resultadoInstalacao.sucesso ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-rose-600" />
                    )}
                    <span>
                      {resultadoInstalacao.sucesso
                        ? 'Atualização Instalada com Sucesso!'
                        : 'Falha na Instalação (Rollback Aplicado)'}
                    </span>
                  </div>
                  <p className="font-medium">{resultadoInstalacao.mensagem}</p>
                  {resultadoInstalacao.preservacaoGarantida && (
                    <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                      <div className="bg-white border border-emerald-200 rounded p-2">
                        <span className="block text-[10px] text-emerald-700 font-sans font-bold uppercase">
                          Vencimentos Preservados
                        </span>
                        <strong>
                          {resultadoInstalacao.preservacaoGarantida.vencimentosPreservados}
                        </strong>
                      </div>
                      <div className="bg-white border border-emerald-200 rounded p-2">
                        <span className="block text-[10px] text-emerald-700 font-sans font-bold uppercase">
                          Vínculos EAN
                        </span>
                        <strong>
                          {resultadoInstalacao.preservacaoGarantida.vinculosEanPreservados}
                        </strong>
                      </div>
                      <div className="bg-white border border-emerald-200 rounded p-2">
                        <span className="block text-[10px] text-emerald-700 font-sans font-bold uppercase">
                          Filas Sync Spark
                        </span>
                        <strong>100% INTACTAS</strong>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Estado de Integridade & Autenticidade */}
              {!resultadoInstalacao && (
                <>
                  <div
                    className={`rounded-xl p-3.5 border flex items-start gap-2.5 ${
                      inspecaoAtual.validoParaInstalacao
                        ? 'bg-blue-50 border-blue-300 text-blue-950'
                        : 'bg-rose-50 border-rose-300 text-rose-950'
                    }`}
                  >
                    {inspecaoAtual.validoParaInstalacao ? (
                      <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldAlert className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1">
                      <div className="font-black uppercase">
                        Status de Integridade: {inspecaoAtual.autenticidadeStatus}
                      </div>
                      <p>{inspecaoAtual.autenticidadeMensagem}</p>
                      {inspecaoAtual.manifesto && (
                        <div className="font-mono text-[11px] text-slate-700 pt-1">
                          Versão: <strong>{inspecaoAtual.manifesto.versaoId}</strong> • Gerado em:{' '}
                          {new Date(inspecaoAtual.manifesto.geradoEmIso).toLocaleString('pt-BR')} •
                          Arquivos conferidos: {inspecaoAtual.arquivosVerificados}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Erros Bloqueantes */}
                  {inspecaoAtual.errosBloqueantes.length > 0 && (
                    <div className="bg-rose-50 border border-rose-300 rounded-xl p-3.5 text-rose-950 space-y-1">
                      <div className="font-black uppercase text-rose-900">
                        Instalação Bloqueada pelos Motivos Abaixo:
                      </div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {inspecaoAtual.errosBloqueantes.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Resumo Comparativo (Atual vs Pacote) */}
                  {inspecaoAtual.resumoComparacao && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between bg-slate-100 rounded-lg px-3 py-2 font-bold">
                        <span>Comparação de Versão:</span>
                        <span className="font-mono uppercase text-blue-800">
                          {inspecaoAtual.resumoComparacao.comparacaoVersao}
                        </span>
                      </div>

                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full text-left font-mono text-[11px]">
                          <thead className="bg-slate-900 text-white uppercase">
                            <tr>
                              <th className="px-3 py-2">Entidade</th>
                              <th className="px-3 py-2 text-right">Dispositivo Atual</th>
                              <th className="px-3 py-2 text-right">Novo Pacote</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {[
                              [
                                'Produtos BASE RUB',
                                inspecaoAtual.resumoComparacao.contagensAtuais.produtos,
                                inspecaoAtual.resumoComparacao.contagensPacote.produtos,
                              ],
                              [
                                'Registros Op. 36 Cols',
                                inspecaoAtual.resumoComparacao.contagensAtuais
                                  .registrosOperacionais,
                                inspecaoAtual.resumoComparacao.contagensPacote
                                  .registrosOperacionais,
                              ],
                              [
                                'Fornecedores SPCOI007',
                                inspecaoAtual.resumoComparacao.contagensAtuais.fornecedores,
                                inspecaoAtual.resumoComparacao.contagensPacote.fornecedores,
                              ],
                              [
                                'Indústrias',
                                inspecaoAtual.resumoComparacao.contagensAtuais.industrias,
                                inspecaoAtual.resumoComparacao.contagensPacote.industrias,
                              ],
                              [
                                'SAEOU060',
                                inspecaoAtual.resumoComparacao.contagensAtuais.saeou060,
                                inspecaoAtual.resumoComparacao.contagensPacote.saeou060,
                              ],
                              [
                                'Promotores',
                                inspecaoAtual.resumoComparacao.contagensAtuais.promotores,
                                inspecaoAtual.resumoComparacao.contagensPacote.promotores,
                              ],
                              [
                                'Agências',
                                inspecaoAtual.resumoComparacao.contagensAtuais.agencias,
                                inspecaoAtual.resumoComparacao.contagensPacote.agencias,
                              ],
                              [
                                'Vínculos Comerciais',
                                inspecaoAtual.resumoComparacao.contagensAtuais.vinculos,
                                inspecaoAtual.resumoComparacao.contagensPacote.vinculos,
                              ],
                            ].map(([nome, atual, novo]) => (
                              <tr key={String(nome)}>
                                <td className="px-3 py-1.5 font-sans font-semibold text-slate-800">
                                  {nome}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                                  {Number(atual).toLocaleString('pt-BR')}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums font-bold text-slate-900">
                                  {Number(novo).toLocaleString('pt-BR')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Confirmação Dupla de Downgrade */}
                      {inspecaoAtual.resumoComparacao.exigeConfirmacaoDowngrade && (
                        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-3.5 space-y-2 text-amber-950">
                          <div className="font-black uppercase flex items-center gap-1.5 text-amber-900">
                            <AlertTriangle className="w-4 h-4 text-amber-700" />
                            <span>Atenção: Pacote Anterior à Versão Atual (Downgrade)</span>
                          </div>
                          <label className="flex items-start gap-2 cursor-pointer font-semibold">
                            <input
                              type="checkbox"
                              checked={confirmouDowngrade}
                              onChange={(e) => setConfirmouDowngrade(e.target.checked)}
                              className="mt-0.5"
                            />
                            <span>
                              Confirmo explicitamente que desejo substituir a versão atual por uma
                              versão mais antiga.
                            </span>
                          </label>
                        </div>
                      )}

                      {/* Resolução de Conflitos Comerciais Locais */}
                      {inspecaoAtual.resumoComparacao.conflitosComerciais.length > 0 && (
                        <div className="bg-orange-50 border border-orange-300 rounded-xl p-3.5 space-y-2 text-orange-950">
                          <div className="font-black uppercase">
                            Alterações Comerciais Locais Detectadas
                          </div>
                          <ul className="list-disc list-inside text-[11px]">
                            {inspecaoAtual.resumoComparacao.conflitosComerciais.map((c, idx) => (
                              <li key={idx}>{c.descricao}</li>
                            ))}
                          </ul>
                          <div className="space-y-1.5 pt-1 font-semibold">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="resolucaoConflitoPacote"
                                checked={resolucaoConflito === 'SUBSTITUIR_PELO_PACOTE'}
                                onChange={() => setResolucaoConflito('SUBSTITUIR_PELO_PACOTE')}
                              />
                              <span>Substituir promotores/agências/vínculos pelos do pacote</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="resolucaoConflitoPacote"
                                checked={resolucaoConflito === 'MANTER_ALTERACOES_LOCAIS'}
                                onChange={() => setResolucaoConflito('MANTER_ALTERACOES_LOCAIS')}
                              />
                              <span>Manter alterações comerciais locais e atualizar apenas as 3 bases</span>
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Garantia de Preservação */}
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2 text-emerald-950">
                        <Database className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                        <span>
                          <strong>Preservação Garantida:</strong> Vencimentos cadastrados, vínculos
                          EAN, solicitações de ajuste, divergências, histórico e fila de
                          sincronização offline com o Firebase Spark{' '}
                          <strong>NÃO serão apagados nem sobrescritos</strong>.
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {emOperacao && (
                <div className="bg-slate-900 text-white rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between font-bold">
                    <span>{progressoTexto}</span>
                    <span className="font-mono text-orange-300">{progressoPct}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${progressoPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex items-center justify-end gap-2.5">
              {resultadoInstalacao ? (
                <button
                  type="button"
                  onClick={fecharModalImportacao}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-xs cursor-pointer"
                >
                  Concluir e Fechar
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={emOperacao}
                    onClick={fecharModalImportacao}
                    className="px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold uppercase text-xs cursor-pointer disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  {inspecaoAtual.validoParaInstalacao && (
                    <button
                      type="button"
                      id="btn-confirmar-instalacao-pacote-isv"
                      disabled={
                        emOperacao ||
                        (Boolean(inspecaoAtual.resumoComparacao?.exigeConfirmacaoDowngrade) &&
                          !confirmouDowngrade)
                      }
                      onClick={handleConfirmarInstalacao}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black uppercase text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      {emOperacao ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      <span>Confirmar e Instalar Pacote</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
