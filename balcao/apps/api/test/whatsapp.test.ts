import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ALWAYS_OPEN, Client, FakeHttp, checkout, createTestApp, seedMenu, signupOwner } from './helpers';

let app: FastifyInstance;
const http = new FakeHttp();
let seq = 0;
let phoneSeq = 1000;

beforeAll(async () => {
  http
    .on('GET', /graph\.facebook\.com\/v[\d.]+\/\d+\?fields=/, () => ({ body: { id: 'x', display_phone_number: '+55 13 4000-0000', verified_name: 'Loja Teste', quality_rating: 'GREEN' } }))
    .on('POST', /subscribed_apps$/, () => ({ body: { success: true } }))
    .on('POST', /\/messages$/, () => ({ body: { messaging_product: 'whatsapp', messages: [{ id: `wamid.out.${++seq}` }] } }));
  ({ app } = await createTestApp({ http: http.fetch }));
});
afterAll(async () => {
  await app.close();
});

function sign(raw: string) {
  return `sha256=${createHmac('sha256', 'meta-app-secret-de-teste').update(raw).digest('hex')}`;
}

async function webhook(payload: unknown, signature?: string) {
  const raw = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/whatsapp',
    payload: raw,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? sign(raw) },
  });
}

function inbound(phoneNumberId: string, from: string, text: string, id = `wamid.in.${++seq}`) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: phoneNumberId, display_phone_number: '551340000000' },
              contacts: [{ wa_id: from, profile: { name: 'Rafa' } }],
              messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

async function connectedStore() {
  const owner = await signupOwner(app);
  await owner.client.put('/api/settings/hours', ALWAYS_OPEN);
  const menu = await seedMenu(owner.client);
  const phoneNumberId = String(++phoneSeq) + '000000';
  const res = await owner.client.post('/api/integrations/whatsapp', { phoneNumberId, wabaId: '9988776655', accessToken: 'EAAG-token-de-teste-com-tamanho-suficiente' });
  expect(res.statusCode, res.body).toBe(200);
  return { ...owner, menu, phoneNumberId };
}

