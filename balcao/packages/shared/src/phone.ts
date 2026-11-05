/**
 * Telefones brasileiros normalizados para o formato usado pela WhatsApp Cloud API:
 * DDI + DDD + número, somente dígitos. Ex.: 5511912345678.
 */

const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45,
  46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83,
  84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function normalizeBrazilianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!(digits.length === 12 || digits.length === 13) || !digits.startsWith('55')) return null;

  const ddd = Number(digits.slice(2, 4));
  if (!VALID_DDDS.has(ddd)) return null;

  const local = digits.slice(4);
  if (local.length === 9 && !local.startsWith('9')) return null;
  if (local.length === 8 && !/^[2-5]/.test(local)) return null;
  return digits;
}

export function isValidBrazilianPhone(input: string): boolean {
  return normalizeBrazilianPhone(input) !== null;
}

/** 5511912345678 → (11) 91234-5678 */
export function formatPhone(normalized: string): string {
  const digits = normalized.replace(/\D/g, '');
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  const ddd = national.slice(0, 2);
  const local = national.slice(2);
  if (local.length === 9) return `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`;
  if (local.length === 8) return `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
  return normalized;
}

/** Link oficial de clique para conversar (wa.me). Não envia nada sozinho: abre o WhatsApp de quem clica. */
export function whatsappLink(normalized: string, text?: string): string {
  const base = `https://wa.me/${normalized.replace(/\D/g, '')}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * A WhatsApp às vezes identifica celulares brasileiros sem o nono dígito (ex.: 551187654321).
 * Para o cadastro do cliente usamos o número completo; para responder, o wa_id original.
 */
export function normalizeWhatsAppId(waId: string): string | null {
  const digits = waId.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('55') && /^[6-9]/.test(digits.slice(4))) {
    return normalizeBrazilianPhone(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  }
  return normalizeBrazilianPhone(digits) ?? (digits.length >= 8 && digits.length <= 15 ? digits : null);
}
