/**
 * Valores monetários são sempre trafegados e armazenados em centavos (inteiros).
 * Nunca usar ponto flutuante para somar dinheiro.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: number): string {
  // Intl usa espaço não separável (U+00A0) entre "R$" e o número; normalizamos
  // para espaço comum para facilitar cópia/colagem e mensagens de WhatsApp.
  return brl.format(cents / 100).replace(/ /g, ' ');
}

/** Converte "12,50", "12.50", "R$ 1.234,56" ou "1234" em centavos. Retorna null se inválido. */
export function parseBRLToCents(input: string): number | null {
  const raw = input.replace(/[R$\s]/g, '').trim();
  if (raw === '') return null;
  let normalized = raw;
  if (raw.includes(',')) {
    // Formato brasileiro: ponto é separador de milhar, vírgula é decimal.
    normalized = raw.replace(/\./g, '').replace(',', '.');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [intPart, decPart = ''] = normalized.split('.');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Representação para campos de formulário: 1250 → "12,50". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function isValidCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}
