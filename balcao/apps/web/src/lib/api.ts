/** Cliente HTTP do navegador. Todas as chamadas passam por /api (mesma origem, cookie de sessão httpOnly). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T = unknown>(
  path: string,
  options: { method?: Method; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: {
        'x-balcao-client': 'web',
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
      },
      body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Erro ${res.status}. Tente novamente.`, e?.fields);
  }
  return data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Algo deu errado. Tente novamente.';
}

export async function uploadImage(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new ApiError(413, 'file_too_large', 'A imagem deve ter no máximo 5 MB.');
  const form = new FormData();
  form.append('file', file);
  const res = await api<{ url: string }>('/uploads/images', { method: 'POST', body: form });
  return res.url;
}
