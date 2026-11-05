import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  assignCourierSchema,
  courierSchema,
  deliveryProblemSchema,
  deliveryZoneSchema,
  hasAccess,
  type DeliveryStatus,
} from '@balcao/shared';
import { couriers, deliveries, deliveryZones, memberships, orderEvents, orders } from '../../db/schema';
import { audit } from '../../lib/audit';
import { conflict, forbidden, isUniqueViolation, notFound, parse, unprocessable } from '../../lib/errors';
import { requireTenant, tenantCtx, type TenantContext } from '../../plugins/context';
import { publishEvent } from '../../services/events';
import { changeOrderStatus } from '../orders/service';

const idParam = z.object({ id: z.uuid('Identificador inválido') });

export async function deliveryRoutes(app: FastifyInstance) {
  const db = app.db;
  const actor = (ctx: TenantContext) => ({ type: 'user' as const, userId: ctx.user.id, name: ctx.user.name });

  /** Entregador vinculado ao usuário logado (função Entregador só vê as próprias entregas). */
  async function ownCourier(ctx: TenantContext) {
    const [c] = await db
      .select()
      .from(couriers)
      .where(and(eq(couriers.tenantId, ctx.tenantId), eq(couriers.branchId, ctx.branchId), eq(couriers.userId, ctx.user.id)));
    return c ?? null;
  }

  async function loadDelivery(ctx: TenantContext, orderId: string) {
    const [row] = await db
      .select({ delivery: deliveries, order: orders })
      .from(deliveries)
      .innerJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.tenantId, deliveries.tenantId)))
      .where(and(eq(deliveries.tenantId, ctx.tenantId), eq(deliveries.orderId, orderId)));
    if (!row) throw notFound('Entrega não encontrada.');
    if (ctx.role === 'courier') {
      const mine = await ownCourier(ctx);
      if (!mine || row.delivery.courierId !== mine.id) throw forbidden('Esta entrega não está com você.');
    }
    return row;
  }

  // ─── Painel ───

  app.get('/board', { preHandler: requireTenant('delivery', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const mine = ctx.role === 'courier' ? await ownCourier(ctx) : null;
    if (ctx.role === 'courier' && !mine) return { deliveries: [], couriers: [], courierProfile: null };
    const since = new Date(Date.now() - 12 * 3600_000);
    const rows = await db
      .select({ delivery: deliveries, order: orders, courierName: couriers.name, courierPhone: couriers.phone })
      .from(deliveries)
      .innerJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.tenantId, deliveries.tenantId)))
      .leftJoin(couriers, and(eq(couriers.id, deliveries.courierId), eq(couriers.tenantId, deliveries.tenantId)))
      .where(
        and(
          eq(deliveries.tenantId, ctx.tenantId),
          eq(deliveries.branchId, ctx.branchId),
          mine ? eq(deliveries.courierId, mine.id) : undefined,
          or(
            inArray(deliveries.status, ['awaiting_courier', 'assigned', 'out_for_delivery', 'problem']),
            gte(deliveries.updatedAt, since),
          ),
          // Pedidos ainda não aceitos ou aguardando pagamento não entram no painel de entregas.
          sql`${orders.status} not in ('new','awaiting_confirmation')`,
        ),
      )
      .orderBy(asc(orders.createdAt))
      .limit(300);
    const list = await db
      .select()
      .from(couriers)
      .where(and(eq(couriers.tenantId, ctx.tenantId), eq(couriers.branchId, ctx.branchId)))
      .orderBy(asc(couriers.name));
    return {
      deliveries: rows.map((r) => ({
        orderId: r.order.id,
        number: r.order.number,
        orderStatus: r.order.status,
        status: r.delivery.status,
        customerName: r.order.customerName,
        customerPhone: r.order.customerPhone,
        address: r.order.address,
        zoneName: r.delivery.zoneName,
        totalCents: r.order.totalCents,
        paymentMethod: r.order.paymentMethod,
        paymentStatus: r.order.paymentStatus,
        changeForCents: r.order.changeForCents,
        notes: r.order.notes,
        courierId: r.delivery.courierId,
        courierName: r.courierName,
        courierPhone: r.courierPhone,
        problemReason: r.delivery.problemReason,
        createdAt: r.order.createdAt,
        readyAt: r.order.readyAt,
        assignedAt: r.delivery.assignedAt,
        dispatchedAt: r.delivery.dispatchedAt,
        deliveredAt: r.delivery.deliveredAt,
        deliveryTimeMinutes: r.order.deliveryTimeMinutes,
      })),
      couriers: list.map((c) => ({ id: c.id, name: c.name, phone: c.phone, status: c.status, isActive: c.isActive, userId: c.userId })),
      courierProfile: mine ? { id: mine.id, name: mine.name } : null,
    };
  });

  app.post('/orders/:id/assign', { preHandler: requireTenant('delivery', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    if (ctx.role === 'courier') throw forbidden('Quem atribui as entregas é a loja.');
    const { id } = parse(idParam, request.params);
    const { courierId } = parse(assignCourierSchema, request.body);
    const { delivery, order } = await loadDelivery(ctx, id);
    if (['delivered', 'canceled'].includes(delivery.status)) throw conflict('Esta entrega já foi finalizada.');
    let courierName: string | null = null;
    if (courierId) {
      const [c] = await db.select().from(couriers).where(and(eq(couriers.id, courierId), eq(couriers.tenantId, ctx.tenantId), eq(couriers.isActive, true)));
      if (!c) throw unprocessable('Entregador não encontrado ou inativo.');
      courierName = c.name;
    }
    await db.transaction(async (tx) => {
      const status: DeliveryStatus = delivery.status === 'out_for_delivery' ? 'out_for_delivery' : courierId ? 'assigned' : 'awaiting_courier';
      await tx.update(deliveries).set({ courierId, status, assignedAt: courierId ? new Date() : null }).where(eq(deliveries.id, delivery.id));
      await tx.insert(orderEvents).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        type: 'courier_assigned',
        data: { courierId, courierName },
        actorType: 'user',
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
      });
      await publishEvent(tx, ctx.tenantId, { type: 'delivery.updated', orderId: order.id, branchId: order.branchId });
    });
    return { ok: true };
  });

  /** Saída para entrega: move o pedido para "Saiu para entrega" (e avisa o cliente se configurado). */
  app.post('/orders/:id/dispatch', { preHandler: requireTenant('delivery', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { delivery, order } = await loadDelivery(ctx, id);
    if (!delivery.courierId) throw unprocessable('Atribua um entregador antes de despachar.');
    if (order.status !== 'ready') throw conflict('O pedido precisa estar pronto para sair para entrega.');
    await changeOrderStatus(db, { tenantId: ctx.tenantId, orderId: id, to: 'out_for_delivery', reason: null, actor: actor(ctx), expectedFrom: 'ready' }, app.jobs);
    await db.update(couriers).set({ status: 'busy' }).where(eq(couriers.id, delivery.courierId));
    return { ok: true };
  });

  app.post('/orders/:id/delivered', { preHandler: requireTenant('delivery', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { delivery, order } = await loadDelivery(ctx, id);
    if (order.status !== 'out_for_delivery') throw conflict('Só é possível confirmar a entrega de um pedido que saiu para entrega.');
    await changeOrderStatus(db, { tenantId: ctx.tenantId, orderId: id, to: 'completed', reason: null, actor: actor(ctx), expectedFrom: 'out_for_delivery' }, app.jobs);
    if (delivery.courierId) {
      // Fica disponível de novo se não tiver outra entrega em rota.
      const [other] = await db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(and(eq(deliveries.courierId, delivery.courierId), eq(deliveries.status, 'out_for_delivery')))
        .limit(1);
      if (!other) await db.update(couriers).set({ status: 'available' }).where(eq(couriers.id, delivery.courierId));
    }
    return { ok: true };
  });

  app.post('/orders/:id/problem', { preHandler: requireTenant('delivery', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { reason } = parse(deliveryProblemSchema, request.body);
    const { delivery, order } = await loadDelivery(ctx, id);
    if (['delivered', 'canceled'].includes(delivery.status)) throw conflict('Esta entrega já foi finalizada.');
    await db.transaction(async (tx) => {
      await tx.update(deliveries).set({ status: 'problem', problemReason: reason, problemAt: new Date() }).where(eq(deliveries.id, delivery.id));
      await tx.insert(orderEvents).values({
        tenantId: ctx.tenantId,
        orderId: order.id,
        type: 'delivery_problem',
        data: { reason },
        actorType: 'user',
        actorUserId: ctx.user.id,
        actorName: ctx.user.name,
      });
      await publishEvent(tx, ctx.tenantId, { type: 'delivery.updated', orderId: order.id, branchId: order.branchId });
    });
    await audit(db, request, { action: 'delivery.problem', entityType: 'order', entityId: order.id, summary: `Problema na entrega do pedido #${order.number}: ${reason}` });
    return { ok: true };
  });

  app.post('/orders/:id/resolve', { preHandler: requireTenant('delivery', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { delivery, order } = await loadDelivery(ctx, id);
    if (delivery.status !== 'problem') throw conflict('Esta entrega não está com problema registrado.');
    const status: DeliveryStatus = order.status === 'out_for_delivery' ? 'out_for_delivery' : delivery.courierId ? 'assigned' : 'awaiting_courier';
    await db.transaction(async (tx) => {
      await tx.update(deliveries).set({ status, problemReason: null }).where(eq(deliveries.id, delivery.id));
      await publishEvent(tx, ctx.tenantId, { type: 'delivery.updated', orderId: order.id, branchId: order.branchId });
    });
    return { ok: true };
  });

  // ─── Entregadores ───

  app.post('/couriers', { preHandler: requireTenant('delivery', 'manage') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const input = parse(courierSchema, request.body);
    await ensureCourierUser(ctx, input.userId);
    const [row] = await db.insert(couriers).values({ ...input, tenantId: ctx.tenantId, branchId: ctx.branchId }).returning();
    await audit(db, request, { action: 'delivery.courier_created', entityType: 'courier', entityId: row!.id, summary: `Entregador ${row!.name} cadastrado` });
    return reply.status(201).send(row);
  });

  app.put('/couriers/:id', { preHandler: requireTenant('delivery', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(courierSchema, request.body);
    await ensureCourierUser(ctx, input.userId);
    const [row] = await db
      .update(couriers)
      .set({ ...input, status: input.isActive ? undefined : 'offline' })
      .where(and(eq(couriers.id, id), eq(couriers.tenantId, ctx.tenantId)))
      .returning();
    if (!row) throw notFound('Entregador não encontrado.');
    return row;
  });

  app.patch('/couriers/:id/status', { preHandler: requireTenant('delivery', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { status } = parse(z.object({ status: z.enum(['available', 'busy', 'offline']) }), request.body);
    if (ctx.role === 'courier') {
      const mine = await ownCourier(ctx);
      if (!mine || mine.id !== id) throw forbidden();
    }
    const [row] = await db.update(couriers).set({ status }).where(and(eq(couriers.id, id), eq(couriers.tenantId, ctx.tenantId))).returning();
    if (!row) throw notFound('Entregador não encontrado.');
    return row;
  });

  app.get('/couriers/:id/history', { preHandler: requireTenant('delivery', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    if (ctx.role === 'courier') {
      const mine = await ownCourier(ctx);
      if (!mine || mine.id !== id) throw forbidden();
    }
    const rows = await db
      .select({ number: orders.number, customerName: orders.customerName, zoneName: deliveries.zoneName, status: deliveries.status, deliveredAt: deliveries.deliveredAt, dispatchedAt: deliveries.dispatchedAt, totalCents: orders.totalCents })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(and(eq(deliveries.tenantId, ctx.tenantId), eq(deliveries.courierId, id), isNotNull(deliveries.dispatchedAt)))
      .orderBy(desc(deliveries.dispatchedAt))
      .limit(50);
    return { deliveries: rows };
  });

  async function ensureCourierUser(ctx: TenantContext, userId: string | null) {
    if (!userId) return;
    const [m] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)));
    if (!m) throw unprocessable('Esse usuário não faz parte da equipe.');
  }

  // ─── Bairros e taxas ───

  app.get('/zones', { preHandler: requireTenant() }, async (request) => {
    const ctx = tenantCtx(request);
    if (!hasAccess(ctx.permissions, 'delivery', 'view') && !hasAccess(ctx.permissions, 'settings', 'view') && !hasAccess(ctx.permissions, 'orders', 'edit')) throw forbidden();
    return db
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.tenantId, ctx.tenantId), eq(deliveryZones.branchId, ctx.branchId)))
      .orderBy(asc(deliveryZones.name));
  });

  app.post('/zones', { preHandler: requireTenant('delivery', 'manage') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const input = parse(deliveryZoneSchema, request.body);
    try {
      const row = await db.transaction(async (tx) => {
        const [r] = await tx.insert(deliveryZones).values({ ...input, tenantId: ctx.tenantId, branchId: ctx.branchId }).returning();
        await audit(tx, request, { action: 'delivery.zone_created', entityType: 'delivery_zone', entityId: r!.id, summary: `Bairro ${r!.name} (${(r!.feeCents / 100).toFixed(2)})` });
        await publishEvent(tx, ctx.tenantId, { type: 'store.updated' });
        return r!;
      });
      return reply.status(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err, 'delivery_zones_branch_name_key')) throw unprocessable('Esse bairro já está cadastrado.', { name: 'Já cadastrado' });
      throw err;
    }
  });

  app.put('/zones/:id', { preHandler: requireTenant('delivery', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(deliveryZoneSchema, request.body);
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx.update(deliveryZones).set(input).where(and(eq(deliveryZones.id, id), eq(deliveryZones.tenantId, ctx.tenantId))).returning();
        if (!row) throw notFound('Bairro não encontrado.');
        await audit(tx, request, { action: 'delivery.zone_updated', entityType: 'delivery_zone', entityId: id, summary: `Bairro ${row.name} atualizado` });
        await publishEvent(tx, ctx.tenantId, { type: 'store.updated' });
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'delivery_zones_branch_name_key')) throw unprocessable('Esse bairro já está cadastrado.', { name: 'Já cadastrado' });
      throw err;
    }
  });

  app.delete('/zones/:id', { preHandler: requireTenant('delivery', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    await db.transaction(async (tx) => {
      const [row] = await tx.delete(deliveryZones).where(and(eq(deliveryZones.id, id), eq(deliveryZones.tenantId, ctx.tenantId))).returning();
      if (!row) throw notFound('Bairro não encontrado.');
      await audit(tx, request, { action: 'delivery.zone_deleted', entityType: 'delivery_zone', entityId: id, summary: `Bairro ${row.name} removido` });
      await publishEvent(tx, ctx.tenantId, { type: 'store.updated' });
    });
    return { ok: true };
  });
}
