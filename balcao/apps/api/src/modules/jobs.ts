import type { FastifyInstance } from 'fastify';
import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, eq } from 'drizzle-orm';
import { APIError } from '@anthropic-ai/sdk';
import {
  MESSAGE_TEMPLATE_KEYS,
  formatBRL,
  renderTemplate,
  resolveTemplates,
  type MessageTemplateKey,
  type MessageVariables,
} from '@balcao/shared';
import { branches, conversations, customers, messages, orderEvents, orders, tenants } from '../db/schema';
import { ProviderError } from '../integrations/http';
import { PermanentJobError } from '../services/jobs';
import { loadAiSettings, runAgent } from './ai/agent';
import { aiEnabledFor, findOrCreateConversation, handoffToHuman, hasNewerInbound, recentMessages, sendOutbound, windowOpen } from './inbox/service';
import { findIntegration, type WhatsappConfig } from './integrations/service';
import { expirePayment, syncPayment } from './payments/service';

export function registerJobHandlers(app: FastifyInstance) {
  app.jobs.register('notify_order_status', (payload) => notifyOrderStatus(app, payload as never));
  app.jobs.register('ai_reply', async (payload, { job }) => {
    const p = payload as { tenantId: string; conversationId: string; messageId: string };
    try {
      await aiReply(app, p);
    } catch (err) {
      // Provedor fora do ar em todas as tentativas: o cliente não pode ficar sem resposta.
      if (!(err instanceof PermanentJobError) && job.attempts >= job.maxAttempts) {
        await handoffToHuman(app, p.tenantId, p.conversationId, 'A assistente virtual está indisponível no momento');
      }
      throw err;
    }
  });
  app.jobs.register('payment_expiry', async (payload) => {
    const { tenantId, paymentId } = payload as { tenantId: string; paymentId: string };
    await expirePayment(app, tenantId, paymentId);
  });
  // Consulta direta ao provedor enquanto o cliente acompanha o PIX (não depende só do webhook).
  app.jobs.register('payment_sync', async (payload) => {
    const { tenantId, providerPaymentId } = payload as { tenantId: string; providerPaymentId: string };
    await syncPayment(app, tenantId, providerPaymentId);
  });
}

async function primaryBranchId(app: FastifyInstance, tenantId: string) {
  const [b] = await app.db.select({ id: branches.id }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.isPrimary, true)));
  if (!b) throw new PermanentJobError('Loja sem unidade principal');
  return b.id;
}

