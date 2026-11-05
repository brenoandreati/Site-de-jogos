import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { WHATSAPP_WINDOW_MS, normalizeWhatsAppId, type MessageSender, type MessageType } from '@balcao/shared';
import type { DbExecutor } from '../../db/client';
import { aiSettings, conversations, customers, messages } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { ProviderError } from '../../integrations/http';
import type { WaInboundMessage } from '../../integrations/whatsapp';
import { publishEvent } from '../../services/events';
import { findIntegration, markIntegrationError, whatsappClient, type IntegrationRow } from '../integrations/service';

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export function windowOpen(conv: Pick<ConversationRow, 'lastInboundAt'>, now = Date.now()) {
  return !!conv.lastInboundAt && now - conv.lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
}

function preview(type: MessageType, body: string | null) {
  if (body) return body.slice(0, 140);
  return { image: '📷 Imagem', document: '📄 Documento', audio: '🎤 Áudio', video: '🎬 Vídeo', location: '📍 Localização', template: 'Mensagem automática', text: '', other: 'Mensagem' }[type];
}

export async function upsertCustomer(tx: DbExecutor, tenantId: string, phone: string, name: string | null) {
  const [row] = await tx
    .insert(customers)
    .values({ tenantId, phone, name: name?.trim() || `Cliente ${phone.slice(-4)}` })
    .onConflictDoUpdate({ target: [customers.tenantId, customers.phone], set: { updatedAt: new Date() } })
    .returning({ id: customers.id, name: customers.name });
  return row!;
}

export async function findOrCreateConversation(
  tx: DbExecutor,
  input: { tenantId: string; contactId: string; contactName: string | null; customerId: string | null; mode: 'ai' | 'human' },
) {
  const [existing] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, input.tenantId), eq(conversations.channel, 'whatsapp'), eq(conversations.contactId, input.contactId)));
  if (existing) return existing;
  const [created] = await tx
    .insert(conversations)
    .values({
      tenantId: input.tenantId,
      contactId: input.contactId,
      contactName: input.contactName,
      customerId: input.customerId,
      mode: input.mode,
      status: input.mode === 'human' ? 'waiting' : 'open',
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, input.tenantId), eq(conversations.channel, 'whatsapp'), eq(conversations.contactId, input.contactId)));
  return again!;
}

export async function aiEnabledFor(app: FastifyInstance, tenantId: string) {
  if (!app.ai) return { enabled: false as const, settings: null };
  const [row] = await app.db.select().from(aiSettings).where(eq(aiSettings.tenantId, tenantId));
  const settings = row?.settings as { enabled?: boolean; handoffKeywords?: string[] } | undefined;
  return { enabled: !!settings?.enabled, settings: settings ?? null };
}

function parseInbound(m: WaInboundMessage): { type: MessageType; body: string | null; mediaId: string | null; mediaMime: string | null } {
  switch (m.type) {
    case 'text':
      return { type: 'text', body: m.text?.body ?? '', mediaId: null, mediaMime: null };
    case 'image':
      return { type: 'image', body: m.image?.caption ?? null, mediaId: m.image?.id ?? null, mediaMime: m.image?.mime_type ?? null };
    case 'document':
      return { type: 'document', body: m.document?.caption ?? m.document?.filename ?? null, mediaId: m.document?.id ?? null, mediaMime: m.document?.mime_type ?? null };
    case 'audio':
      return { type: 'audio', body: null, mediaId: m.audio?.id ?? null, mediaMime: m.audio?.mime_type ?? null };
    case 'video':
      return { type: 'video', body: m.video?.caption ?? null, mediaId: m.video?.id ?? null, mediaMime: m.video?.mime_type ?? null };
    case 'location': {
      const l = m.location!;
      return { type: 'location', body: [l.name, l.address, `${l.latitude},${l.longitude}`].filter(Boolean).join(' · '), mediaId: null, mediaMime: null };
    }
    case 'button':
      return { type: 'text', body: m.button?.text ?? '', mediaId: null, mediaMime: null };
    case 'interactive':
      return { type: 'text', body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '', mediaId: null, mediaMime: null };
    default:
      return { type: 'other', body: `[mensagem do tipo ${m.type} não suportada]`, mediaId: null, mediaMime: null };
  }
}

