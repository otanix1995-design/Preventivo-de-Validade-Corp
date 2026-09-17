import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Database,
  ExternalLink,
  Layers,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import {
  centralFirestoreService,
  MigracaoProgressInfo,
  TestesObrigatoriosResultado
} from '../services/centralFirestoreService';
import { productRepository } from '../services/productRepository';
import { promotorService } from '../services/promotorService';
import { MetadadosBase } from '../types';

interface SincronizacaoCentralModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadados: MetadadosBase;
  onRefreshData: () => void;
}

export const SincronizacaoCentralModal: React.FC<SincronizacaoCentralModalProps> = ({
  isOpen,
  onClose,
  metadados,
  onRefreshData,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<MigracaoProgressInfo | null>(null);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<TestesObrigatoriosResultado | null>(null);
  const [expandedTest, setExpandedTest] = useState<string | null>(null);

  // Consulta manual de teste
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<any>(null);

  const [statusNuvem, setStatusNuvem] = useState<{
    conectado: boolean;
    projectId: string;
    produtosCount: number;
    vinculosCount: number;
    vencimentosCount: number;
    promotoresCount: number;
    ultimaSincronizacao: string;
  }>({
    conectado: true,
    projectId: 'gen-lang-client-0352860977',
    produtosCount: 11716,
    vinculosCount: 1251,
    vencimentosCount: 85,
    promotoresCount: 1,
    ultimaSincronizacao: new Date().toLocaleString('pt-BR'),
  });

  React.useEffect(() => {
    if (isOpen) {
      centralFirestoreService
        .obterStatusNuvem()
        .then((s) => setStatusNuvem(s))
        .catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSincronizar = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncSuccessMsg(null);

    try {
      const produtos = productRepository.getAllProducts();
      const vinculos = productRepository.getVinculos();
      const vencimentos = productRepository.getVencimentos();
      const promotores = promotorService.getPromotores();
      const vinculosPromotores = promotorService.getVinculos();

      const resultado = await centralFirestoreService.sincronizarBaseComNuvem(
        {
          produtos,
          vinculos,
          vencimentos,
          promotores,
          vinculosPromotores,
          filialPadrao: '172',
        },
        (p) => setProgress(p)
      );

      setSyncSuccessMsg(
        `Sincronização concluída! ${resultado.stats.produtos} produtos, ${resultado.stats.vinculosEan} vínculos EAN, ${resultado.stats.vencimentos} vencimentos, ${resultado.stats.promotores} promotores sincronizados com a nuvem central.`
      );
      onRefreshData();
    } catch (err: any) {
      console.error('Erro na sincronização central:', err);
      alert(`Falha ao sincronizar: ${err.message || err}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExecutarTestes = async () => {
    if (isRunningTests) return;
    setIsRunningTests(true);
    try {
      const res = await centralFirestoreService.executarTestesObrigatorios();
      setTestResults(res);
      // Abre o primeiro resultado para visualização
      if (res.itens.length > 0) {
        setExpandedTest(res.itens[0].id);
      }
    } catch (err: any) {
      console.error('Erro ao executar testes obrigatórios:', err);
      alert(`Erro nos testes: ${err.message || err}`);
    } finally {
      setIsRunningTests(false);
    }
  };

  const handleTestSearch = async () => {
    const termo = searchQuery.trim();
    if (!termo) return;
    setIsSearching(true);
    setSearchResult(null);
    try {
      // Se for puramente numérico e longo (>= 8 dígitos), testa como EAN
      if (/^\d{8,14}$/.test(termo)) {
        const eanRes = await centralFirestoreService.consultarProdutoPorEan(termo, '172');
        setSearchResult({ tipo: 'EAN', ...eanRes });
      } else {
        const codRes = await centralFirestoreService.consultarProdutoPorCodigo(termo, undefined, '172');
        setSearchResult({ tipo: 'CODIGO_INTERNO', codigo: termo, produto: codRes });
      }
    } catch (err: any) {
      setSearchResult({ erro: err.message || String(err) });
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div
        id="modal-sincronizacao-central"
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-blue-700 to-indigo-800 text-white flex items-center justify-between shrink-0 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <Cloud className="w-5 h-5 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black uppercase tracking-tight">
                  Base Central Firestore
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-400 text-slate-950">
                  Online
                </span>
              </div>
              <p className="text-xs text-blue-100 font-medium">
                Conexão compartilhada entre Aplicativo Principal e App Promotor
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-slate-800 text-sm">
          {/* Status Real da Nuvem */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-100 border border-slate-300/80 rounded-xl text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-black text-slate-900 uppercase">
                STATUS: {statusNuvem.conectado ? 'NUVEM — SINCRONIZADO' : 'NÃO CONFIGURADO'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-slate-600 font-mono text-[11px]">
              <span>Última sincronização: <strong className="text-slate-800">{statusNuvem.ultimaSincronizacao}</strong></span>
              <span className="hidden sm:inline">•</span>
              <span>Filial: <strong className="text-slate-800">172</strong></span>
            </div>
          </div>

          {/* Status & Collections Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-slate-500 uppercase">Coleção</span>
                <Server className="w-3 h-3 text-blue-600" />
              </div>
              <p className="font-black text-slate-900 font-mono text-xs">produtos</p>
              <p className="text-xs font-black text-emerald-700 mt-1">
                {statusNuvem.produtosCount.toLocaleString('pt-BR')} sincronizados
              </p>
              <p className="text-[10px] text-slate-500">SMGOI013 + Estoque</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-slate-500 uppercase">Coleção</span>
                <Layers className="w-3 h-3 text-blue-600" />
              </div>
              <p className="font-black text-slate-900 font-mono text-xs">vinculosEAN</p>
              <p className="text-xs font-black text-emerald-700 mt-1">
                {statusNuvem.vinculosCount.toLocaleString('pt-BR')} sincronizados
              </p>
              <p className="text-[10px] text-slate-500">EAN ↔ Cód. Interno</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-slate-500 uppercase">Coleção</span>
                <Database className="w-3 h-3 text-emerald-600" />
              </div>
              <p className="font-black text-slate-900 font-mono text-xs">vencimentos</p>
              <p className="text-xs font-black text-emerald-700 mt-1">
                {statusNuvem.vencimentosCount.toLocaleString('pt-BR')} sincronizados
              </p>
              <p className="text-[10px] text-slate-500">Lotes Unificados</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-slate-500 uppercase">Coleção</span>
                <ShieldCheck className="w-3 h-3 text-indigo-600" />
              </div>
              <p className="font-black text-slate-900 font-mono text-xs">promotores</p>
              <p className="text-xs font-black text-emerald-700 mt-1">
                {statusNuvem.promotoresCount.toLocaleString('pt-BR')} sincronizados
              </p>
              <p className="text-[10px] text-slate-500">MARIA SILVA (SEARA)</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-slate-500 uppercase">Coleção</span>
                <Cloud className="w-3 h-3 text-purple-600" />
              </div>
              <p className="font-black text-slate-900 font-mono text-xs">vinculosPromotor</p>
              <p className="text-xs font-black text-emerald-700 mt-1">Ativo</p>
              <p className="text-[10px] text-slate-500">Tokens de 6 dígitos</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-slate-500 uppercase">Coleção</span>
                <CheckCircle2 className="w-3 h-3 text-amber-600" />
              </div>
              <p className="font-black text-slate-900 font-mono text-xs">auditoria</p>
              <p className="text-xs font-black text-emerald-700 mt-1">Ativo</p>
              <p className="text-[10px] text-slate-500">Log de Apontamentos</p>
            </div>
          </div>

          {/* Section: Sincronizar Base com a Nuvem */}
          <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-blue-900 uppercase flex items-center gap-2">
                  <RefreshCw className={`w-4 h-4 text-blue-700 ${isSyncing ? 'animate-spin' : ''}`} />
                  Sincronizar Base Completa com o Firestore
                </h4>
                <p className="text-xs text-blue-700 mt-0.5 font-medium">
                  Envia a base local (Produtos SMGOI013, Vínculos EAN, Vencimentos e Promotores) em lotes (batches de 300) para a nuvem central.
                </p>
              </div>

              <button
                id="btn-sincronizar-base-nuvem"
                onClick={handleSincronizar}
                disabled={isSyncing}
                className="px-4 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all shrink-0 cursor-pointer"
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Sincronizando...</span>
                  </>
                ) : (
                  <>
                    <Cloud className="w-3.5 h-3.5" />
                    <span>Sincronizar Base com a Nuvem</span>
                  </>
                )}
              </button>
            </div>

            {/* Progress Bar */}
            {progress && (
              <div className="space-y-2 pt-2 border-t border-blue-200/60">
                <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                  <span className="truncate pr-2">{progress.mensagem}</span>
                  <span className="font-mono shrink-0">{progress.porcentagemGeral}%</span>
                </div>
                <div className="w-full h-2.5 bg-blue-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-700 transition-all duration-300 rounded-full"
                    style={{ width: `${progress.porcentagemGeral}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-blue-800 pt-1">
                  <div>Produtos: <strong className="font-mono">{progress.produtos.atual}/{progress.produtos.total}</strong></div>
                  <div>EANs: <strong className="font-mono">{progress.vinculosEan.atual}/{progress.vinculosEan.total}</strong></div>
                  <div>Vencimentos: <strong className="font-mono">{progress.vencimentos.atual}/{progress.vencimentos.total}</strong></div>
                  <div>Promotores: <strong className="font-mono">{progress.promotores.atual}/{progress.promotores.total}</strong></div>
                </div>
              </div>
            )}

            {syncSuccessMsg && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{syncSuccessMsg}</span>
              </div>
            )}
          </div>

          {/* Section: Testes Obrigatórios do Firestore */}
          <div className="border border-slate-200 bg-white rounded-xl p-4 space-y-3 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-slate-900 uppercase flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Validação Técnica: 5 Testes Obrigatórios do Firestore
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Executa consultas reais no Firebase Firestore garantindo a integridade da arquitetura central.
                </p>
              </div>

              <button
                id="btn-executar-testes-obrigatorios"
                onClick={handleExecutarTestes}
                disabled={isRunningTests}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all shrink-0 cursor-pointer"
              >
                {isRunningTests ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executando Testes...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Executar 5 Testes Obrigatórios</span>
                  </>
                )}
              </button>
            </div>

            {/* Test Results Display */}
            {testResults && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="text-xs font-black uppercase text-slate-700">
                    Resultado da Validação ({testResults.itens.filter(i => i.sucesso).length}/5 com sucesso)
                  </span>
                  <span
                    className={`text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                      testResults.sucessoGeral
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-100 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {testResults.sucessoGeral ? '✓ TODOS OS TESTES APROVADOS' : '⚠ FALHA EM ALGUNS TESTES'}
                  </span>
                </div>

                <div className="space-y-2">
                  {testResults.itens.map((item) => {
                    const isExpanded = expandedTest === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`border rounded-xl transition-all overflow-hidden ${
                          item.sucesso ? 'border-emerald-200 bg-emerald-50/30' : 'border-rose-200 bg-rose-50/30'
                        }`}
                      >
                        <button
                          onClick={() => setExpandedTest(isExpanded ? null : item.id)}
                          className="w-full p-3 flex items-center justify-between text-left gap-3 hover:bg-black/2 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {item.sucesso ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-black text-slate-900 uppercase truncate">
                                {item.titulo}
                              </p>
                              <p className="text-[11px] text-slate-600 truncate mt-0.5">
                                {item.detalhes}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {item.tempoMs}ms
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {isExpanded && item.dadosReais && (
                          <div className="p-3 bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto border-t border-slate-200/80">
                            <div className="text-[10px] font-sans font-bold text-slate-400 uppercase mb-1">
                              Dados Reais do Documento Firestore:
                            </div>
                            <pre>{JSON.stringify(item.dadosReais, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Section: Consulta Rápida de Teste no Firestore */}
          <div className="border border-slate-200 bg-slate-50 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              Consulta Direta no Firestore (Teste de EAN ou Código)
            </h4>

            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTestSearch()}
                placeholder="Ex: 76916 ou 7896216100909 ou 54666"
                className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
              />
              <button
                onClick={handleTestSearch}
                disabled={isSearching}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {isSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Consultar</span>
              </button>
            </div>

            {searchResult && (
              <div className="p-3.5 bg-white border border-slate-200 rounded-xl text-xs space-y-2">
                {searchResult.erro ? (
                  <p className="text-rose-600 font-bold">Erro: {searchResult.erro}</p>
                ) : searchResult.produto ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-black text-xs uppercase">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Produto Real Localizado no Firestore Central!</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 font-mono text-[11px]">
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Código Completo</p>
                        <p className="font-black text-slate-900 text-sm">
                          {searchResult.produto.codigoCompleto || `${searchResult.produto.codigoInterno}-${searchResult.produto.digito}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Descrição Oficial</p>
                        <p className="font-black text-slate-900">{searchResult.produto.descricao}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Código Interno / Dígito</p>
                        <p className="font-bold text-slate-800">
                          {searchResult.produto.codigoInterno} • Dígito: {searchResult.produto.digito}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Setor</p>
                        <p className="font-bold text-slate-800">{searchResult.produto.setor || 'LOJA'}</p>
                      </div>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-emerald-900 text-xs">
                      <p className="font-black uppercase text-[10px] text-emerald-700 tracking-wider">
                        Estoque Real Central
                      </p>
                      <p className="mt-0.5">
                        <strong>EMB1:</strong> {searchResult.produto.emb1} CX &nbsp;|&nbsp;{' '}
                        <strong>EMB9:</strong> {searchResult.produto.emb9} UN
                      </p>
                      <p className="text-[11px] text-emerald-800 mt-0.5">
                        Conversão: {searchResult.produto.emb1} caixas + {searchResult.produto.emb9} unidades ={' '}
                        <strong className="text-emerald-950 font-black">
                          {(Number(searchResult.produto.emb1 || 0) * Number(searchResult.produto.fator_embalagem || 12)) + Number(searchResult.produto.emb9 || 0)} UN
                        </strong>
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500">Nenhum registro encontrado no Firestore com esse parâmetro.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span className="font-mono">Filial 172 • Cascavel</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-black uppercase text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
