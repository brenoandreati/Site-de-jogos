import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ALWAYS_OPEN, Client, checkout, createTestApp, seedMenu, signupOwner } from './helpers';
import type { TenantEvent } from '../src/services/events';

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await createTestApp());
});
afterAll(async () => {
  await app.close();
});

async function openStore() {
  const owner = await signupOwner(app);
  await owner.client.put('/api/settings/hours', ALWAYS_OPEN);
  const menu = await seedMenu(owner.client);
  return { ...owner, menu };
}

describe('pedido pelo cardápio digital', () => {
  it('recalcula preços no servidor e ignora valores enviados pelo cliente', async () => {
    const { slug, menu, client } = await openStore();
    const anon = new Client(app);
    const res = await anon.post(
      `/api/public/stores/${slug}/orders`,
      checkout({
        totalCents: 1, // tentativa de manipular o total: deve ser ignorada
        items: [
          {
            productId: menu.productId,
            quantity: 2,
            priceCents: 1,
            notes: 'Sem açúcar',
            modifiers: [
              { modifierId: menu.size500, quantity: 1 },
              { modifierId: menu.nutella, quantity: 2 },
            ],
          },
        ],
      }),
    );
    expect(res.statusCode).toBe(201);
    const { token, number, status } = res.json();
    expect(number).toBe(1);
    expect(status).toBe('new');

    const tracking = await anon.get(`/api/public/orders/${token}`);
    const t = tracking.json();
    // (1500 + 600 + 2×450) × 2 = 6000
    expect(t.subtotalCents).toBe(6000);
    expect(t.totalCents).toBe(6000);
    expect(t.items[0].modifiers.map((m: { name: string }) => m.name)).toEqual(['500 ml', 'Nutella']);

    const board = await client.get('/api/orders/board');
    expect(board.json().orders).toHaveLength(1);
    expect(board.json().orders[0].customerPhone).toBe('5521998765432');
  });

  it('não duplica pedido quando o cliente reenvia (idempotência), nem em envios simultâneos', async () => {
    const { slug, menu, client } = await openStore();
    const body = checkout({ items: [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: menu.size300, quantity: 1 }] }] });
    const anon = new Client(app);
    const results = await Promise.all([
      anon.post(`/api/public/stores/${slug}/orders`, body),
      anon.post(`/api/public/stores/${slug}/orders`, body),
      anon.post(`/api/public/stores/${slug}/orders`, body),
    ]);
    const tokens = new Set(results.map((r) => r.json().token));
    expect(tokens.size).toBe(1);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const again = await anon.post(`/api/public/stores/${slug}/orders`, body);
    expect(again.statusCode).toBe(200);
    expect((await client.get('/api/orders')).json().total).toBe(1);
  });

  it('valida adicionais obrigatórios, limites e opções de outro produto', async () => {
    const { slug, menu } = await openStore();
    const other = await openStore();
    const anon = new Client(app);
    const missing = await anon.post(`/api/public/stores/${slug}/orders`, checkout({ items: [{ productId: menu.productId, quantity: 1, modifiers: [] }] }));
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.message).toMatch(/Tamanho/);

    const tooMuch = await anon.post(
      `/api/public/stores/${slug}/orders`,
      checkout({ items: [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: menu.size300, quantity: 1 }, { modifierId: menu.nutella, quantity: 3 }] }] }),
    );
    expect(tooMuch.statusCode).toBe(422);

    // Produto de outra loja não pode ser pedido nesta loja.
    const foreign = await anon.post(
      `/api/public/stores/${slug}/orders`,
      checkout({ items: [{ productId: other.menu.productId, quantity: 1, modifiers: [{ modifierId: other.menu.size300, quantity: 1 }] }] }),
    );
    expect(foreign.statusCode).toBe(422);

    // Adicional de outra loja em produto desta loja.
    const foreignModifier = await anon.post(
      `/api/public/stores/${slug}/orders`,
      checkout({ items: [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: other.menu.size300, quantity: 1 }] }] }),
    );
    expect(foreignModifier.statusCode).toBe(422);
  });

  it('respeita horário, pausa, tipos de atendimento, pagamento aceito e pedido mínimo', async () => {
    const owner = await signupOwner(app);
    const menu = await seedMenu(owner.client);
    const anon = new Client(app);
    const item = [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: menu.size300, quantity: 1 }] }];

    // Sem horário cadastrado a loja fica fechada.
    const closed = await anon.post(`/api/public/stores/${owner.slug}/orders`, checkout({ items: item }));
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe('store_closed');

    await owner.client.put('/api/settings/hours', ALWAYS_OPEN);
    await owner.client.post('/api/settings/pause', { paused: true, durationMinutes: 30, reason: 'Cozinha cheia' });
    expect((await anon.post(`/api/public/stores/${owner.slug}/orders`, checkout({ items: item }))).statusCode).toBe(409);
    await owner.client.post('/api/settings/pause', { paused: false });

    const settings = (await owner.client.get('/api/settings')).json();
    const put = await owner.client.put('/api/settings/orders', {
      ...settings.orders,
      acceptsDineIn: false,
      minOrderCents: 5000,
      deliveryFeeCents: 700,
      paymentMethods: ['cash'],
    });
    expect(put.statusCode).toBe(200);

    const dineIn = await anon.post(`/api/public/stores/${owner.slug}/orders`, checkout({ items: item, fulfillment: 'dine_in' }));
    expect(dineIn.statusCode).toBe(422);
    const card = await anon.post(`/api/public/stores/${owner.slug}/orders`, checkout({ items: item, paymentMethod: 'credit_card' }));
    expect(card.statusCode).toBe(422);
    const address = { street: 'Rua das Flores', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP' };
    const belowMin = await anon.post(`/api/public/stores/${owner.slug}/orders`, checkout({ items: item, fulfillment: 'delivery', address }));
    expect(belowMin.statusCode).toBe(422);
    expect(belowMin.json().error.code).toBe('min_order');

    const big = [{ ...item[0]!, quantity: 4 }];
    const ok = await anon.post(`/api/public/stores/${owner.slug}/orders`, checkout({ items: big, fulfillment: 'delivery', address, changeForCents: 10000 }));
    expect(ok.statusCode).toBe(201);
    const t = (await anon.get(`/api/public/orders/${ok.json().token}`)).json();
    expect(t.deliveryFeeCents).toBe(700);
    expect(t.totalCents).toBe(6700);
    expect(t.changeForCents).toBe(10000);
  });

  it('reserva estoque, recusa quando esgota e devolve no cancelamento', async () => {
    const { slug, client } = await openStore();
    const cat = await client.post('/api/catalog/categories', { name: 'Bebidas' });
    const soda = await client.post('/api/catalog/products', {
      categoryId: cat.json().id,
      name: 'Refrigerante lata',
      priceCents: 600,
      trackStock: true,
      stockQuantity: 3,
    });
    const anon = new Client(app);
    const first = await anon.post(`/api/public/stores/${slug}/orders`, checkout({ items: [{ productId: soda.json().id, quantity: 2 }] }));
    expect(first.statusCode).toBe(201);
    const second = await anon.post(`/api/public/stores/${slug}/orders`, checkout({ items: [{ productId: soda.json().id, quantity: 2 }] }));
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('out_of_stock');

    const board = (await client.get('/api/orders/board')).json();
    const orderId = board.orders.find((o: { number: number }) => o.number === 1).id;
    const cancel = await client.patch(`/api/orders/${orderId}/status`, { status: 'canceled', reason: 'Cliente desistiu' });
    expect(cancel.statusCode).toBe(200);
    const product = (await client.get(`/api/catalog/products/${soda.json().id}`)).json();
    expect(product.stockQuantity).toBe(3);
  });
});