/**
 * Registra uma mensagem recebida pelo webhook. Idempotente: a Meta pode reenviar o mesmo
 * evento, e o id da mensagem (único) impede duplicação.
 */
export async function recordInbound(app: FastifyInstance, integration: IntegrationRow, m: WaInboundMessage, contactName: string | null) {
  const tenantId = integration.tenantId;
  const parsed = parseInbound(m);
  // Horário da Meta (precisão de segundos) vale para a janela de 24 h; a ordem da conversa usa o recebimento.
  const sentAt = new Date(Number(m.timestamp) * 1000 || Date.now());
  const receivedAt = new Date();
  const ai = await aiEnabledFor(app, tenantId);

  return app.db.transaction(async (tx) => {
    const phone = normalizeWhatsAppId(m.from) ?? m.from;
    const customer = await upsertCustomer(tx, tenantId, phone, contactName);
    const conv = await findOrCreateConversation(tx, {
      tenantId,
      contactId: m.from,
      contactName,
      customerId: customer.id,
      mode: ai.enabled ? 'ai' : 'human',
    });
    const [msg] = await tx
      .insert(messages)
      .values({
        tenantId,
        conversationId: conv.id,
        direction: 'inbound',
        sender: 'customer',
        senderName: contactName,
        type: parsed.type,
        body: parsed.body,
        mediaId: parsed.mediaId,
        mediaMime: parsed.mediaMime,
        externalId: m.id,
        status: 'received',
        createdAt: receivedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (!msg) return { duplicate: true as const, conversation: conv, message: null };

    // Conversa encerrada volta a abrir; sem IA ativa, vai para a fila de atendimento humano.
    const mode = conv.status === 'closed' ? (ai.enabled ? 'ai' : 'human') : conv.mode === 'ai' && !ai.enabled ? 'human' : conv.mode;
    const status = mode === 'human' && !conv.assignedUserId ? 'waiting' : conv.status === 'closed' ? 'open' : conv.status;
    const [updated] = await tx
      .update(conversations)
      .set({
        mode,
        status,
        closedAt: null,
        assignedUserId: conv.status === 'closed' ? null : conv.assignedUserId,
        customerId: conv.customerId ?? customer.id,
        contactName: contactName ?? conv.contactName,
        unreadCount: sql`${conversations.unreadCount} + 1`,
        lastInboundAt: sentAt,
        lastMessageAt: receivedAt,
        lastMessagePreview: preview(parsed.type, parsed.body),
      })
      .where(eq(conversations.id, conv.id))
      .returning();
    await publishEvent(tx, tenantId, { type: 'conversation.updated', conversationId: conv.id, reason: status === 'waiting' && conv.status !== 'waiting' ? 'handoff' : 'message' });
    return { duplicate: false as const, conversation: updated!, message: msg, aiSettings: ai.settings };
  });
}

export async function applyStatusUpdate(
  app: FastifyInstance,
  tenantId: string,
  s: { id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; timestamp: string; errors?: { message?: string; title?: string; error_data?: { details?: string } }[] },
) {
  const rank = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4, received: 0 } as const;
  const [msg] = await app.db.select().from(messages).where(and(eq(messages.externalId, s.id), eq(messages.tenantId, tenantId)));
  if (!msg) return;
  // Status podem chegar fora de ordem; nunca regredimos (lida não volta a "entregue").
  if (s.status !== 'failed' && rank[s.status] <= rank[msg.status]) return;
  const error = s.status === 'failed' ? (s.errors?.[0]?.error_data?.details ?? s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? 'Falha na entrega') : null;
  await app.db.transaction(async (tx) => {
    await tx
      .update(messages)
      .set({ status: s.status, statusAt: new Date(Number(s.timestamp) * 1000 || Date.now()), error })
      .where(eq(messages.id, msg.id));
    await publishEvent(tx, tenantId, { type: 'conversation.updated', conversationId: msg.conversationId, reason: 'message' });
  });
}

export interface OutboundInput {
  tenantId: string;
  conversationId: string;
  sender: Exclude<MessageSender, 'customer'>;
  userId?: string | null;
  senderName?: string | null;
  text?: string | null;
  imageUrl?: string | null;
  template?: { name: string; language: string; params: string[]; preview: string };
  /** Em tarefas: erros temporários são relançados (e a mensagem pendente removida) para nova tentativa. */
  retryableErrors?: 'record' | 'throw';
}

export async function sendOutbound(app: FastifyInstance, input: OutboundInput): Promise<MessageRow> {
  const db = app.db;
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, input.tenantId)));
  if (!conv) throw notFound('Conversa não encontrada.');
  const integration = await findIntegration(db, input.tenantId, 'whatsapp_cloud');
  if (!integration) throw new AppError(409, 'whatsapp_not_connected', 'Conecte o WhatsApp da loja em Configurações › Integrações para enviar mensagens.');
  if (!input.template && !windowOpen(conv)) {
    throw new AppError(
      422,
      'window_closed',
      'Já se passaram mais de 24 horas desde a última mensagem do cliente. Pela regra da WhatsApp, só é possível enviar um modelo aprovado até ele responder.',
    );
  }

  const type: MessageType = input.template ? 'template' : input.imageUrl ? 'image' : 'text';
  const body = input.template ? input.template.preview : (input.text ?? null);
  const absoluteImage = input.imageUrl ? (input.imageUrl.startsWith('http') ? input.imageUrl : `${app.config.APP_URL}${input.imageUrl}`) : null;

  const [pending] = await db
    .insert(messages)
    .values({
      tenantId: input.tenantId,
      conversationId: conv.id,
      direction: 'outbound',
      sender: input.sender,
      senderUserId: input.userId ?? null,
      senderName: input.senderName ?? null,
      type,
      body,
      mediaUrl: input.imageUrl ?? null,
      templateName: input.template?.name ?? null,
      status: 'pending',
    })
    .returning();

  const { client } = whatsappClient(app, integration);
  let externalId: string | null = null;
  let error: string | null = null;
  try {
    if (input.template) externalId = await client.sendTemplate(conv.contactId, input.template.name, input.template.language, input.template.params);
    else if (absoluteImage) externalId = await client.sendImage(conv.contactId, absoluteImage, input.text);
    else externalId = await client.sendText(conv.contactId, input.text ?? '');
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.status === 401 || err.status === 403) await markIntegrationError(db, integration.id, `Token recusado pela Meta: ${err.message}`);
      if (err.retryable && input.retryableErrors === 'throw') {
        await db.delete(messages).where(eq(messages.id, pending!.id));
        throw err;
      }
      error = err.message;
    } else {
      throw err;
    }
  }

  const now = new Date();
  const [saved] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(messages)
      .set({ externalId, status: error ? 'failed' : 'sent', error, statusAt: now })
      .where(eq(messages.id, pending!.id))
      .returning();
    await tx
      .update(conversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: preview(type, body),
        ...(input.sender === 'user'
          ? { mode: 'human' as const, status: 'open' as const, assignedUserId: conv.assignedUserId ?? input.userId ?? null, unreadCount: 0 }
          : {}),
      })
      .where(eq(conversations.id, conv.id));
    await publishEvent(tx, input.tenantId, { type: 'conversation.updated', conversationId: conv.id, reason: 'message' });
    return rows;
  });
  return saved!;
}

/** Passa a conversa para a equipe: pausa a IA, avisa o painel e registra o motivo. */
export async function handoffToHuman(app: FastifyInstance, tenantId: string, conversationId: string, reason: string) {
  await app.db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({ mode: 'human', status: 'waiting', assignedUserId: null, handoffReason: reason, handoffAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
    await tx.insert(messages).values({
      tenantId,
      conversationId,
      direction: 'internal',
      sender: 'system',
      type: 'text',
      body: `Transferida para atendimento humano: ${reason}`,
      status: 'sent',
    });
    await publishEvent(tx, tenantId, { type: 'conversation.updated', conversationId, reason: 'handoff' });
  });
}

/** Histórico recente para o painel e para a IA. */
export async function recentMessages(db: DbExecutor, tenantId: string, conversationId: string, limit = 200, before?: Date) {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, conversationId),
        before ? sql`${messages.createdAt} < ${before}` : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function hasNewerInbound(db: DbExecutor, tenantId: string, conversationId: string, after: Date) {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId), eq(messages.direction, 'inbound'), gt(messages.createdAt, after)))
    .limit(1);
  return !!row;
}
