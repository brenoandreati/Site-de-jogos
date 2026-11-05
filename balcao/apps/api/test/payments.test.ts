import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { ALWAYS_OPEN, Client, FakeHttp, checkout, createTestApp, seedMenu, signupOwner } from './helpers';
import { payments } from '../src/db/schema';

let app: FastifyInstance;
const http = new FakeHttp();
let mpSeq = 5000;
/** Situação que o "Mercado Pago" devolve na consulta de cada pagamento. */
const mpState = new Map<string, { status: string; amount: number; refunded?: number; externalReference: string }>();
const WEBHOOK_SECRET = 'assinatura-secreta-do-webhook-de-teste';

beforeAll(async () => {
  http
    .on('GET', /api\.mercadopago\.com\/users\/me$/, () => ({ body: { id: 123456, nickname: 'LOJATESTE', site_id: 'MLB' } }))
    .on('POST', /api\.mercadopago\.com\/v1\/payments$/, (body) => {
      const b = body as { transaction_amount: number; external_reference: string; date_of_expiration: string };
      const id = String(++mpSeq);
      mpState.set(id, { status: 'pending', amount: b.transaction_amount, externalReference: b.external_reference });
      return {
        status: 201,
        body: {
          id: Number(id),
          status: 'pending',
          status_detail: 'pending_waiting_transfer',
          transaction_amount: b.transaction_amount,
          external_reference: b.external_reference,
          date_of_expiration: b.date_of_expiration,
          point_of_interaction: { transaction_data: { qr_code: `00020126PIX-COPIA-E-COLA-${id}`, qr_code_base64: 'iVBORw0KGgo=', ticket_url: `https://mp.test/ticket/${id}` } },
        },
      };
    })
    .on('GET', /api\.mercadopago\.com\/v1\/payments\/\d+$/, (_b, url) => {
      const id = url.split('/').pop()!;
      const st = mpState.get(id)!;
      return {
        body: {
          id: Number(id),
          status: st.status,
          transaction_amount: st.amount,
          transaction_amount_refunded: st.refunded ?? 0,
          external_reference: st.externalReference,
          date_approved: st.status === 'approved' ? new Date().toISOString() : null,
        },
      };
    })
    .on('PUT', /api\.mercadopago\.com\/v1\/payments\/\d+$/, (_b, url) => {
      const id = url.split('/').pop()!;
      const st = mpState.get(id)!;
      st.status = 'cancelled';
      return { body: { id: Number(id), status: 'cancelled', transaction_amount: st.amount, external_reference: st.externalReference } };
    })
    .on('POST', /api\.mercadopago\.com\/v1\/payments\/\d+\/refunds$/, (_b, url) => {
      const id = url.split('/').at(-2)!;
      const st = mpState.get(id)!;
      st.status = 'refunded';
      st.refunded = st.amount;
      return { status: 201, body: { id: 1, status: 'approved', amount: st.amount } };
    });
  ({ app } = await createTestApp({ http: http.fetch }));
});
afterAll(async () => {
  await app.close();
});

function signed(integrationId: string, dataId: string, secret = WEBHOOK_SECRET) {
  const ts = String(Date.now());
  const requestId = `req-${Math.random().toString(36).slice(2)}`;
  const v1 = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return app.inject({
    method: 'POST',
    url: `/api/webhooks/mercadopago/${integrationId}?data.id=${dataId}&type=payment`,
    payload: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: dataId } }),
    headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
  });
}

async function onlineStore() {
  const owner = await signupOwner(app);
  await owner.client.put('/api/settings/hours', ALWAYS_OPEN);
  const menu = await seedMenu(owner.client);
  const res = await owner.client.post('/api/integrations/mercadopago', { accessToken: 'TEST-1234567890123456-abcdefghijklmnop', webhookSecret: WEBHOOK_SECRET });
  expect(res.statusCode, res.body).toBe(200);
  const integrationId = (await owner.client.get('/api/integrations')).json().mercadopago.id as string;
  return { ...owner, menu, integrationId };
}

const item = (menu: Awaited<ReturnType<typeof seedMenu>>) => [{ productId: menu.productId, quantity: 1, modifiers: [{ modifierId: menu.size300, quantity: 1 }] }];

