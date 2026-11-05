import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createTestApp, signupOwner, type CapturingMailer } from './helpers';

let app: FastifyInstance;
let mailer: CapturingMailer;

beforeAll(async () => {
  ({ app, mailer } = await createTestApp());
});
afterAll(async () => {
  await app.close();
});

describe('autenticação', () => {
  it('cadastra empresa, unidade e proprietário e já entra logado', async () => {
    const { client, me, slug } = await signupOwner(app);
    expect(me.active.tenant.slug).toBe(slug);
    expect(me.active.role).toBe('owner');
    expect(me.active.branches).toHaveLength(1);
    expect(me.active.permissions.orders).toBe('manage');
    const res = await client.get('/api/auth/me');
    expect(res.statusCode).toBe(200);
  });

  it('valida cadastro: e-mail repetido, endereço reservado e termos', async () => {
    const { email } = await signupOwner(app);
    const client = new Client(app);
    const dup = await client.post('/api/auth/signup', {
      name: 'Outra',
      email,
      password: 'senha-segura-123',
      storeName: 'Outra loja',
      slug: 'outra-loja-x1',
      whatsapp: '11912345678',
      businessCategory: 'pizzaria',
      acceptTerms: true,
    });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().error.code).toBe('email_taken');

    const reserved = await client.post('/api/auth/signup', {
      name: 'Outra',
      email: 'novo-reservado@teste.com',
      password: 'senha-segura-123',
      storeName: 'Painel',
      slug: 'painel',
      whatsapp: '11912345678',
      businessCategory: 'pizzaria',
      acceptTerms: true,
    });
    expect(reserved.statusCode).toBe(422);
    expect(reserved.json().error.fields.slug).toBeTruthy();

    const terms = await client.post('/api/auth/signup', {
      name: 'Outra',
      email: 'novo-termos@teste.com',
      password: 'senha-segura-123',
      storeName: 'Loja termos',
      slug: 'loja-termos',
      whatsapp: '11912345678',
      businessCategory: 'pizzaria',
      acceptTerms: false,
    });
    expect(terms.statusCode).toBe(422);
  });

  it('login com senha errada falha sem revelar se o e-mail existe', async () => {
    const { email } = await signupOwner(app);
    const client = new Client(app);
    const wrong = await client.post('/api/auth/login', { email, password: 'errada-123' });
    const unknown = await client.post('/api/auth/login', { email: 'ninguem@teste.com', password: 'errada-123' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
    const ok = await client.post('/api/auth/login', { email, password: 'senha-segura-123' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().active.role).toBe('owner');
  });

  it('logout encerra a sessão', async () => {
    const { client } = await signupOwner(app);
    const token = client.cookie;
    await client.post('/api/auth/logout');
    const other = new Client(app);
    other.cookie = token;
    expect((await other.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('bloqueia requisições que alteram dados sem o cabeçalho anti-CSRF ou de outra origem', async () => {
    const { client } = await signupOwner(app);
    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/catalog/categories',
      payload: { name: 'X' },
      headers: { cookie: client.cookie },
    });
    expect(noHeader.statusCode).toBe(403);
    const evil = await client.req('POST', '/api/catalog/categories', { name: 'X' }, { origin: 'https://site-malicioso.com' });
    expect(evil.statusCode).toBe(403);
  });

  it('recupera a senha por link de uso único e derruba as sessões antigas', async () => {
    const { client, email } = await signupOwner(app);
    const anon = new Client(app);
    const res = await anon.post('/api/auth/forgot-password', { email });
    expect(res.statusCode).toBe(200);
    const link = mailer.lastLink();
    const token = new URL(link).searchParams.get('token')!;

    const reset = await anon.post('/api/auth/reset-password', { token, password: 'nova-senha-456' });
    expect(reset.statusCode).toBe(200);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
    const reuse = await anon.post('/api/auth/reset-password', { token, password: 'outra-senha-789' });
    expect(reuse.statusCode).toBe(422);
    expect((await anon.post('/api/auth/login', { email, password: 'nova-senha-456' })).statusCode).toBe(200);

    // E-mail inexistente recebe a mesma resposta (não revela contas).
    const before = mailer.messages.length;
    expect((await anon.post('/api/auth/forgot-password', { email: 'nao-existe@teste.com' })).statusCode).toBe(200);
    expect(mailer.messages.length).toBe(before);
  });
});
