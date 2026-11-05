import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { MailMessage, Mailer } from '../src/services/mailer';
import type { AiProvider } from '../src/services/ai-provider';

export class CapturingMailer implements Mailer {
  readonly configured = true;
  messages: MailMessage[] = [];
  async send(message: MailMessage) {
    this.messages.push(message);
  }
  lastLink(): string {
    const text = this.messages.at(-1)?.text ?? '';
    const match = text.match(/https?:\/\/\S+/);
    if (!match) throw new Error('nenhum link no último e-mail');
    return match[0];
  }
}

export async function createTestApp(overrides: { http?: typeof fetch; ai?: AiProvider | null } = {}) {
  const mailer = new CapturingMailer();
  const app = await buildApp(loadConfig(), { mailer, http: overrides.http, ai: overrides.ai ?? null });
  await app.ready();
  return { app, mailer };
}

/**
 * Provedor HTTP falso para as integrações (Meta, Mercado Pago). Registra as chamadas e responde
 * conforme as rotas cadastradas; qualquer chamada não prevista falha o teste.
 */
export class FakeHttp {
  calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  private routes: { method: string; match: RegExp; respond: (body: unknown, url: string) => { status?: number; body: unknown } }[] = [];

  on(method: string, match: RegExp, respond: (body: unknown, url: string) => { status?: number; body: unknown }) {
    this.routes.unshift({ method, match, respond });
    return this;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    this.calls.push({ method, url, body, headers });
    const route = this.routes.find((r) => r.method === method && r.match.test(url));
    if (!route) return new Response(JSON.stringify({ error: { message: `rota falsa não cadastrada: ${method} ${url}` } }), { status: 599 });
    const r = route.respond(body, url);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };

  callsTo(match: RegExp) {
    return this.calls.filter((c) => match.test(c.url));
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Cliente HTTP com cookie de sessão, como um navegador. */
let ipCounter = 0;

export class Client {
  cookie = '';
  /** Cada cliente simula um IP diferente (o limite de requisições é por IP). */
  readonly ip = `10.${Math.floor(++ipCounter / 65536) % 256}.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  constructor(private readonly app: FastifyInstance) {}

  async req(method: Method, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      payload: body as never,
      remoteAddress: this.ip,
      headers: { 'x-balcao-client': 'web', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const c of list) {
      const [pair] = c.split(';');
      if (pair!.startsWith('balcao_session=')) this.cookie = pair!.endsWith('=') ? '' : pair!;
    }
    return res;
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  put = (url: string, body?: unknown) => this.req('PUT', url, body ?? {});
  patch = (url: string, body?: unknown) => this.req('PATCH', url, body ?? {});
  del = (url: string) => this.req('DELETE', url);
}

let counter = 0;
export function uniq(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export async function signupOwner(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const client = new Client(app);
  const slug = uniq('loja').toLowerCase();
  const email = `${uniq('dono')}@teste.com`;
  const res = await client.post('/api/auth/signup', {
    name: 'Dona Maria',
    email,
    password: 'senha-segura-123',
    storeName: 'Açaí da Maria',
    slug,
    whatsapp: '(11) 91234-5678',
    businessCategory: 'acaiteria',
    acceptTerms: true,
    ...overrides,
  });
  if (res.statusCode !== 201) throw new Error(`signup falhou: ${res.statusCode} ${res.body}`);
  return { client, slug, email, me: res.json() };
}

/** Horário 00:00–23:59 todos os dias, para a loja estar aberta durante os testes. */
export const ALWAYS_OPEN = {
  intervals: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })),
};

export async function seedMenu(client: Client) {
  const cat = await client.post('/api/catalog/categories', { name: 'Açaí' });
  if (cat.statusCode !== 201) throw new Error(cat.body);
  const group = await client.post('/api/catalog/modifier-groups', {
    name: 'Tamanho',
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: '300 ml', priceCents: 0 },
      { name: '500 ml', priceCents: 600 },
    ],
  });
  if (group.statusCode !== 201) throw new Error(group.body);
  const extras = await client.post('/api/catalog/modifier-groups', {
    name: 'Adicionais',
    minSelect: 0,
    maxSelect: 4,
    options: [{ name: 'Nutella', priceCents: 450, maxQuantity: 2 }, { name: 'Granola', priceCents: 0 }],
  });
  const product = await client.post('/api/catalog/products', {
    categoryId: cat.json().id,
    name: 'Açaí tradicional',
    priceCents: 1500,
    modifierGroupIds: [group.json().id, extras.json().id],
  });
  if (product.statusCode !== 201) throw new Error(product.body);
  return {
    categoryId: cat.json().id as string,
    productId: product.json().id as string,
    size300: group.json().options[0].id as string,
    size500: group.json().options[1].id as string,
    nutella: extras.json().options[0].id as string,
    granola: extras.json().options[1].id as string,
    sizeGroupId: group.json().id as string,
  };
}

export function checkout(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    customer: { name: 'João Cliente', phone: '(21) 99876-5432' },
    fulfillment: 'pickup',
    paymentMethod: 'cash',
    items: [],
    ...overrides,
  };
}
