/** Erro de chamada a um provedor externo, com indicação se vale tentar de novo. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function requestJson<T>(
  fetchImpl: typeof fetch,
  provider: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
  parseError: (status: number, body: unknown) => { message: string; retryable?: boolean } = (status) => ({ message: `HTTP ${status}` }),
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch (err) {
    throw new ProviderError(provider, 0, `Sem resposta de ${provider}: ${(err as Error).message}`, true);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const parsed = parseError(res.status, body);
    throw new ProviderError(provider, res.status, parsed.message, parsed.retryable ?? (res.status >= 500 || res.status === 429), body);
  }
  return body as T;
}
