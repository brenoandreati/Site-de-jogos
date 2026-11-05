import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  conversationActionSchema,
  customerProfileSchema,
  hasAccess,
  internalNoteSchema,
  quickReplySchema,
  sendMessageSchema,
} from '@balcao/shared';
import { conversations, customerAddresses, customers, memberships, messages, orders, quickReplies, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { AppError, forbidden, notFound, parse, unprocessable } from '../../lib/errors';
import { requireTenant, tenantCtx } from '../../plugins/context';
import { publishEvent } from '../../services/events';
import { ProviderError } from '../../integrations/http';
import { findIntegration, whatsappClient } from '../integrations/service';
import { aiEnabledFor, handoffToHuman, recentMessages, sendOutbound, windowOpen } from './service';

const idParam = z.object({ id: z.uuid('Identificador inválido') });
const FILTERS = ['all', 'unread', 'waiting', 'open', 'ai', 'human', 'closed', 'mine'] as const;

export async function inboxRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/conversations', { preHandler: requireTenant('inbox', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const q = parse(
      z.object({ filter: z.enum(FILTERS).default('all'), search: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }),
      request.query,
    );
    const where: SQL[] = [eq(conversations.tenantId, ctx.tenantId)];
    if (q.filter === 'unread') where.push(sql`${conversations.unreadCount} > 0`);
    if (q.filter === 'waiting') where.push(eq(conversations.status, 'waiting'));
    if (q.filter === 'open') where.push(eq(conversations.status, 'open'));
    if (q.filter === 'ai') where.push(and(eq(conversations.mode, 'ai'), sql`${conversations.status} <> 'closed'`)!);
    if (q.filter === 'human') where.push(and(eq(conversations.mode, 'human'), sql`${conversations.status} <> 'closed'`)!);
    if (q.filter === 'closed') where.push(eq(conversations.status, 'closed'));
    if (q.filter === 'mine') where.push(eq(conversations.assignedUserId, ctx.user.id));
    if (q.search) {
      const term = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
      where.push(or(ilike(customers.name, term), ilike(conversations.contactName, term), ilike(conversations.contactId, `%${q.search.replace(/\D/g, '') || '§'}%`))!);
    }
    const rows = await db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        contactName: conversations.contactName,
        customerName: customers.name,
        customerPhone: customers.phone,
        status: conversations.status,
        mode: conversations.mode,
        unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt,
        lastInboundAt: conversations.lastInboundAt,
        lastMessagePreview: conversations.lastMessagePreview,
        handoffReason: conversations.handoffReason,
        assignedUserId: conversations.assignedUserId,
        assignedUserName: users.name,
      })
      .from(conversations)
      .leftJoin(customers, and(eq(customers.id, conversations.customerId), eq(customers.tenantId, conversations.tenantId)))
      .leftJoin(users, eq(users.id, conversations.assignedUserId))
      .where(and(...where))
      .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
      .limit(q.limit);

    const [counts] = await db
      .select({
        unread: sql<number>`count(*) filter (where ${conversations.unreadCount} > 0)::int`,
        waiting: sql<number>`count(*) filter (where ${conversations.status} = 'waiting')::int`,
        ai: sql<number>`count(*) filter (where ${conversations.mode} = 'ai' and ${conversations.status} <> 'closed')::int`,
      })
      .from(conversations)
      .where(eq(conversations.tenantId, ctx.tenantId));
    const wa = await findIntegration(db, ctx.tenantId, 'whatsapp_cloud');
    const ai = await aiEnabledFor(app, ctx.tenantId);
    return {
      conversations: rows.map((r) => ({ ...r, windowOpen: windowOpen(r) })),
      counts,
      whatsapp: wa ? { status: wa.status, displayPhoneNumber: (wa.config as { displayPhoneNumber?: string }).displayPhoneNumber ?? null, lastError: wa.lastError } : null,
      aiEnabled: ai.enabled,
    };
  });

  app.get('/conversations/:id', { preHandler: requireTenant('inbox', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const [conv] = await db
      .select({ conversation: conversations, assignedUserName: users.name })
      .from(conversations)
      .leftJoin(users, eq(users.id, conversations.assignedUserId))
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));
    if (!conv) throw notFound('Conversa não encontrada.');
    const c = conv.conversation;
    const history = await recentMessages(db, ctx.tenantId, id, 300);

    let customer = null;
    if (c.customerId) {
      const [cu] = await db.select().from(customers).where(and(eq(customers.id, c.customerId), eq(customers.tenantId, ctx.tenantId)));
      if (cu) {
        const [stats] = await db
          .select({ count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::bigint`.mapWith(Number) })
          .from(orders)
          .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.customerId, cu.id), sql`${orders.status} <> 'canceled'`));
        const recent = await db
          .select({ id: orders.id, number: orders.number, status: orders.status, totalCents: orders.totalCents, createdAt: orders.createdAt })
          .from(orders)
          .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.customerId, cu.id)))
          .orderBy(desc(orders.createdAt))
          .limit(10);
        const [address] = await db
          .select()
          .from(customerAddresses)
          .where(and(eq(customerAddresses.tenantId, ctx.tenantId), eq(customerAddresses.customerId, cu.id)))
          .orderBy(desc(customerAddresses.lastUsedAt))
          .limit(1);
        customer = {
          id: cu.id,
          name: cu.name,
          phone: cu.phone,
          email: cu.email,
          notes: cu.notes,
          tags: cu.tags,
          createdAt: cu.createdAt,
          marketingOptIn: !!cu.marketingOptInAt,
          ordersCount: stats?.count ?? 0,
          totalSpentCents: stats?.total ?? 0,
          averageTicketCents: stats && stats.count ? Math.round(stats.total / stats.count) : 0,
          lastOrderAt: recent[0]?.createdAt ?? null,
          recentOrders: recent,
          address: address ?? null,
        };
      }
    }
    // Quem pode ser responsável pela conversa.
    const team = await db
      .select({ id: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, 'active')))
      .orderBy(asc(users.name));

    return {
      conversation: { ...c, aiDraft: undefined, assignedUserName: conv.assignedUserName, windowOpen: windowOpen(c) },
      messages: history.map(serializeMessage),
      customer,
      team,
    };
  });

  app.post('/conversations/:id/read', { preHandler: requireTenant('inbox', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    await db.transaction(async (tx) => {
      await tx.update(conversations).set({ unreadCount: 0 }).where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));
      await publishEvent(tx, ctx.tenantId, { type: 'conversation.updated', conversationId: id, reason: 'read' });
    });
    return { ok: true };
  });

  app.post('/conversations/:id/messages', { preHandler: requireTenant('inbox', 'edit'), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(sendMessageSchema, request.body);
    const message = await sendOutbound(app, {
      tenantId: ctx.tenantId,
      conversationId: id,
      sender: 'user',
      userId: ctx.user.id,
      senderName: ctx.user.name,
      text: input.text,
      imageUrl: input.imageUrl,
    });
    return reply.status(message.status === 'failed' ? 502 : 201).send(
      message.status === 'failed'
        ? { error: { code: 'send_failed', message: `A WhatsApp não aceitou a mensagem: ${message.error}` }, message: serializeMessage(message) }
        : serializeMessage(message),
    );
  });

  app.post('/conversations/:id/notes', { preHandler: requireTenant('inbox', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { text } = parse(internalNoteSchema, request.body);
    const msg = await db.transaction(async (tx) => {
      const [conv] = await tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));
      if (!conv) throw notFound('Conversa não encontrada.');
      const [row] = await tx
        .insert(messages)
        .values({ tenantId: ctx.tenantId, conversationId: id, direction: 'internal', sender: 'user', senderUserId: ctx.user.id, senderName: ctx.user.name, type: 'text', body: text, status: 'sent' })
        .returning();
      await publishEvent(tx, ctx.tenantId, { type: 'conversation.updated', conversationId: id, reason: 'message' });
      return row!;
    });
    return reply.status(201).send(serializeMessage(msg));
  });

  app.patch('/conversations/:id', { preHandler: requireTenant('inbox', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(conversationActionSchema, request.body);
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));
    if (!conv) throw notFound('Conversa não encontrada.');

    if (input.action === 'to_human') {
      await handoffToHuman(app, ctx.tenantId, id, input.reason ?? `Transferida por ${ctx.user.name}`);
    } else {
      let set: Partial<typeof conversations.$inferInsert> = {};
      let note: string | null = null;
      if (input.action === 'assign_me') {
        set = { assignedUserId: ctx.user.id, mode: 'human', status: 'open', closedAt: null };
        note = `${ctx.user.name} assumiu o atendimento`;
      } else if (input.action === 'transfer_user') {
        const [member] = await db
          .select({ name: users.name })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, input.userId), eq(memberships.status, 'active')));
        if (!member) throw unprocessable('Essa pessoa não faz parte da equipe.');
        set = { assignedUserId: input.userId, mode: 'human', status: 'open' };
        note = `${ctx.user.name} transferiu para ${member.name}`;
      } else if (input.action === 'to_ai') {
        const ai = await aiEnabledFor(app, ctx.tenantId);
        if (!ai.enabled) throw unprocessable('O assistente de IA não está ativo. Ative em Assistente de IA.');
        set = { mode: 'ai', status: 'open', assignedUserId: null, handoffReason: null };
        note = `${ctx.user.name} devolveu a conversa para a assistente virtual`;
      } else if (input.action === 'close') {
        set = { status: 'closed', closedAt: new Date(), unreadCount: 0 };
        note = `${ctx.user.name} encerrou o atendimento`;
      } else if (input.action === 'reopen') {
        set = { status: 'open', closedAt: null };
        note = `${ctx.user.name} reabriu o atendimento`;
      }
      await db.transaction(async (tx) => {
        await tx.update(conversations).set(set).where(eq(conversations.id, id));
        if (note) {
          await tx.insert(messages).values({ tenantId: ctx.tenantId, conversationId: id, direction: 'internal', sender: 'system', type: 'text', body: note, status: 'sent' });
        }
        await publishEvent(tx, ctx.tenantId, { type: 'conversation.updated', conversationId: id, reason: 'status' });
      });
    }
    return { ok: true };
  });

  /** Mídia recebida: baixada da Meta com o token da loja (a URL da Meta é temporária e protegida). */
  app.get('/messages/:id/media', { preHandler: requireTenant('inbox', 'view') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const [msg] = await db.select().from(messages).where(and(eq(messages.id, id), eq(messages.tenantId, ctx.tenantId)));
    if (!msg?.mediaId) throw notFound('Mídia não encontrada.');
    const integration = await findIntegration(db, ctx.tenantId, 'whatsapp_cloud');
    if (!integration) throw new AppError(409, 'whatsapp_not_connected', 'WhatsApp não conectado.');
    try {
      const { data, mime } = await whatsappClient(app, integration).client.downloadMedia(msg.mediaId);
      return reply.header('content-type', mime).header('cache-control', 'private, max-age=3600').send(data);
    } catch (err) {
      if (err instanceof ProviderError) throw new AppError(502, 'media_unavailable', 'A WhatsApp não liberou o arquivo (mídias expiram depois de alguns dias).');
      throw err;
    }
  });

  app.put('/customers/:id', { preHandler: requireTenant('inbox', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(customerProfileSchema, request.body);
    const tags = [...new Set(input.tags.map((t) => t.toLowerCase()))];
    const [row] = await db
      .update(customers)
      .set({ name: input.name, notes: input.notes, tags })
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
      .returning();
    if (!row) throw notFound('Cliente não encontrado.');
    await audit(db, request, { action: 'customer.updated', entityType: 'customer', entityId: id, summary: `Ficha de ${row.name} atualizada` });
    return { id: row.id, name: row.name, notes: row.notes, tags: row.tags };
  });

  // ─── Respostas rápidas ───

  app.get('/quick-replies', { preHandler: requireTenant('inbox', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    return db.select().from(quickReplies).where(eq(quickReplies.tenantId, ctx.tenantId)).orderBy(asc(quickReplies.title));
  });

  app.post('/quick-replies', { preHandler: requireTenant('inbox', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const input = parse(quickReplySchema, request.body);
    const [row] = await db.insert(quickReplies).values({ ...input, tenantId: ctx.tenantId }).returning();
    return reply.status(201).send(row);
  });

  app.put('/quick-replies/:id', { preHandler: requireTenant('inbox', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(quickReplySchema, request.body);
    const [row] = await db.update(quickReplies).set(input).where(and(eq(quickReplies.id, id), eq(quickReplies.tenantId, ctx.tenantId))).returning();
    if (!row) throw notFound('Resposta rápida não encontrada.');
    return row;
  });

  app.delete('/quick-replies/:id', { preHandler: requireTenant('inbox', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    if (!hasAccess(ctx.permissions, 'inbox', 'edit')) throw forbidden();
    const { id } = parse(idParam, request.params);
    const rows = await db.delete(quickReplies).where(and(eq(quickReplies.id, id), eq(quickReplies.tenantId, ctx.tenantId))).returning({ id: quickReplies.id });
    if (!rows.length) throw notFound('Resposta rápida não encontrada.');
    return { ok: true };
  });
}

export function serializeMessage(m: typeof messages.$inferSelect) {
  return {
    id: m.id,
    direction: m.direction,
    sender: m.sender,
    senderName: m.senderName,
    type: m.type,
    body: m.body,
    hasMedia: !!m.mediaId,
    mediaUrl: m.mediaUrl,
    mediaMime: m.mediaMime,
    templateName: m.templateName,
    status: m.status,
    error: m.error,
    createdAt: m.createdAt,
    statusAt: m.statusAt,
  };
}
