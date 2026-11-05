import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { ALWAYS_OPEN, FakeHttp, createTestApp, seedMenu, signupOwner } from './helpers';
import type { AiProvider, AiRequest } from '../src/services/ai-provider';

/**
 * Provedor de IA roteirizado: cada passo recebe a requisição real montada pelo sistema
 * (prompt, histórico, resultados de ferramentas) e devolve a resposta que o modelo daria.
 */
class ScriptedAi implements AiProvider {
  readonly model = 'modelo-de-teste';
  requests: AiRequest[] = [];
  private steps: ((req: AiRequest) => Partial<Anthropic.Beta.BetaMessage>)[] = [];
  reset() {
    this.steps = [];
  }
  get pending() {
    return this.steps.length;
  }
  script(...steps: ((req: AiRequest) => Partial<Anthropic.Beta.BetaMessage>)[]) {
    this.steps.push(...steps);
  }
  async createMessage(request: AiRequest) {
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (!step) throw new Error('roteiro da IA acabou');
    return {
      id: `msg_${this.requests.length}`,
      type: 'message',
      role: 'assistant',
      model: this.model,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 800 },
      ...step(request),
    } as Anthropic.Beta.BetaMessage;
  }
}

const text = (t: string) => () => ({ stop_reason: 'end_turn' as const, content: [{ type: 'text', text: t, citations: null }] as never });
const tool = (name: string, input: unknown | ((req: AiRequest) => unknown)) => (req: AiRequest) => ({
  stop_reason: 'tool_use' as const,
  content: [{ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2)}`, name, input: typeof input === 'function' ? (input as (r: AiRequest) => unknown)(req) : input }] as never,
});

function lastToolResult(req: AiRequest): Record<string, unknown> {
  const last = req.messages.at(-1)!;
  const block = (last.content as Anthropic.Beta.BetaToolResultBlockParam[]).find((b) => b.type === 'tool_result')!;
  return JSON.parse(block.content as string);
}

let app: FastifyInstance;
const ai = new ScriptedAi();
const http = new FakeHttp();
let seq = 0;

beforeAll(async () => {
  http
    .on('GET', /graph\.facebook\.com\/v[\d.]+\/\d+\?fields=/, () => ({ body: { id: 'x', display_phone_number: '+55 13 4000-0001', verified_name: 'Loja IA' } }))
    .on('POST', /subscribed_apps$/, () => ({ body: { success: true } }))
    .on('POST', /\/messages$/, () => ({ body: { messages: [{ id: `wamid.ai.${++seq}` }] } }));
  ({ app } = await createTestApp({ http: http.fetch, ai }));
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  ai.reset();
});

/** Executa as tarefas pendentes, inclusive as agendadas para daqui a pouco (a IA espera 1,5 s para juntar mensagens). */
async function drain() {
  await app.db.execute(sql`update jobs set run_at = now() where status = 'queued'`);
  await app.jobs.drain();
}

async function inbound(phoneNumberId: string, from: string, body: string) {
  const raw = JSON.stringify({
    entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: from, profile: { name: 'Rafael' } }], messages: [{ id: `wamid.in.${++seq}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }] } }] }],
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/whatsapp',
    payload: raw,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', 'meta-app-secret-de-teste').update(raw).digest('hex')}` },
  });
  expect(res.statusCode).toBe(200);
}

async function aiStore() {
  const owner = await signupOwner(app);
  await owner.client.put('/api/settings/hours', ALWAYS_OPEN);
  const menu = await seedMenu(owner.client);
  const phoneNumberId = `77${Date.now()}`.slice(0, 15);
  await owner.client.post('/api/integrations/whatsapp', { phoneNumberId, wabaId: '1122334455', accessToken: 'EAAG-token-ia-de-teste-1234567890' });
  const put = await owner.client.put('/api/ai/settings', {
    enabled: true,
    assistantName: 'Lia',
    tone: 'friendly',
    greeting: 'Oi! Aqui é a Lia, do Açaí da Maria.',
    faq: [{ question: 'Aceitam cartão?', answer: 'Sim, na entrega e na retirada.' }],
  });
  expect(put.statusCode, put.body).toBe(200);
  return { ...owner, menu, phoneNumberId };
}

