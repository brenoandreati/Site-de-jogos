import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createTestApp, seedMenu, signupOwner, type CapturingMailer } from './helpers';

let app: FastifyInstance;
let mailer: CapturingMailer;

beforeAll(async () => {
  ({ app, mailer } = await createTestApp());
});
afterAll(async () => {
  await app.close();
});

describe('isolamento entre empresas', () => {
  it('uma empresa não lê, altera nem usa dados de outra', async () => {
    const a = await signupOwner(app);
    const b = await signupOwner(app);
    const menuA = await seedMenu(a.client);

    expect((await b.client.get(`/api/catalog/products/${menuA.productId}`)).statusCode).toBe(404);
    const update = await b.client.put(`/api/catalog/products/${menuA.productId}`, {
      categoryId: menuA.categoryId,
      name: 'Invadido',
      priceCents: 1,
    });
    expect(update.statusCode).toBe(404); // para B, o produto de A não existe
    expect((await b.client.del(`/api/catalog/products/${menuA.productId}`)).statusCode).toBe(404);
    expect((await b.client.del(`/api/catalog/modifier-groups/${menuA.sizeGroupId}`)).statusCode).toBe(404);

    // B tenta vincular o grupo de adicionais de A a um produto próprio.
    const catB = await b.client.post('/api/catalog/categories', { name: 'Lanches' });
    const steal = await b.client.post('/api/catalog/products', {
      categoryId: catB.json().id,
      name: 'X-Burguer',
      priceCents: 2000,
      modifierGroupIds: [menuA.sizeGroupId],
    });
    expect(steal.statusCode).toBe(422);

    const catalogB = (await b.client.get('/api/catalog')).json();
    expect(JSON.stringify(catalogB)).not.toContain(menuA.productId);

    const productA = (await a.client.get(`/api/catalog/products/${menuA.productId}`)).json();
    expect(productA.name).toBe('Açaí tradicional');
  });

  it('não permite trocar para uma empresa da qual o usuário não faz parte', async () => {
    const a = await signupOwner(app);
    const b = await signupOwner(app);
    const res = await a.client.post('/api/auth/switch-tenant', { tenantId: b.me.active.tenant.id });
    expect(res.statusCode).toBe(404);
  });
});

describe('equipe e permissões', () => {
  async function inviteAndAccept(owner: Awaited<ReturnType<typeof signupOwner>>, role: string, permissions?: Record<string, string>) {
    const email = `func-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@teste.com`;
    const invite = await owner.client.post('/api/team', { name: 'Funcionário', email, role, permissions });
    expect(invite.statusCode, invite.body).toBe(201);
    const token = invite.json().inviteUrl.split('/convite/')[1];
    expect(mailer.messages.at(-1)?.to).toBe(email);
    const staff = new Client(app);
    const info = await staff.get(`/api/auth/invites/${token}`);
    expect(info.json().needsPassword).toBe(true);
    const accept = await staff.post('/api/auth/invites/accept', { token, name: 'Pedro Atendente', password: 'senha-func-123' });
    expect(accept.statusCode, accept.body).toBe(200);
    expect(accept.json().loggedIn).toBe(true);
    return { staff, membershipId: invite.json().id as string, token };
  }

  it('atendente opera pedidos mas não acessa configurações, equipe nem cancela', async () => {
    const owner = await signupOwner(app);
    const { staff, token } = await inviteAndAccept(owner, 'attendant');
    const me = (await staff.get('/api/auth/me')).json();
    expect(me.active.role).toBe('attendant');
    expect((await staff.get('/api/orders/board')).statusCode).toBe(200);
    expect((await staff.put('/api/settings/orders', {})).statusCode).toBe(403);
    expect((await staff.get('/api/team')).statusCode).toBe(403);
    expect((await staff.get('/api/dashboard')).statusCode).toBe(403);
    expect((await staff.post('/api/catalog/categories', { name: 'X' })).statusCode).toBe(403);
    // Convite não pode ser reutilizado.
    expect((await new Client(app).post('/api/auth/invites/accept', { token, password: 'outra-senha-1' })).statusCode).toBe(422);
  });

  it('o proprietário personaliza permissões e desativa acessos', async () => {
    const owner = await signupOwner(app);
    const { staff, membershipId } = await inviteAndAccept(owner, 'attendant');
    expect((await staff.get('/api/dashboard')).statusCode).toBe(403);

    const custom = await owner.client.put(`/api/team/${membershipId}`, { role: 'attendant', permissions: { dashboard: 'view' }, isActive: true });
    expect(custom.statusCode, custom.body).toBe(200);
    expect((await staff.get('/api/dashboard')).statusCode).toBe(200);

    await owner.client.put(`/api/team/${membershipId}`, { role: 'attendant', permissions: null, isActive: false });
    expect((await staff.get('/api/orders/board')).statusCode).toBe(403);
  });

  it('protege o proprietário e impede escalada de privilégio', async () => {
    const owner = await signupOwner(app);
    const { staff } = await inviteAndAccept(owner, 'manager');
    const team = (await owner.client.get('/api/team')).json();
    const ownerMembership = team.members.find((m: { role: string }) => m.role === 'owner');
    // Gerente não promove ninguém a administrador nem mexe no proprietário.
    expect((await staff.post('/api/team', { name: 'X', email: 'x-admin@teste.com', role: 'admin' })).statusCode).toBe(403);
    expect((await staff.put(`/api/team/${ownerMembership.id}`, { role: 'attendant', isActive: true })).statusCode).toBe(403);
    // O proprietário não remove a si mesmo.
    expect((await owner.client.del(`/api/team/${ownerMembership.id}`)).statusCode).toBe(403);
  });
});
