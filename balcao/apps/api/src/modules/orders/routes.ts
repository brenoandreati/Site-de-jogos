import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACTIVE_ORDER_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  addOrderNoteSchema,
  applyDiscountSchema,
  changePaymentSchema,
  computeOrderTotals,
  hasAccess,
  listOrdersQuerySchema,
  manualOrderSchema,
  normalizeBrazilianPhone,
  paymentStatusSchema,
  recordNotificationSchema,
  updateOrderItemsSchema,
  updateOrderStatusSchema,
} from '@balcao/shared';
import { customerAddresses, customers, orders } from '../../db/schema';
import { audit } from '../../lib/audit';
import { forbidden, parse, unprocessable } from '../../lib/errors';
import { requireTenant, tenantCtx, type TenantContext } from '../../plugins/context';
import {
  changeOrderStatus,
  createOrder,
  getOrderDetail,
  loadItems,
  mutateOrder,
  serializeOrder,
  updateOrderItems,
  type Actor,
} from './service';

const idParam = z.object({ id: z.uuid('Identificador inválido') });

function userActor(ctx: TenantContext): Actor {
  return { type: 'user', userId: ctx.user.id, name: ctx.user.name };
}

export async function orderRoutes(app: FastifyInstance) {
  const db = app.db;

  /** Quadro operacional: pedidos em andamento + finalizados nas últimas 12 horas. */
  app.get('/board', { preHandler: requireTenant('orders', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const active = await db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.branchId, ctx.branchId), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])))
      .orderBy(orders.createdAt)
      .limit(300);
    const finished = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, ctx.tenantId),
          eq(orders.branchId, ctx.branchId),
          inArray(orders.status, ['completed', 'canceled']),
          gte(orders.updatedAt, since),
        ),
      )
      .orderBy(desc(orders.updatedAt))
      .limit(60);
    const all = [...active, ...finished];
    const items = await loadItems(db, ctx.tenantId, all.map((o) => o.id));
    return {
      serverTime: new Date(),
      orders: all.map((o) => serializeOrder(o, items.get(o.id) ?? [])),
    };
  });

  /** Histórico com filtros e paginação. */
  app.get('/', { preHandler: requireTenant('orders', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const q = parse(listOrdersQuerySchema, request.query);
    const conditions: SQL[] = [eq(orders.tenantId, ctx.tenantId), eq(orders.branchId, ctx.branchId)];
    if (q.status.length) conditions.push(inArray(orders.status, q.status));
    if (q.channel) conditions.push(eq(orders.channel, q.channel));
    if (q.from) conditions.push(gte(orders.createdAt, new Date(q.from)));
    if (q.to) conditions.push(lte(orders.createdAt, new Date(q.to)));
    if (q.search) {
      const term = q.search.replace(/^#/, '');
      const phone = normalizeBrazilianPhone(term);
      const clauses: SQL[] = [ilike(orders.customerName, `%${term.replace(/[%_\\]/g, '\\$&')}%`)];
      if (/^\d{1,9}$/.test(term)) clauses.push(eq(orders.number, Number(term)));
      if (phone) clauses.push(eq(orders.customerPhone, phone));
      else if (/^\d{4,}$/.test(term)) clauses.push(ilike(orders.customerPhone, `%${term}%`));
      conditions.push(or(...clauses)!);
    }
    const where = and(...conditions);
    const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where);
    const rows = await db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const items = await loadItems(db, ctx.tenantId, rows.map((o) => o.id));
    return {
      page: q.page,
      pageSize: q.pageSize,
      total,
      orders: rows.map((o) => serializeOrder(o, items.get(o.id) ?? [])),
    };
  });

  app.get('/:id', { preHandler: requireTenant('orders', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    return getOrderDetail(db, ctx.tenantId, id);
  });

  /** Busca de cliente por telefone para o lançamento manual. */
  app.get('/customers/lookup', { preHandler: requireTenant('orders', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { phone } = parse(z.object({ phone: z.string().max(30) }), request.query);
    const normalized = normalizeBrazilianPhone(phone);
    if (!normalized) return { customer: null };
    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.phone, normalized)));
    if (!customer) return { customer: null };
    const addresses = await db
      .select()
      .from(customerAddresses)
      .where(and(eq(customerAddresses.tenantId, ctx.tenantId), eq(customerAddresses.customerId, customer.id)))
      .orderBy(desc(customerAddresses.lastUsedAt))
      .limit(5);
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        addresses: addresses.map((a) => ({
          zipCode: a.zipCode,
          street: a.street,
          number: a.number,
          complement: a.complement,
          neighborhood: a.neighborhood,
          city: a.city,
          state: a.state,
          reference: a.reference,
        })),
      },
    };
  });

  /** Lançamento manual pela equipe (balcão, telefone, WhatsApp, Instagram). */
  app.post('/', { preHandler: requireTenant('orders', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const input = parse(manualOrderSchema, request.body);
    if (input.discountCents > 0 && !hasAccess(ctx.permissions, 'orders', 'manage')) {
      throw forbidden('Somente quem administra pedidos pode lançar desconto.');
    }
    if (input.deliveryFeeCents !== null && !hasAccess(ctx.permissions, 'orders', 'manage')) {
      throw forbidden('Somente quem administra pedidos pode alterar a taxa de entrega.');
    }
    const { order, created } = await createOrder(db, {
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      idempotencyKey: input.idempotencyKey,
      channel: input.channel,
      fulfillment: input.fulfillment,
      paymentMethod: input.paymentMethod,
      changeForCents: input.changeForCents,
      notes: input.notes,
      tableNumber: input.tableNumber,
      address: input.address,
      customer: input.customer,
      items: input.items,
      discountCents: input.discountCents,
      discountReason: input.discountReason,
      deliveryFeeOverrideCents: input.deliveryFeeCents,
      actor: userActor(ctx),
      enforceStoreRules: false,
    });
    const detail = await getOrderDetail(db, ctx.tenantId, order.id);
    return reply.status(created ? 201 : 200).send(detail);
  });

  app.patch('/:id/status', { preHandler: requireTenant('orders', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(updateOrderStatusSchema, request.body);
    if (input.status === 'canceled' && !hasAccess(ctx.permissions, 'orders', 'manage')) {
      throw forbidden('Somente quem administra pedidos pode cancelar.');
    }
    await changeOrderStatus(db, {
      tenantId: ctx.tenantId,
      orderId: id,
      to: input.status,
      reason: input.reason,
      actor: userActor(ctx),
      expectedFrom: input.expectedFrom,
    });
    if (input.status === 'canceled') {
      await audit(db, request, { action: 'order.canceled', entityType: 'order', entityId: id, summary: `Pedido cancelado: ${input.reason}` });
    }
    return getOrderDetail(db, ctx.tenantId, id);
  });

  app.put('/:id/items', { preHandler: requireTenant('orders', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(updateOrderItemsSchema, request.body);
    await updateOrderItems(db, { tenantId: ctx.tenantId, orderId: id, items: input.items, reason: input.reason, actor: userActor(ctx) });
    return getOrderDetail(db, ctx.tenantId, id);
  });

  app.post('/:id/notes', { preHandler: requireTenant('orders', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { note } = parse(addOrderNoteSchema, request.body);
    await mutateOrder(db, {
      tenantId: ctx.tenantId,
      orderId: id,
      actor: userActor(ctx),
      eventType: 'note_added',
      allowFinal: true,
      apply: () => ({ data: { note } }),
    });
    return getOrderDetail(db, ctx.tenantId, id);
  });

  app.post('/:id/discount', { preHandler: requireTenant('orders', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(applyDiscountSchema, request.body);
    await mutateOrder(db, {
      tenantId: ctx.tenantId,
      orderId: id,
      actor: userActor(ctx),
      eventType: 'discount_applied',
      apply: (order) => {
        if (input.discountCents > order.subtotalCents) {
          throw unprocessable('O desconto não pode ser maior que o valor dos produtos.', { discountCents: 'Maior que o subtotal' });
        }
        const totals = computeOrderTotals({
          items: [{ totalCents: order.subtotalCents }],
          discountCents: input.discountCents,
          deliveryFeeCents: order.deliveryFeeCents,
        });
        return {
          values: {
            discountCents: totals.discountCents,
            discountReason: totals.discountCents > 0 ? input.reason : null,
            totalCents: totals.totalCents,
            changeForCents: order.changeForCents !== null && order.changeForCents < totals.totalCents ? null : order.changeForCents,
          },
          data: { previousDiscountCents: order.discountCents, discountCents: totals.discountCents, reason: input.reason, totalCents: totals.totalCents },
        };
      },
    });
    await audit(db, request, { action: 'order.discount', entityType: 'order', entityId: id, summary: `Desconto de ${input.discountCents} centavos: ${input.reason}` });
    return getOrderDetail(db, ctx.tenantId, id);
  });

  app.put('/:id/payment', { preHandler: requireTenant('orders', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(changePaymentSchema, request.body);
    await mutateOrder(db, {
      tenantId: ctx.tenantId,
      orderId: id,
      actor: userActor(ctx),
      eventType: 'payment_method_changed',
      apply: (order) => {
        if (order.paymentStatus === 'paid') {
          throw unprocessable('O pagamento já foi registrado como recebido. Desfaça o recebimento antes de trocar a forma.');
        }
        if (input.changeForCents !== null && input.changeForCents < order.totalCents) {
          throw unprocessable('O valor para troco deve ser maior que o total do pedido.', { changeForCents: 'Menor que o total' });
        }
        return {
          values: { paymentMethod: input.paymentMethod, changeForCents: input.changeForCents },
          data: {
            from: PAYMENT_METHOD_LABELS[order.paymentMethod],
            to: PAYMENT_METHOD_LABELS[input.paymentMethod],
            changeForCents: input.changeForCents,
          },
        };
      },
    });
    return getOrderDetail(db, ctx.tenantId, id);
  });

  app.put('/:id/payment-status', { preHandler: requireTenant('orders', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(paymentStatusSchema, request.body);
    if (input.paymentStatus === 'refunded' && !hasAccess(ctx.permissions, 'orders', 'manage')) {
      throw forbidden('Somente quem administra pedidos pode registrar estorno.');
    }
    await mutateOrder(db, {
      tenantId: ctx.tenantId,
      orderId: id,
      actor: userActor(ctx),
      eventType: 'payment_status_changed',
      allowFinal: true,
      apply: (order) => {
        if (order.paymentMethod === 'online') {
          throw unprocessable('Pagamentos online são confirmados somente pelo provedor de pagamento.');
        }
        return {
          values: { paymentStatus: input.paymentStatus },
          data: { from: PAYMENT_STATUS_LABELS[order.paymentStatus], to: PAYMENT_STATUS_LABELS[input.paymentStatus] },
        };
      },
    });
    return getOrderDetail(db, ctx.tenantId, id);
  });

  /** Registra que a equipe abriu o WhatsApp com a mensagem de atualização (não confirma envio). */
  app.post('/:id/notified', { preHandler: requireTenant('orders', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { status } = parse(recordNotificationSchema, request.body);
    await mutateOrder(db, {
      tenantId: ctx.tenantId,
      orderId: id,
      actor: userActor(ctx),
      eventType: 'customer_notified',
      allowFinal: true,
      apply: () => ({ data: { status, via: 'whatsapp_link' } }),
    });
    return { ok: true };
  });

  app.post('/:id/printed', { preHandler: requireTenant('orders', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    await mutateOrder(db, {
      tenantId: ctx.tenantId,
      orderId: id,
      actor: userActor(ctx),
      eventType: 'printed',
      allowFinal: true,
      apply: () => ({ data: {} }),
    });
    return { ok: true };
  });

  /** Duplica um pedido como novo lançamento manual, com os preços atuais do cardápio. */
  app.post('/:id/duplicate', { preHandler: requireTenant('orders', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { idempotencyKey } = parse(z.object({ idempotencyKey: z.uuid() }), request.body);
    const source = await getOrderDetail(db, ctx.tenantId, id);
    const items = source.items
      .filter((i) => i.productId)
      .map((i) => ({
        productId: i.productId!,
        quantity: i.quantity,
        notes: i.notes,
        modifiers: i.modifiers.filter((m) => m.modifierId).map((m) => ({ modifierId: m.modifierId!, quantity: m.quantity })),
      }));
    if (items.length === 0) throw unprocessable('Os produtos deste pedido não existem mais no cardápio.');
    const { order, created } = await createOrder(db, {
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      idempotencyKey,
      channel: source.channel === 'menu' ? 'manual' : source.channel,
      fulfillment: source.fulfillment,
      paymentMethod: source.paymentMethod === 'online' ? 'pix' : source.paymentMethod,
      changeForCents: null,
      notes: source.notes,
      tableNumber: source.tableNumber,
      address: source.address,
      customer: { name: source.customerName, phone: source.customerPhone },
      items,
      duplicatedFromOrderId: source.id,
      actor: userActor(ctx),
      enforceStoreRules: false,
    });
    return reply.status(created ? 201 : 200).send(await getOrderDetail(db, ctx.tenantId, order.id));
  });
}