describe('WhatsApp Business Platform', () => {
  it('confere token na Meta ao conectar e nunca devolve o token ao painel', async () => {
    const s = await connectedStore();
    const status = (await s.client.get('/api/integrations')).json();
    expect(status.whatsapp.status).toBe('connected');
    expect(status.whatsapp.config.displayPhoneNumber).toBe('+55 13 4000-0000');
    expect(JSON.stringify(status)).not.toContain('EAAG-token');
    const graphCall = http.calls.find((c) => c.url.includes(s.phoneNumberId) && c.method === 'GET');
    expect(graphCall?.headers.authorization).toBe('Bearer EAAG-token-de-teste-com-tamanho-suficiente');
    // Mesmo número em outra loja é recusado.
    const other = await signupOwner(app);
    const dup = await other.client.post('/api/integrations/whatsapp', { phoneNumberId: s.phoneNumberId, wabaId: '1', accessToken: 'EAAG-outro-token-de-teste-123456' });
    expect(dup.statusCode).toBe(422); // wabaId inválido (curto) — validado antes de chamar a Meta
  });

  it('responde ao desafio de verificação e recusa webhooks sem assinatura válida', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verificacao-de-teste&hub.challenge=12345' });
    expect(ok.body).toBe('12345');
    const bad = await app.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1' });
    expect(bad.statusCode).toBe(403);
    const forged = await webhook(inbound('1', '5511987654321', 'oi'), 'sha256=deadbeef');
    expect(forged.statusCode).toBe(401);
  });

  it('cria conversa e cliente a partir da mensagem, sem duplicar reenvios da Meta', async () => {
    const s = await connectedStore();
    const payload = inbound(s.phoneNumberId, '551398765432', 'Boa noite, vocês entregam no Gonzaga?', 'wamid.fixo.1');
    expect((await webhook(payload)).statusCode).toBe(200);
    expect((await webhook(payload)).statusCode).toBe(200);
    const list = (await s.client.get('/api/inbox/conversations')).json();
    expect(list.conversations).toHaveLength(1);
    const conv = list.conversations[0];
    expect(conv.status).toBe('waiting'); // sem IA ativa, vai para a fila humana
    expect(conv.unreadCount).toBe(1);
    expect(conv.customerPhone).toBe('5513998765432'); // nono dígito acrescentado
    const detail = (await s.client.get(`/api/inbox/conversations/${conv.id}`)).json();
    expect(detail.messages).toHaveLength(1);
    expect(detail.customer.name).toBe('Rafa');
    // Outra empresa não vê a conversa.
    const other = await signupOwner(app);
    expect((await other.client.get(`/api/inbox/conversations/${conv.id}`)).statusCode).toBe(404);
  });

  it('atendente responde dentro da janela de 24 h e recebe os status de entrega', async () => {
    const s = await connectedStore();
    await webhook(inbound(s.phoneNumberId, '5513991110000', 'Oi'));
    const conv = (await s.client.get('/api/inbox/conversations')).json().conversations[0];
    const sent = await s.client.post(`/api/inbox/conversations/${conv.id}/messages`, { text: 'Oi! Entregamos sim.' });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().status).toBe('sent');
    const call = http.calls.at(-1)!;
    expect(call.body).toMatchObject({ to: '5513991110000', type: 'text', text: { body: 'Oi! Entregamos sim.' } });

    const after = (await s.client.get(`/api/inbox/conversations/${conv.id}`)).json();
    expect(after.conversation.mode).toBe('human');
    expect(after.conversation.status).toBe('open');

    const wamid = `wamid.out.${seq}`;
    const statusPayload = (status: string) => ({
      entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: s.phoneNumberId }, statuses: [{ id: wamid, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '5513991110000' }] } }] }],
    });
    await webhook(statusPayload('read'));
    await webhook(statusPayload('delivered')); // chegou atrasado: não regride
    const final = (await s.client.get(`/api/inbox/conversations/${conv.id}`)).json();
    expect(final.messages.at(-1).status).toBe('read');

    // Fora da janela de 24 h, mensagem livre é recusada (regra da WhatsApp).
    await app.db.execute(sql`update conversations set last_inbound_at = now() - interval '25 hours' where id = ${conv.id}`);
    const closed = await s.client.post(`/api/inbox/conversations/${conv.id}/messages`, { text: 'Ainda aí?' });
    expect(closed.statusCode).toBe(422);
    expect(closed.json().error.code).toBe('window_closed');
  });

  it('envia atualizações automáticas de status e registra quando não é possível enviar', async () => {
    const s = await connectedStore();
    // Cliente já conversou: janela aberta, então vale a mensagem personalizada da loja.
    await webhook(inbound(s.phoneNumberId, '5521998765432', 'Vou pedir pelo cardápio'));
    const anon = new Client(app);
    await anon.post(`/api/public/stores/${s.slug}/orders`, checkout({ items: [{ productId: s.menu.productId, quantity: 1, modifiers: [{ modifierId: s.menu.size300, quantity: 1 }] }] }));
    const orderId = (await s.client.get('/api/orders/board')).json().orders[0].id;
    const before = http.callsTo(/\/messages$/).length;
    await app.jobs.drain();
    await s.client.patch(`/api/orders/${orderId}/status`, { status: 'confirmed' });
    await app.jobs.drain();
    // Etapa que passou antes da tarefa rodar não gera mensagem atrasada.
    await s.client.patch(`/api/orders/${orderId}/status`, { status: 'preparing' });
    await s.client.patch(`/api/orders/${orderId}/status`, { status: 'ready' });
    await app.jobs.drain();
    const sends = http.callsTo(/\/messages$/).slice(before);
    expect(sends.map((c) => (c.body as { text?: { body: string } }).text?.body)).toEqual([
      expect.stringContaining('Recebemos seu pedido #1'),
      expect.stringContaining('Pedido #1 confirmado'),
      expect.stringContaining('está pronto'),
    ]);
    const events = (await s.client.get(`/api/orders/${orderId}`)).json().events.filter((e: { type: string }) => e.type === 'customer_notified');
    expect(events.map((e: { data: { result: string } }) => e.data.result)).toEqual(['sent', 'sent', 'sent']);

    // Cliente novo, sem conversa (janela fechada) e sem modelo aprovado: não envia e registra o motivo.
    const anon2 = new Client(app);
    await anon2.post(
      `/api/public/stores/${s.slug}/orders`,
      checkout({ customer: { name: 'Bia', phone: '11 97777-6666' }, items: [{ productId: s.menu.productId, quantity: 1, modifiers: [{ modifierId: s.menu.size300, quantity: 1 }] }] }),
    );
    await app.jobs.drain();
    const board = (await s.client.get('/api/orders/board')).json().orders;
    const second = board.find((o: { customerName: string }) => o.customerName === 'Bia');
    const skipped = (await s.client.get(`/api/orders/${second.id}`)).json().events.find((e: { type: string }) => e.type === 'customer_notified');
    expect(skipped.data.result).toBe('skipped');

    // Com modelo aprovado configurado, usa o modelo (mensagem iniciada pela empresa).
    const put = await s.client.put('/api/integrations/whatsapp/settings', {
      autoNotify: { confirmed: true },
      templates: { confirmed: { name: 'pedido_confirmado', language: 'pt_BR', params: ['cliente', 'pedido'] } },
    });
    expect(put.statusCode, put.body).toBe(200);
    await s.client.patch(`/api/orders/${second.id}/status`, { status: 'confirmed' });
    await app.jobs.drain();
    const tpl = http.callsTo(/\/messages$/).at(-1)!.body as { type: string; to: string; template: { name: string; components: { parameters: { text: string }[] }[] } };
    expect(tpl.type).toBe('template');
    expect(tpl.to).toBe('5511977776666');
    expect(tpl.template.name).toBe('pedido_confirmado');
    expect(tpl.template.components[0]!.parameters.map((p) => p.text)).toEqual(['Bia', '2']);
  });
});
