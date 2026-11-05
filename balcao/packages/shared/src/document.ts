/**
 * Validação de CPF e CNPJ (incluindo o CNPJ alfanumérico, vigente desde julho de 2026).
 * No CNPJ alfanumérico, as 12 primeiras posições aceitam letras e números e os dois
 * dígitos verificadores continuam numéricos. O valor de cada caractere é (código ASCII − 48).
 */

export type DocumentType = 'cpf' | 'cnpj';

export function cleanDocument(input: string): string {
  return input.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export function isValidCPF(input: string): boolean {
  const cpf = input.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digits = cpf.split('').map(Number);
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += digits[i]! * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === digits[9] && calc(10) === digits[10];
}

export function isValidCNPJ(input: string): boolean {
  const cnpj = cleanDocument(input);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const values = cnpj.split('').map((c) => c.charCodeAt(0) - 48);
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += values[i]! * weights[i]!;
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === values[12] && calc(13) === values[13];
}

export function detectDocumentType(input: string): DocumentType | null {
  const clean = cleanDocument(input);
  if (clean.length === 11 && isValidCPF(clean)) return 'cpf';
  if (clean.length === 14 && isValidCNPJ(clean)) return 'cnpj';
  return null;
}

export function formatDocument(input: string): string {
  const clean = cleanDocument(input);
  if (clean.length === 11) return clean.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (clean.length === 14) return clean.replace(/^(.{2})(.{3})(.{3})(.{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return input;
}
