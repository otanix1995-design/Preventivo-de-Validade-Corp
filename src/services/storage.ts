import {
  DivergenciaRegistro,
  LoteVencimento,
  MetadadosBase,
  ProdutoSMG,
  ResumoImportacao,
  VinculoEan
} from '../types';
import { productRepository } from './productRepository';

export function subscribeToStore(cb: () => void): () => void {
  return productRepository.subscribe(cb);
}

export function initStorage(): Promise<void> {
  return productRepository.init();
}

export function reprocessarBases(): Promise<void> {
  return productRepository.reprocessarBases();
}

export function loadDemoData(): Promise<void> {
  return productRepository.loadDemoData();
}

export function clearAllData(): Promise<void> {
  return productRepository.clearAllData();
}

// PRODUTOS
export function getProdutos(): ProdutoSMG[] {
  return productRepository.getAllProducts();
}

export function saveProdutos(
  novosProdutos: ProdutoSMG[],
  onProgress?: (pct: number, msg: string) => void
): Promise<boolean> {
  return productRepository.saveProducts(novosProdutos, onProgress);
}

export function getProdutoByCodigoInterno(codigo: string): ProdutoSMG | undefined {
  return productRepository.getProductByInternalCode(codigo);
}

export function getProdutoByEan(ean: string): ProdutoSMG | undefined {
  return productRepository.getProductByBarcode(ean);
}

export function findProdutoByCodeOrEan(query: string): ProdutoSMG | undefined {
  return productRepository.findByCodeOrEan(query);
}

export function searchProdutos(
  query: string,
  optionsOrList?: { gramagem?: string | null; limit?: number } | ProdutoSMG[]
): ProdutoSMG[] {
  if (Array.isArray(optionsOrList)) {
    if (!query || !query.trim()) return optionsOrList;
    const qNorm = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    return optionsOrList.filter((p) => {
      if (p.descricao && p.descricao.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes(qNorm)) return true;
      if (p.codigo_interno && p.codigo_interno.includes(query.trim())) return true;
      if (p.codigo_exibicao && p.codigo_exibicao.includes(query.trim())) return true;
      if (p.eans && p.eans.some((e) => e.includes(query.trim()))) return true;
      return false;
    });
  }
  return productRepository.searchProducts(query, optionsOrList);
}

// VENCIMENTOS (Lotes)
export function getVencimentos(): LoteVencimento[] {
  return productRepository.getVencimentos();
}

export function saveVencimentos(vencimentos: LoteVencimento[]): Promise<void> {
  return productRepository.saveVencimentos(vencimentos);
}

export function addVencimento(
  novoLote: Omit<LoteVencimento, 'id' | 'criado_em' | 'atualizado_em'>
): Promise<LoteVencimento> | LoteVencimento {
  return productRepository.addVencimento(novoLote);
}

export function updateVencimento(
  id: string,
  updates: Partial<LoteVencimento>
): Promise<LoteVencimento | undefined> | LoteVencimento | undefined {
  return productRepository.updateVencimento(id, updates);
}

export function deleteVencimento(id: string): Promise<boolean> | boolean {
  return productRepository.deleteVencimento(id);
}

export function getVencimentosByCodigoInterno(codigo_interno: string): LoteVencimento[] {
  return productRepository.getVencimentosByCodigoInterno(codigo_interno);
}

// VINCULOS EAN
export function getVinculosEan(): VinculoEan[] {
  return productRepository.getVinculos();
}

export function saveVinculosEan(vinculos: VinculoEan[]): Promise<void> {
  return productRepository.saveVinculos(vinculos);
}

export function vincularEanManualmente(
  ean: string,
  codigoInternoOuOriginal: string,
  descricaoManual?: string
): Promise<{ success: boolean; produto?: ProdutoSMG; erro?: string }> {
  return productRepository.vincularEanManualmente(ean, codigoInternoOuOriginal, descricaoManual);
}

export function desvincularEan(ean: string): Promise<boolean> {
  return productRepository.desvincularEan(ean);
}

// DIVERGENCIAS
export function getDivergencias(): DivergenciaRegistro[] {
  return productRepository.getDivergencias();
}

