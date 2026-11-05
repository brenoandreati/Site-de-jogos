import type { ZodError, ZodType } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', message, fields);
export const unauthorized = (message = 'Faça login para continuar.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Registro não encontrado.') => new AppError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
export const unprocessable = (message: string, fields?: Record<string, string>, code = 'validation_error') =>
  new AppError(422, code, message, fields);

export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** Valida a entrada com o schema compartilhado; lança 422 com erros por campo. */
export function parse<T extends ZodType>(schema: T, data: unknown): T['_output'] {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields = zodFields(result.error);
    const first = Object.values(fields)[0] ?? 'Dados inválidos.';
    throw unprocessable(first, fields);
  }
  return result.data;
}

/** Código de violação de unicidade do PostgreSQL. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = findPgError(err);
  return !!e && e.code === '23505' && (!constraint || e.constraint === constraint);
}

export function isForeignKeyViolation(err: unknown): boolean {
  return findPgError(err)?.code === '23503';
}

function findPgError(err: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = err;
  for (let i = 0; i < 4 && current; i++) {
    if (typeof current === 'object' && current && 'code' in current && typeof (current as { code: unknown }).code === 'string') {
      return current as { code?: string; constraint?: string };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
