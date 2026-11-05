import type { ZodType } from 'zod';
import { ApiError } from './api';

/** Erros por campo: validação local (mesmo schema da API) ou resposta 422 do servidor. */
export type FieldErrors = Record<string, string>;

export function validate<T extends ZodType>(schema: T, data: unknown): { ok: true; data: T['_output'] } | { ok: false; errors: FieldErrors } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const errors: FieldErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

export function serverFieldErrors(err: unknown): FieldErrors {
  return err instanceof ApiError && err.fields ? err.fields : {};
}
