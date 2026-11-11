import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  Info,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  DiagnosticoDadosLocaisRelatorio,
  executarDiagnosticoSomenteLeitura,
} from '../services/localDataDiagnosticService';

export const DiagnosticoDadosLocaisCard: React.FC = () => {
  const [relatorio, setRelatorio] = useState<DiagnosticoDadosLocaisRelatorio | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const rodarDiagnostico = async () => {
    if (carregando) return;
    setCarregando(true);
    try {
      const res = await executarDiagnosticoSomenteLeitura();
      setRelatorio(res);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    rodarDiagnostico();
  }, []);

  const handleCopiarRelatorio = async () => {
    if (!relatorio || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(relatorio, null, 2));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // ignore clipboard permissions error
    }
  };

  return (
    <section
      id="card-diagnostico-somente-leitura-idb"
      className="bg-white rounded-xl border-2 border-blue-900/30 shadow-sm overflow-hidden"
    >
      <div className="bg-slate-800 text-white px-5 py-3.5 border-b-2 border-blue-500 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-600/30 border border-blue-400/40 flex items-center justify-center shrink-0">
            <Eye className="w-5 h-5 text-blue-300" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300 block">
              MODO ESTRITAMENTE SOMENTE LEITURA • NENHUM DADO É ALTERADO OU MIGRADO
            </span>
            <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-white">
              Diagnóstico Real do IndexedDB Local e Memória
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {relatorio && (
            <button
              type="button"
              onClick={handleCopiarRelatorio}
              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-bold text-slate-100 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiado ? 'Copiado!' : 'Copiar JSON'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={rodarDiagnostico}
            disabled={carregando}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-black uppercase tracking-wide text-white flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin' : ''}`} />
            <span>{carregando ? 'Lendo...' : 'Reexecutar Leitura'}</span>
          </button>
        </div>
      </div>

      {!relatorio ? (
        <div className="p-5 text-xs text-slate-600 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
          <span>Executando inspeção somente de leitura no IndexedDB...</span>
        </div>
      ) : (
        <div className="p-5 space-y-4 text-xs">
          {/* Origem e Metadados do Banco */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase text-slate-500">Origem Atual</div>
              <div className="font-mono text-[11px] font-bold text-slate-900 break-all mt-0.5">
                {relatorio.originAtual}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase text-slate-500">
                Banco IndexedDB Ativo
              </div>
              <div className="font-mono text-[11px] font-bold text-slate-900 mt-0.5">
                {relatorio.dbAtual
                  ? `${relatorio.dbAtual.nome} (v${relatorio.dbAtual.versao}) • ${relatorio.dbAtual.objectStoresPresentes.length} stores`
                  : 'Indisponível'}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase text-slate-500">
                Bancos Listados na Origem
              </div>
              <div className="font-mono text-[11px] font-bold text-slate-900 mt-0.5">
                {relatorio.bancosNavegador.length > 0
                  ? relatorio.bancosNavegador.map((b) => `${b.name} (v${b.version ?? '?'})`).join(', ')
                  : 'API databases() não exposta'}
              </div>
            </div>
          </div>

          {/* Causas Identificadas */}
          <div className="space-y-2">
            <div className="font-black uppercase text-[11px] text-slate-700 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-blue-700" />
              <span>Achados Automáticos (IndexedDB vs Memória)</span>
            </div>
            {relatorio.causasIdentificadas.map((c) => (
              <div
                key={c.codigo}
                className={`rounded-lg p-3 border flex items-start gap-2.5 ${
                  c.severidade === 'CRITICA'
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : c.severidade === 'ATENCAO'
                    ? 'bg-orange-50 border-orange-300 text-orange-950'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-950'
                }`}
              >
                {c.severidade === 'INFO' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <div className="font-black text-xs">{c.titulo}</div>
                  <p className="text-[11px] leading-relaxed">{c.evidencia}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Breakdown da Store Produtos (36 colunas embutidas vs catálogo resumido) */}
          <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-3.5 space-y-2">
            <div className="font-black uppercase text-[11px] text-blue-950 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-blue-700" />
              <span>Análise Somente Leitura da Store "produtos" (BASE RUB 36 Colunas)</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="bg-white border border-blue-200 rounded-lg p-2">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Total em "produtos"
                </span>
                <span className="text-base font-black font-mono text-slate-900">
                  {relatorio.breakdownProdutos.totalProdutosIndexedDB.toLocaleString('pt-BR')}
                </span>
              </div>
              <div className="bg-white border border-emerald-300 rounded-lg p-2">
                <span className="text-[10px] font-bold uppercase text-emerald-700 block">
                  Com dados_operacionais (36 col.)
                </span>
                <span className="text-base font-black font-mono text-emerald-800">
                  {relatorio.breakdownProdutos.comDadosOperacionaisEmbutidos.toLocaleString('pt-BR')}
                </span>
              </div>
              <div className="bg-white border border-amber-300 rounded-lg p-2">
                <span className="text-[10px] font-bold uppercase text-amber-700 block">
                  Campos 36 col. planos
                </span>
                <span className="text-base font-black font-mono text-amber-800">
                  {relatorio.breakdownProdutos.comCampos36ColunasPlanosSemObj.toLocaleString('pt-BR')}
                </span>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Somente Catálogo
                </span>
                <span className="text-base font-black font-mono text-slate-700">
                  {relatorio.breakdownProdutos.somenteCatalogoResumido.toLocaleString('pt-BR')}
                </span>
              </div>
            </div>
            {relatorio.breakdownProdutos.ultimaAtualizacaoMaisRecente && (
              <div className="text-[11px] font-mono text-blue-900">
                Último atualizado_em em "produtos":{' '}
                {relatorio.breakdownProdutos.ultimaAtualizacaoMaisRecente}
              </div>
            )}
          </div>

          {/* Tabela Comparativa: IndexedDB Real vs Memória Atual */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-black">
                <tr>
                  <th className="px-3 py-2 border-b border-slate-200">Conjunto de Dados</th>
                  <th className="px-3 py-2 border-b border-slate-200">Store IDB</th>
                  <th className="px-3 py-2 border-b border-slate-200 text-right">IndexedDB</th>
                  <th className="px-3 py-2 border-b border-slate-200 text-right">Em Memória</th>
                  <th className="px-3 py-2 border-b border-slate-200">Init?</th>
                  <th className="px-3 py-2 border-b border-slate-200">Origem / Observação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {relatorio.comparativoMemoriaVsIdb.map((row) => {
                  const divergente = row.quantidadeIndexedDB !== row.quantidadeMemoria;
                  return (
                    <tr
                      key={row.conjunto}
                      className={divergente ? 'bg-amber-50/70' : 'bg-white'}
                    >
                      <td className="px-3 py-2 font-bold text-slate-900">{row.conjunto}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-600">
                        {row.storeIndexedDB}
                      </td>
                      <td className="px-3 py-2 font-mono font-black text-right text-slate-900">
                        {row.quantidadeIndexedDB.toLocaleString('pt-BR')}
                      </td>
                      <td
                        className={`px-3 py-2 font-mono font-black text-right ${
                          divergente ? 'text-amber-800' : 'text-emerald-700'
                        }`}
                      >
                        {row.quantidadeMemoria.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px]">
                        {row.servicoInicializado ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                            SIM
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-bold">
                            NÃO
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <div className="font-semibold">{row.origemProvavel}</div>
                        <div className="text-[10px] text-slate-500">{row.observacao}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Metadados & localStorage (Detalhes colapsáveis) */}
          <details className="border border-slate-200 rounded-lg bg-slate-50">
            <summary className="px-3.5 py-2.5 font-black uppercase text-[11px] text-slate-800 cursor-pointer flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-blue-700" />
              <span>
                Detalhes Técnicos: {relatorio.contagensStores.length} ObjectStores,{' '}
                {relatorio.metadadosArmazenados.length} Metadados IDB e localStorage
              </span>
            </summary>
            <div className="p-3.5 pt-0 space-y-3 border-t border-slate-200 bg-white rounded-b-lg">
              <div>
                <div className="font-bold text-[10px] uppercase text-slate-500 mb-1">
                  Contagem bruta de todas as stores (ControleVencimentosDB_v2)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 font-mono text-[10px]">
                  {relatorio.contagensStores.map((s) => (
                    <div
                      key={s.storeName}
                      className="px-2 py-1 rounded border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                    >
                      <span className="truncate text-slate-700">{s.storeName}</span>
                      <span className="font-black text-slate-900">
                        {s.countIndexedDB.toLocaleString('pt-BR')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="font-bold text-[10px] uppercase text-slate-500 mb-1">
                  Chaves em STORES.METADADOS
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  {relatorio.metadadosArmazenados.length === 0 ? (
                    <div className="text-slate-500">Nenhuma chave na store metadados.</div>
                  ) : (
                    relatorio.metadadosArmazenados.map((m) => (
                      <div key={m.key} className="p-2 rounded bg-slate-50 border border-slate-200 break-all">
                        <strong className="text-blue-900">{m.key}:</strong> {m.resumo}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="font-bold text-[10px] uppercase text-slate-500 mb-1">
                  Chaves relevantes no localStorage
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  {relatorio.chavesLocalStorage.map((k) => (
                    <div key={k.key} className="p-2 rounded bg-slate-50 border border-slate-200 break-all">
                      <strong className="text-slate-900">{k.key}</strong>{' '}
                      <span className={k.presente ? 'text-emerald-700' : 'text-slate-400'}>
                        ({k.presente ? 'presente' : 'ausente'})
                      </span>
                      : {k.resumo}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
};
