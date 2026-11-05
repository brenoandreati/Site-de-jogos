import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ALWAYS_OPEN, Client, checkout, createTestApp, seedMenu, signupOwner, type CapturingMailer } from './helpers';

let app: FastifyInstance;
let mailer: CapturingMailer;

beforeAll(async () => {
  ({ app, mailer } = await createTestApp());
});
afterAll(async () => {
  await app.close();
});

async function store() {
  const owner = await signupOwner(app);
  await owner.client.put('/api/settings/hours', ALWAYS_OPEN);
  const menu = await seedMenu(owner.client);
  return { ...owner, menu };
}

async function staff(owner: Awaited<ReturnType<typeof store>>, role: string) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@teste.com`;
  const invite = await owner.client.post('/api/team', { name: `Pessoa ${role}`, email, role });
  const token = invite.json().inviteUrl.split('/convite/')[1];
  const c = new Client(app);
  await c.post('/api/auth/invites/accept', { token, name: `Pessoa ${role}`, password: 'senha-equipe-123' });
  const me = (await c.get('/api/auth/me')).json();
  return { client: c, userId: me.user.id as string };
}

const address = { street: 'Rua das Gaivotas', number: '120', neighborhood: 'qualquer', city: 'Santos', state: 'SP' };

describe('cozinha', () => {
  it('a cozinha vê os pedidos confirmados e avança só as etapas de preparo', async () => {
    const s = await store();
    const kitchen = await staff(s, 'kitchen');
    const anon = new Client(app);
    await anon.post(`/api/public/stores/${s.slug}/orders`, checkout({ items: [{ productId: s.menu.productId, quantity: 1, modifiers: [{ modifierId: s.menu.size300, quantity: 1 }] }] }));
    const orderId = (await s.client.get('/api/orders/board')).json().orders[0].id;

    // Pedido ainda não confirmado não aparece para a cozinha, e ela não pode confirmá-lo.
    expect((await kitchen.client.get('/api/kitchen/orders')).json().orders).toHaveLength(0);
    expect((await kitchen.client.patch(`/api/kitchen/orders/${orderId}`, { status: 'preparing' })).statusCode).toBe(409);

    await s.client.patch(`/api/orders/${orderId}/status`, { status: 'confirmed' });
    const list = (await kitchen.client.get('/api/kitchen/orders')).json().orders;
    expect(list).toHaveLength(1);
    expect(list[0].items[0].modifiers[0].name).toBe('300 ml');
    expect(JSON.stringify(list)).not.toContain('5521998765432'); // sem telefone do cliente

    expect((await kitchen.client.patch(`/api/kitchen/orders/${orderId}`, { status: 'preparing', expectedFrom: 'confirmed' })).statusCode).toBe(200);
    expect((await kitchen.client.patch(`/api/kitchen/orders/${orderId}`, { status: 'ready' })).statusCode).toBe(200);
    // Cozinha não cancela pedidos.
    expect((await kitchen.client.patch(`/api/orders/${orderId}/status`, { status: 'canceled', reason: 'x' })).statusCode).toBe(403);
    const detail = (await s.client.get(`/api/orders/${orderId}`)).json();
    expect(detail.status).toBe('ready');
    expect(detail.events.filter((e: { actorName: string }) => e.actorName === 'Pessoa kitchen')).toHaveLength(2);
  });
});

describe('entregas', () => {
  it('cobra a taxa do bairro, exige bairro atendido e respeita o mínimo do bairro', async () => {
    const s = await store();
    const centro = await s.client.post('/api/delivery/zones', { name: 'Centro', feeCents: 500, etaMinutes: 20 });
    const gonzaga = await s.client.post('/api/delivery/zones', { name: 'Gonzaga', feeCents: 800, minOrderCents: 2000, etaMinutes: 35 });
    expect(centro.statusCode).toBe(201);
    expect((await s.client.post('/api/delivery/zones', { name: 'centro', feeCents: 100 })).statusCode).toBe(422);

    const pub = (await new Client(app).get(`/api/public/stores/${s.slug}`)).json();
    expect(pub.store.deliveryZones.map((z: { name: string }) => z.name)).toEqual(['Centro', 'Gonzaga']);

    const anon = new Client(app);
    const item = [{ productId: s.menu.productId, quantity: 1, modifiers: [{ modifierId: s.menu.size300, quantity: 1 }] }];
    const noZone = await anon.post(`/api/public/stores/${s.slug}/orders`, checkout({ items: item, fulfillment: 'delivery', address }));
    expect(noZone.json().error.code).toBe('zone_required');
    const belowMin = await anon.post(`/api/public/stores/${s.slug}/orders`, checkout({ items: item, fulfillment: 'delivery', address, deliveryZoneId: gonzaga.json().id }));
    expect(belowMin.json().error.code).toBe('min_order');

    const ok = await anon.post(`/api/public/stores/${s.slug}/orders`, checkout({ items: [{ ...item[0]!, quantity: 2 }], fulfillment: 'delivery', address, deliveryZoneId: gonzaga.json().id }));
    expect(ok.statusCode, ok.body).toBe(201);
    const t = (await anon.get(`/api/public/orders/${ok.json().token}`)).json();
    expect(t.deliveryFeeCents).toBe(800);
    expect(t.address.neighborhood).toBe('Gonzaga');
    expect(t.deliveryTimeMinutes).toBe(35);
  });

  it('atribui entregador, despacha só pedido pronto e conclui o pedido ao entregar', async () => {
    const s = await store();
    const zone = (await s.client.post('/api/delivery/zones', { name: 'Centro', feeCents: 500 })).json();
    const courierUser = await staff(s, 'courier');
    const courier = await s.client.post('/api/delivery/couriers', { name: 'Marcos', phone: '13991112222', userId: courierUser.userId });
    expect(courier.statusCode, courier.body).toBe(201);
    const other = (await s.client.post('/api/delivery/couriers', { name: 'Lia', phone: '13993334444' })).json();

    const anon = new Client(app);
    const item = [{ productId: s.menu.productId, quantity: 1, modifiers: [{ modifierId: s.menu.size300, quantity: 1 }] }];
    await anon.post(`/api/public/stores/${s.slug}/orders`, checkout({ items: item, fulfillment: 'delivery', address, deliveryZoneId: zone.id }));
    await anon.post(`/api/public/stores/${s.slug}/orders`, checkout({ items: item, fulfillment: 'delivery', address, deliveryZoneId: zone.id }));
    const [a, b] = (await s.client.get('/api/orders/board')).json().orders.map((o: { id: string }) => o.id);

    // Pedidos não aceitos ainda não aparecem no painel de entregas.
    expect((await s.client.get('/api/delivery/board')).json().deliveries).toHaveLength(0);
    await s.client.patch(`/api/orders/${a}/status`, { status: 'confirmed' });
    await s.client.patch(`/api/orders/${b}/status`, { status: 'confirmed' });
    let board = (await s.client.get('/api/delivery/board')).json();
    expect(board.deliveries.map((d: { status: string }) => d.status)).toEqual(['awaiting_courier', 'awaiting_courier']);

    expect((await s.client.post(`/api/delivery/orders/${a}/dispatch`)).statusCode).toBe(422); // sem entregador
    await s.client.post(`/api/delivery/orders/${a}/assign`, { courierId: courier.json().id });
    await s.client.post(`/api/delivery/orders/${b}/assign`, { courierId: other.id });
    expect((await s.client.post(`/api/delivery/orders/${a}/dispatch`)).statusCode).toBe(409); // ainda não está pronto

    // O entregador só enxerga a própria entrega.
    const mine = (await courierUser.client.get('/api/delivery/board')).json();
    // ...e não recebe os contatos dos outros entregadores.
    expect(mine.couriers.map((c: { name: string }) => c.name)).toEqual(['Marcos']);
    expect(mine.deliveries.map((d: { orderId: string }) => d.orderId)).toEqual([a]);
    expect((await courierUser.client.post(`/api/delivery/orders/${b}/problem`, { reason: 'x y' })).statusCode).toBe(403);
    expect((await courierUser.client.post(`/api/delivery/orders/${a}/assign`, { courierId: null })).statusCode).toBe(403);

    await s.client.patch(`/api/orders/${a}/status`, { status: 'ready' });
    expect((await courierUser.client.post(`/api/delivery/orders/${a}/dispatch`)).statusCode).toBe(200);
    expect((await s.client.get(`/api/orders/${a}`)).json().status).toBe('out_for_delivery');
    expect((await courierUser.client.post(`/api/delivery/orders/${a}/problem`, { reason: 'Cliente não atende o interfone' })).statusCode).toBe(200);
    expect((await courierUser.client.post(`/api/delivery/orders/${a}/resolve`)).statusCode).toBe(200);
    expect((await courierUser.client.post(`/api/delivery/orders/${a}/delivered`)).statusCode).toBe(200);
    const done = (await s.client.get(`/api/orders/${a}`)).json();
    expect(done.status).toBe('completed');
    expect(done.delivery.status).toBe('delivered');
    expect(done.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['courier_assigned', 'delivery_problem']));

    await s.client.patch(`/api/orders/${b}/status`, { status: 'canceled', reason: 'Cliente desistiu' });
    board = (await s.client.get('/api/delivery/board')).json();
    expect(board.deliveries.find((d: { orderId: string }) => d.orderId === b).status).toBe('canceled');
    const history = (await s.client.get(`/api/delivery/couriers/${courier.json().id}/history`)).json();
    expect(history.deliveries).toHaveLength(1);
    void mailer;
  });
});