export function addDivergencia(
  div: Omit<DivergenciaRegistro, 'id' | 'data_registro'>
): Promise<DivergenciaRegistro> | DivergenciaRegistro {
  return productRepository.addDivergencia(div);
}

export function deleteDivergencia(id: string): Promise<boolean> | boolean {
  return productRepository.deleteDivergencia(id);
}

export function saveDivergencias(divs: DivergenciaRegistro[]): Promise<void> {
  return productRepository.saveDivergencias(divs);
}

export function clearDivergencias(): Promise<void> {
  return productRepository.clearDivergencias();
}

// METADADOS
export function getMetadados(): MetadadosBase {
  return productRepository.getMetadados();
}

export function saveMetadados(meta: MetadadosBase): Promise<void> {
  return productRepository.saveMetadados(meta);
}

// HISTORICO IMPORTACOES
export function getHistoricoImportacoes(): ResumoImportacao[] {
  return productRepository.getHistorico();
}

export function addResumoImportacao(resumo: ResumoImportacao): Promise<void> {
  return productRepository.addHistorico(resumo);
}

export function clearHistoricoImportacoes(): Promise<void> {
  return productRepository.clearHistorico();
}

/**
 * Remove lotes de vencimento antigos/expirados.
 */
export async function clearLotesVencidos(diasMargem: number = 0): Promise<{ removidos: number; restantes: number }> {
  const lotes = productRepository.getVencimentos();
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  let limiteDate = new Date(hoje);
  if (diasMargem > 0) {
    limiteDate.setDate(limiteDate.getDate() - diasMargem);
  }

  const limiteStr = limiteDate.toISOString().split('T')[0];

  let mantidos: LoteVencimento[] = [];
  let removidosCount = 0;

  if (diasMargem === -1) {
    removidosCount = lotes.length;
    mantidos = [];
  } else {
    for (const lote of lotes) {
      if (lote.data_validade < limiteStr) {
        removidosCount++;
      } else {
        mantidos.push(lote);
      }
    }
  }

  await productRepository.saveVencimentos(mantidos);
  return { removidos: removidosCount, restantes: mantidos.length };
}

/**
 * Remove vínculos EAN inválidos ou com código interno não localizado na base.
 */
export async function clearVinculosNaoLocalizados(): Promise<{ removidos: number; restantes: number }> {
  const vinculos = productRepository.getVinculos();
  const validos = vinculos.filter((v) => v.status_vinculo === 'VINCULADO');
  const removidos = vinculos.length - validos.length;
  await productRepository.saveVinculos(validos);
  return { removidos, restantes: validos.length };
}

export interface OpcoesLimpezaDados {
  limparLotesVencidos: boolean;
  diasMargemLotes: number;
  limparHistoricoImportacoes: boolean;
  limparDivergencias: boolean;
  limparVinculosOrfaos: boolean;
}

export interface ResultadoLimpezaDados {
  lotesRemovidos: number;
  historicoRemovido: number;
  divergenciasRemovidas: number;
  vinculosOrfaosRemovidos: number;
}

/**
 * Executa a limpeza consolidada dos dados antigos selecionados pelo usuário.
 */
export async function clearDadosAntigos(opcoes: OpcoesLimpezaDados): Promise<ResultadoLimpezaDados> {
  const resultado: ResultadoLimpezaDados = {
    lotesRemovidos: 0,
    historicoRemovido: 0,
    divergenciasRemovidas: 0,
    vinculosOrfaosRemovidos: 0,
  };

  if (opcoes.limparLotesVencidos) {
    const res = await clearLotesVencidos(opcoes.diasMargemLotes);
    resultado.lotesRemovidos = res.removidos;
  }

  if (opcoes.limparHistoricoImportacoes) {
    const hist = productRepository.getHistorico();
    resultado.historicoRemovido = hist.length;
    await productRepository.clearHistorico();
  }

  if (opcoes.limparDivergencias) {
    const divs = productRepository.getDivergencias();
    resultado.divergenciasRemovidas = divs.length;
    await productRepository.clearDivergencias();
  }

  if (opcoes.limparVinculosOrfaos) {
    const res = await clearVinculosNaoLocalizados();
    resultado.vinculosOrfaosRemovidos = res.removidos;
  }

  return resultado;
}
