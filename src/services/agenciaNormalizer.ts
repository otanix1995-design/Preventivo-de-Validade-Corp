/**
 * Utilitários canônicos de normalização e deduplicação de Agências Comerciais.
 * Garante que nomes equivalentes (ex.: "Seara", "SEARA", "  seara ", "Séara")
 * produzam exatamente a mesma chave canônica e ID estável.
 */

const NOMES_SEM_AGENCIA = new Set([
  '',
  '-',
  'SEM AGENCIA',
  'SEM AGENCIA VINCULADA',
  'AGENCIA NAO INFORMADA',
  'NAO INFORMADA',
  'NENHUMA',
]);

/**
 * Normaliza o nome de exibição preservando acentuação, mas removendo espaços
 * sobressalentes no início, fim e entre palavras.
 */
export function normalizarNomeAgenciaExibicao(nome?: string | null): string {
  if (!nome || typeof nome !== 'string') return '';
  return nome.trim().replace(/\s+/g, ' ');
}

/**
 * Verifica se o texto representa ausência de vínculo com agência.
 */
export function isAgenciaSemVinculoNome(nome?: string | null): boolean {
  const limpo = normalizarNomeAgenciaExibicao(nome);
  if (!limpo) return true;
  const ascii = limpo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return NOMES_SEM_AGENCIA.has(ascii);
}

/**
 * Gera a chave canônica de deduplicação (sem acentos, trim, espaços colapsados, maiúscula).
 * Retorna '' quando representar ausência de agência.
 */
export function normalizarChaveAgencia(nome?: string | null): string {
  if (isAgenciaSemVinculoNome(nome)) return '';
  return normalizarNomeAgenciaExibicao(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Gera ID determinístico e estável para a agência a partir de sua chave canônica.
 */
export function gerarAgenciaId(nome?: string | null): string {
  const chave = normalizarChaveAgencia(nome);
  if (!chave) return 'ag_sem_agencia';
  const slug = chave
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `ag_${slug || 'sem_agencia'}`;
}