describe('PIX online (Mercado Pago)', () => {
  it('só oferece pagamento online quando o provedor está conectado', async () => {
    const owner = await signupOwner(app);
    await owner.client.put('/api/settings/hours', ALWAYS_OPEN);
    const menu = await seedMenu(owner.client);
    const pub = (await new Client(app).get(`/api/public/stores/${owner.slug}`)).json();
    expect(pub.store.onlinePayment).toBe(false);
    const res = await new Client(app).post(`/api/public/stores/${owner.slug}/orders`, checkout({ paymentMethod: 'online', items: item(menu) }));
    expect(res.statusCode).toBe(422);
  });

  it('gera o PIX, só confirma com o provedor e então manda o pedido para a loja', async () => {
    const s = await onlineStore();
    expect((await new Client(app).get(`/api/public/stores/${s.slug}`)).json().store.onlinePayment).toBe(true);
    const anon = new Client(app);
    const body = checkout({ paymentMethod: 'online', items: item(s.menu) });
    const res = await anon.post(`/api/public/stores/${s.slug}/orders`, body);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().status).toBe('awaiting_confirmation');
    // Reenvio do mesmo pedido não gera outra cobrança.
    await anon.post(`/api/public/stores/${s.slug}/orders`, body);
    const creates = http.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v1/payments'));
    expect(creates.at(-1)!.headers['x-idempotency-key']).toMatch(/^pix-/);
    expect(new Set(creates.map((c) => (c.body as { external_reference: string }).external_reference)).size).toBe(creates.length);

    const t = (await anon.get(`/api/public/orders/${res.json().token}`)).json();
    expect(t.payment.status).toBe('pending');
    expect(t.payment.qrCode).toContain('PIX-COPIA-E-COLA');
    const paymentId = String(mpSeq);

    // Notificação com assinatura falsa é recusada e nada muda.
    expect((await signed(s.integrationId, paymentId, 'segredo-errado')).statusCode).toBe(401);
    // Notificação legítima, mas o pagamento ainda está pendente no provedor: nada muda.
    expect((await signed(s.integrationId, paymentId)).statusCode).toBe(200);
    let order = (await s.client.get('/api/orders/board')).json().orders[0];
    expect(order.status).toBe('awaiting_confirmation');
    expect(order.paymentStatus).toBe('pending');

    // O cliente pagou: o provedor confirma na consulta.
    mpState.get(paymentId)!.status = 'approved';
    expect((await signed(s.integrationId, paymentId)).statusCode).toBe(200);
    expect((await signed(s.integrationId, paymentId)).statusCode).toBe(200); // repetido: idempotente
    order = (await s.client.get(`/api/orders/${order.id}`)).json();
    expect(order.status).toBe('new');
    expect(order.paymentStatus).toBe('paid');
    expect(order.payment.status).toBe('approved');
    expect(order.events.filter((e: { type: string }) => e.type === 'payment_updated')).toHaveLength(1); // pendente → aprovado
    // A equipe não consegue marcar pagamento online manualmente.
    expect((await s.client.put(`/api/orders/${order.id}/payment-status`, { paymentStatus: 'pending' })).statusCode).toBe(422);

    // Estorno: pedido ao provedor; o status oficial vem da consulta.
    const refund = await s.client.post(`/api/orders/${order.id}/refund`, { reason: 'Produto em falta' });
    expect(refund.statusCode, refund.body).toBe(200);
    expect(refund.json().paymentStatus).toBe('refunded');
    expect(refund.json().payment.refundedCents).toBe(1500);
  });

  it('cancela o pedido quando o PIX vence sem pagamento', async () => {
    const s = await onlineStore();
    const res = await new Client(app).post(`/api/public/stores/${s.slug}/orders`, checkout({ paymentMethod: 'online', items: item(s.menu) }));
    const paymentId = String(mpSeq);
    const [p] = await app.db.select().from(payments).where(eq(payments.providerPaymentId, paymentId));
    expect(p!.status).toBe('pending');
    // Simula a passagem do tempo até o vencimento.
    await app.db.execute(sql`update jobs set run_at = now() where type = 'payment_expiry' and status = 'queued'`);
    await app.jobs.drain();
    const t = (await new Client(app).get(`/api/public/orders/${res.json().token}`)).json();
    expect(t.status).toBe('canceled');
    expect(t.cancelReason).toBe('PIX não pago dentro do prazo');
    expect(mpState.get(paymentId)!.status).toBe('cancelled');
  });
});