/** Mensagem automática de status para o cliente pela WhatsApp oficial. */
async function notifyOrderStatus(app: FastifyInstance, p: { tenantId: string; orderId: string; status: string }) {
  if (!(MESSAGE_TEMPLATE_KEYS as readonly string[]).includes(p.status)) return;
  const status = p.status as MessageTemplateKey;
  const integration = await findIntegration(app.db, p.tenantId, 'whatsapp_cloud');
  if (!integration || integration.status === 'disconnected') return;
  const config = integration.config as unknown as WhatsappConfig;
  if (!config.autoNotify?.[status]) return;

  const [order] = await app.db.select().from(orders).where(and(eq(orders.id, p.orderId), eq(orders.tenantId, p.tenantId)));
  if (!order?.customerPhone) return;
  // Se o pedido já avançou (ex.: preparo terminou em segundos), não manda a mensagem velha.
  if (order.status !== status && status !== 'canceled' && status !== 'completed') return;
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, p.tenantId));
  if (!tenant) return;

  let conv = order.customerId
    ? (await app.db.select().from(conversations).where(and(eq(conversations.tenantId, p.tenantId), eq(conversations.customerId, order.customerId))).orderBy(asc(conversations.createdAt)).limit(1))[0]
    : undefined;
  if (!conv) {
    const ai = await aiEnabledFor(app, p.tenantId);
    conv = await findOrCreateConversation(app.db, {
      tenantId: p.tenantId,
      contactId: order.customerPhone,
      contactName: order.customerName,
      customerId: order.customerId,
      mode: ai.enabled ? 'ai' : 'human',
    });
  }

  const [branch] = await app.db.select({ timezone: branches.timezone }).from(branches).where(eq(branches.id, order.branchId));
  const eta = new Date(order.createdAt.getTime() + (order.prepTimeMinutes + order.deliveryTimeMinutes) * 60_000);
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: branch?.timezone ?? 'America/Sao_Paulo' }).format(eta);
  const vars: MessageVariables = {
    cliente: order.customerName.split(' ')[0] ?? order.customerName,
    pedido: order.number,
    loja: tenant.tradeName,
    total: formatBRL(order.totalCents),
    link: `${app.config.APP_URL.replace(/\/$/, '')}/${tenant.slug}/pedido/${order.publicToken}`,
    previsao: `por volta das ${time}`,
  };
  const text = renderTemplate(resolveTemplates(tenant.messageTemplates)[status], vars);
  const template = config.templates?.[status];

  const record = (data: Record<string, unknown>) =>
    app.db.insert(orderEvents).values({ tenantId: p.tenantId, orderId: order.id, type: 'customer_notified', data: { status, via: 'whatsapp_api', ...data }, actorType: 'system', actorName: 'Mensagens automáticas' });

  if (!windowOpen(conv) && !template) {
    await record({ result: 'skipped', reason: 'Fora da janela de 24 h da WhatsApp e sem modelo aprovado configurado para esta etapa' });
    return;
  }
  try {
    const msg = await sendOutbound(app, {
      tenantId: p.tenantId,
      conversationId: conv.id,
      sender: 'system',
      senderName: 'Mensagem automática',
      ...(windowOpen(conv) ? { text } : { template: { name: template!.name, language: template!.language, params: template!.params.map((k) => String(vars[k])), preview: text } }),
      retryableErrors: 'throw',
    });
    await record({ result: msg.status === 'failed' ? 'failed' : 'sent', error: msg.error ?? undefined, messageId: msg.id });
  } catch (err) {
    if (err instanceof ProviderError && err.retryable) throw err;
    await record({ result: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
}

function toPrompt(m: typeof messages.$inferSelect): string {
  if (m.type === 'text' || m.type === 'template') return m.body ?? '';
  const label = { image: 'uma imagem', document: 'um documento', audio: 'um áudio', video: 'um vídeo', location: 'uma localização', other: 'uma mensagem', text: '', template: '' }[m.type];
  return `[cliente enviou ${label}${m.body ? `: ${m.body}` : ''}]`;
}

/** Resposta da atendente virtual para a conversa. */
async function aiReply(app: FastifyInstance, p: { tenantId: string; conversationId: string; messageId: string }) {
  const [conv] = await app.db.select().from(conversations).where(and(eq(conversations.id, p.conversationId), eq(conversations.tenantId, p.tenantId)));
  if (!conv || conv.mode !== 'ai' || conv.status === 'closed') return;
  const [trigger] = await app.db.select().from(messages).where(and(eq(messages.id, p.messageId), eq(messages.tenantId, p.tenantId)));
  if (!trigger) return;
  // Chegou outra mensagem depois desta: a tarefa daquela responde tudo de uma vez.
  if (await hasNewerInbound(app.db, p.tenantId, conv.id, trigger.createdAt)) return;

  const settings = await loadAiSettings(app, p.tenantId);
  if (!settings.enabled || !app.ai) {
    await handoffToHuman(app, p.tenantId, conv.id, 'Assistente virtual desativada');
    return;
  }

  const rows = (await recentMessages(app.db, p.tenantId, conv.id, 40)).filter((m) => m.direction !== 'internal');
  const history: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of rows) {
    const role = m.direction === 'inbound' ? 'user' : 'assistant';
    if (history.length === 0 && role === 'assistant') continue; // a conversa precisa começar pelo cliente
    const content = toPrompt(m);
    if (content) history.push({ role, content });
  }
  if (history.at(-1)?.role !== 'user') return;

  const [customer] = conv.customerId
    ? await app.db.select().from(customers).where(and(eq(customers.id, conv.customerId), eq(customers.tenantId, p.tenantId)))
    : [];
  let result;
  try {
    result = await runAgent(
      {
        app,
        tenantId: p.tenantId,
        branchId: await primaryBranchId(app, p.tenantId),
        mode: 'live',
        conversationId: conv.id,
        customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : { id: null, name: conv.contactName ?? 'Cliente', phone: null },
        settings,
      },
      history,
    );
  } catch (err) {
    if (err instanceof APIError && (err.status === undefined || err.status === 429 || err.status >= 500)) throw err;
    await handoffToHuman(app, p.tenantId, conv.id, 'A assistente virtual teve um erro e não respondeu');
    throw new PermanentJobError(err instanceof Error ? err.message : String(err));
  }

  if (result.text) {
    await sendOutbound(app, { tenantId: p.tenantId, conversationId: conv.id, sender: 'ai', senderName: settings.assistantName, text: result.text, retryableErrors: 'throw' });
  }
  if (result.order) {
    await app.db.insert(messages).values({
      tenantId: p.tenantId,
      conversationId: conv.id,
      direction: 'internal',
      sender: 'system',
      type: 'text',
      body: `Pedido #${result.order.number} registrado pela assistente virtual.`,
      status: 'sent',
    });
  }
  if (result.handoff) await handoffToHuman(app, p.tenantId, conv.id, result.handoff);
}