describe('gestão de pedidos no painel', () => {
  it('segue o fluxo de status, registra histórico e recusa transições inválidas', async () => {
    const { slug, menu, client } = await openStore();
    const anon = new Client(app);
    const created = await anon.post(
      `/api/public/stores/${slug}/orders`,
      checkout({ items: [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: menu.size300, quantity: 1 }] }] }),
    );
    const board = (await client.get('/api/orders/board')).json();
    const id = board.orders[0].id;

    const skip = await client.patch(`/api/orders/${id}/status`, { status: 'out_for_delivery' });
    expect(skip.statusCode).toBe(409);

    for (const status of ['confirmed', 'preparing', 'ready', 'completed']) {
      const res = await client.patch(`/api/orders/${id}/status`, { status });
      expect(res.statusCode, `${status}: ${res.body}`).toBe(200);
    }
    const detail = (await client.get(`/api/orders/${id}`)).json();
    expect(detail.status).toBe('completed');
    expect(detail.completedAt).toBeTruthy();
    expect(detail.events.filter((e: { type: string }) => e.type === 'status_changed')).toHaveLength(4);
    expect(detail.customer.ordersCount).toBe(1);

    const back = await client.patch(`/api/orders/${id}/status`, { status: 'preparing' });
    expect(back.statusCode).toBe(409);

    // Acompanhamento público não expõe notas internas nem nomes da equipe.
    await client.post(`/api/orders/${id}/notes`, { note: 'Cliente chato, cuidado' });
    const tracking = await anon.get(`/api/public/orders/${created.json().token}`);
    expect(tracking.body).not.toMatch(/chato/);
    expect(tracking.body).not.toMatch(/Dona Maria/);
    expect(tracking.json().timeline.map((t: { status: string }) => t.status)).toEqual(['new', 'confirmed', 'preparing', 'ready', 'completed']);
  });

  it('detecta conflito quando outra pessoa já mudou o status', async () => {
    const { slug, menu, client } = await openStore();
    const anon = new Client(app);
    await anon.post(`/api/public/stores/${slug}/orders`, checkout({ items: [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: menu.size300, quantity: 1 }] }] }));
    const id = (await client.get('/api/orders/board')).json().orders[0].id;
    await client.patch(`/api/orders/${id}/status`, { status: 'confirmed', expectedFrom: 'new' });
    const stale = await client.patch(`/api/orders/${id}/status`, { status: 'canceled', reason: 'x', expectedFrom: 'new' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('status_changed');
  });

  it('lança pedido manual com desconto, edita itens, troca pagamento e duplica', async () => {
    const { menu, client } = await openStore();
    const manual = await client.post('/api/orders', {
      idempotencyKey: randomUUID(),
      channel: 'whatsapp',
      customer: { name: 'Carla', phone: '11 98888-7777' },
      fulfillment: 'delivery',
      address: { street: 'Av. Brasil', number: '100', neighborhood: 'Jardim', city: 'Campinas', state: 'SP' },
      paymentMethod: 'pix',
      discountCents: 500,
      discountReason: 'Cliente fiel',
      items: [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: menu.size500, quantity: 1 }] }],
    });
    expect(manual.statusCode, manual.body).toBe(201);
    const order = manual.json();
    expect(order.status).toBe('confirmed');
    expect(order.channel).toBe('whatsapp');
    expect(order.subtotalCents).toBe(2100);
    expect(order.discountCents).toBe(500);
    expect(order.totalCents).toBe(1600);

    const edited = await client.put(`/api/orders/${order.id}/items`, {
      items: [{ productId: menu.productId, quantity: 2, modifiers: [{ modifierId: menu.size300, quantity: 1 }, { modifierId: menu.granola, quantity: 1 }] }],
      reason: 'Cliente pediu mais um',
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().subtotalCents).toBe(3000);
    expect(edited.json().totalCents).toBe(2500);

    const pay = await client.put(`/api/orders/${order.id}/payment`, { paymentMethod: 'cash', changeForCents: 5000 });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().paymentMethod).toBe('cash');

    const tooBig = await client.post(`/api/orders/${order.id}/discount`, { discountCents: 999999, reason: 'teste' });
    expect(tooBig.statusCode).toBe(422);

    const dup = await client.post(`/api/orders/${order.id}/duplicate`, { idempotencyKey: randomUUID() });
    expect(dup.statusCode, dup.body).toBe(201);
    expect(dup.json().number).toBe(order.number + 1);
    expect(dup.json().duplicatedFromOrderId).toBe(order.id);

    const types = (await client.get(`/api/orders/${order.id}`)).json().events.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['created', 'status_changed', 'discount_applied', 'items_updated', 'payment_method_changed']));
  });

  it('publica eventos em tempo real somente para o estabelecimento dono do pedido', async () => {
    const a = await openStore();
    const b = await openStore();
    const tenantA = a.me.active.tenant.id;
    const tenantB = b.me.active.tenant.id;
    const received: TenantEvent[] = [];
    const leaked: TenantEvent[] = [];
    const offA = app.hub.subscribe(tenantA, (e) => received.push(e));
    const offB = app.hub.subscribe(tenantB, (e) => leaked.push(e));
    const anon = new Client(app);
    await anon.post(`/api/public/stores/${a.slug}/orders`, checkout({ items: [{ productId: a.menu.productId, quantity: 1, modifiers: [{ modifierId: a.menu.size300, quantity: 1 }] }] }));
    await new Promise((r) => setTimeout(r, 300));
    offA();
    offB();
    expect(received.some((e) => e.type === 'order.created')).toBe(true);
    expect(leaked.filter((e) => e.type.startsWith('order.'))).toHaveLength(0);
  });

  it('calcula o dashboard só com pedidos aceitos', async () => {
    const { slug, menu, client } = await openStore();
    const anon = new Client(app);
    const item = [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: menu.size300, quantity: 1 }] }];
    for (let i = 0; i < 3; i++) await anon.post(`/api/public/stores/${slug}/orders`, checkout({ items: item }));
    const ids = (await client.get('/api/orders/board')).json().orders.map((o: { id: string }) => o.id);
    await client.patch(`/api/orders/${ids[0]}/status`, { status: 'confirmed' });
    await client.patch(`/api/orders/${ids[1]}/status`, { status: 'canceled', reason: 'Teste' });
    const dash = (await client.get('/api/dashboard')).json();
    expect(dash.current.orders).toBe(3);
    expect(dash.current.accepted).toBe(1);
    expect(dash.current.canceled).toBe(1);
    expect(dash.current.revenueCents).toBe(1500);
    expect(dash.current.averageTicketCents).toBe(1500);
    expect(dash.current.newCustomers).toBe(1);
    expect(dash.live.new).toBe(1);
    expect(dash.series).toHaveLength(24);
    expect(dash.topProducts[0].name).toBe('Açaí tradicional');
    const sum = dash.series.reduce((s: number, p: { revenueCents: number }) => s + p.revenueCents, 0);
    expect(sum).toBe(1500);
  });
});

describe('integridade no banco', () => {
  it('o banco recusa itens de pedido apontando para produto de outra empresa', async () => {
    const a = await openStore();
    const b = await openStore();
    const anon = new Client(app);
    const res = await anon.post(`/api/public/stores/${a.slug}/orders`, checkout({ items: [{ productId: a.menu.productId, quantity: 1, modifiers: [{ modifierId: a.menu.size300, quantity: 1 }] }] }));
    const { rows } = await app.db.execute<{ id: string; tenant_id: string }>(sql`select id, tenant_id from orders where public_token = ${res.json().token}`);
    const order = rows[0]!;
    await expect(
      app.db.execute(sql`insert into order_items (tenant_id, order_id, product_id, product_name, base_price_cents, unit_price_cents, quantity, total_cents)
        values (${order.tenant_id}, ${order.id}, ${b.menu.productId}, 'x', 1, 1, 1, 1)`),
    ).rejects.toThrow();
    await expect(
      app.db.execute(sql`update orders set total_cents = 1 where id = ${order.id}`),
    ).rejects.toThrow();
  });
});