describe('assistente de IA no WhatsApp', () => {
  it('monta o pedido com preços oficiais, pede confirmação e só então registra', async () => {
    const s = await aiStore();
    let draftId = '';
    ai.script(
      tool('montar_pedido', {
        itens: [{ produto_id: s.menu.productId, quantidade: 1, adicionais: [{ opcao_id: s.menu.size500, quantidade: 1 }, { opcao_id: s.menu.nutella, quantidade: 1 }] }],
        tipo_atendimento: 'pickup',
        forma_pagamento: 'cash',
      }),
      (req) => {
        const r = lastToolResult(req);
        draftId = r.rascunho_id as string;
        return text(`Fica assim: 1 Açaí tradicional 500 ml com Nutella, total ${r.total}. Posso confirmar?`)();
      },
    );
    await inbound(s.phoneNumberId, '5513988887777', 'Quero um açaí de 500 com nutella pra retirar, pago em dinheiro');
    await drain();

    // O prompt traz o cardápio real da loja e as regras; a hora e a situação vão no fim.
    const firstReq = ai.requests.at(-2)!;
    expect(firstReq.system[0]!.text).toContain('Açaí tradicional');
    expect(firstReq.system[0]!.text).toContain('R$ 15,00');
    expect(firstReq.system[0]!.text).toContain('Aceitam cartão?');
    expect(firstReq.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(firstReq.messages.at(-1)!.role).toBe('system');
    // O total calculado veio do servidor: 15,00 + 6,00 + 4,50.
    expect(lastToolResult(ai.requests.at(-1)!).total).toBe('R$ 25,50');
    expect(ai.pending).toBe(0);
    expect((http.calls.at(-1)!.body as { text: { body: string } }).text.body).toContain('Posso confirmar?');
    expect((await s.client.get('/api/orders')).json().total).toBe(0); // nada registrado ainda

    ai.script(
      tool('registrar_pedido', () => ({ rascunho_id: draftId, confirmacao_do_cliente: 'Sim, pode confirmar' })),
      (req) => {
        return text(`Pedido #${lastToolResult(req).numero} registrado! Acompanhe: ${lastToolResult(req).link_acompanhamento}`)();
      },
    );
    await inbound(s.phoneNumberId, '5513988887777', 'Sim, pode confirmar');
    await drain();

    const orders = (await s.client.get('/api/orders')).json();
    expect(orders.total).toBe(1);
    const order = orders.orders[0];
    expect(order.channel).toBe('whatsapp');
    expect(order.totalCents).toBe(2550);
    expect(order.customerPhone).toBe('5513988887777');
    const sent = http.callsTo(/\/messages$/).map((c) => (c.body as { text?: { body: string } }).text?.body ?? '');
    expect(sent.some((b) => b.includes(`/${s.slug}/pedido/`))).toBe(true);

    // Repetir o registro do mesmo rascunho não duplica o pedido.
    ai.script(tool('registrar_pedido', () => ({ rascunho_id: draftId, confirmacao_do_cliente: 'sim' })), text('Pronto!'));
    await inbound(s.phoneNumberId, '5513988887777', 'confirma de novo?');
    await drain();
    expect((await s.client.get('/api/orders')).json().total).toBe(1);

    const conv = (await s.client.get('/api/inbox/conversations')).json().conversations[0];
    const detail = (await s.client.get(`/api/inbox/conversations/${conv.id}`)).json();
    expect(detail.messages.some((m: { sender: string; senderName: string }) => m.sender === 'ai' && m.senderName === 'Lia')).toBe(true);
    expect(detail.messages.some((m: { direction: string; body: string }) => m.direction === 'internal' && m.body.includes('registrado pela assistente'))).toBe(true);
    const usage = (await s.client.get('/api/ai/settings')).json().usage30d;
    expect(usage.replies).toBeGreaterThanOrEqual(3);
  });

  it('recusa registrar sem rascunho e devolve o erro da ferramenta para a IA explicar', async () => {
    const s = await aiStore();
    ai.script(tool('registrar_pedido', { rascunho_id: 'inventado', confirmacao_do_cliente: 'sim' }), (req) => {
      expect(lastToolResult(req).erro).toMatch(/Rascunho não encontrado/);
      return text('Antes preciso montar o pedido com você. O que vai querer?')();
    });
    await inbound(s.phoneNumberId, '5513977776666', 'fecha meu pedido aí');
    await drain();
    expect((await s.client.get('/api/orders')).json().total).toBe(0);
  });

  it('transfere para humano por palavra-chave sem chamar a IA, e pela ferramenta quando a IA decide', async () => {
    const s = await aiStore();
    const before = ai.requests.length;
    await inbound(s.phoneNumberId, '5513966665555', 'Quero falar com um ATENDENTE agora');
    await drain();
    expect(ai.requests.length).toBe(before);
    let conv = (await s.client.get('/api/inbox/conversations?filter=waiting')).json().conversations[0];
    expect(conv.mode).toBe('human');
    expect(conv.handoffReason).toContain('atendente');

    ai.script(tool('transferir_para_humano', { motivo: 'refund', detalhe: 'Cliente quer o dinheiro de volta do pedido de ontem' }), text('Entendi. Vou passar para alguém da equipe resolver isso com você.'));
    await inbound(s.phoneNumberId, '5513955554444', 'meu pedido veio errado e quero o dinheiro de volta');
    await drain();
    conv = (await s.client.get('/api/inbox/conversations?filter=waiting')).json().conversations.find((c: { contactId: string }) => c.contactId === '5513955554444');
    expect(conv.handoffReason).toContain('reembolso');
    // Em atendimento humano, novas mensagens não acionam a IA.
    const count = ai.requests.length;
    await inbound(s.phoneNumberId, '5513955554444', 'oi?');
    await drain();
    expect(ai.requests.length).toBe(count);
  });

  it('se a IA continuar fora do ar depois das novas tentativas, a conversa vai para a equipe', async () => {
    const s = await aiStore();
    const overloaded = () => {
      throw new Anthropic.APIError(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers());
    };
    ai.script(overloaded, overloaded, overloaded);
    await inbound(s.phoneNumberId, '5513944443333', 'Boa noite, tem açaí de 700 ml?');
    await drain(); // 1ª tentativa
    let conv = (await s.client.get('/api/inbox/conversations?filter=ai')).json().conversations.find((c: { contactId: string }) => c.contactId === '5513944443333');
    expect(conv.mode).toBe('ai'); // ainda vai tentar de novo
    await drain(); // 2ª
    await drain(); // 3ª e última
    expect(ai.pending).toBe(0);
    conv = (await s.client.get('/api/inbox/conversations?filter=waiting')).json().conversations.find((c: { contactId: string }) => c.contactId === '5513944443333');
    expect(conv.mode).toBe('human');
    expect(conv.handoffReason).toContain('indisponível');
  });

  it('o chat de teste usa a IA com o cardápio atual mas nunca registra pedido', async () => {
    const s = await aiStore();
    let draft = '';
    ai.script(
      tool('montar_pedido', { itens: [{ produto_id: s.menu.productId, quantidade: 2, adicionais: [{ opcao_id: s.menu.size300, quantidade: 1 }] }], tipo_atendimento: 'pickup', forma_pagamento: 'cash' }),
      tool('registrar_pedido', (req: AiRequest) => {
        draft = lastToolResult(req).rascunho_id as string;
        return { rascunho_id: draft, confirmacao_do_cliente: 'sim' };
      }),
      (req) => text(lastToolResult(req).aviso as string)(),
    );
    const res = await s.client.post('/api/ai/test', { messages: [{ role: 'user', text: 'quero 2 açaís de 300' }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().reply).toMatch(/Modo de teste/);
    expect(res.json().toolCalls.map((t: { name: string }) => t.name)).toEqual(['montar_pedido', 'registrar_pedido']);
    expect((await s.client.get('/api/orders')).json().total).toBe(0);
  });
});
