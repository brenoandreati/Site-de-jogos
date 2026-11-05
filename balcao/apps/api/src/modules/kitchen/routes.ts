import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { hasAccess, kitchenStatusSchema } from '@balcao/shared';
import { orders } from '../../db/schema';
import { forbidden, parse } from '../../lib/errors';
import { requireTenant, tenantCtx } from '../../plugins/context';
import { changeOrderStatus, loadItems, serializeOrder } from '../orders/service';

/**
 * Painel de produção: só o que a cozinha precisa (pedidos confirmados, em preparo e recém-prontos)
 * e só as transições da cozinha. Quem tem o módulo Cozinha não precisa de acesso aos Pedidos.
 */
export async function kitchenRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/orders', { preHandler: requireTenant('kitchen', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const active = await db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.branchId, ctx.branchId), inArray(orders.status, ['confirmed', 'preparing'])))
      .orderBy(orders.confirmedAt, orders.createdAt)
      .limit(200);
    const recentReady = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, ctx.tenantId),
          eq(orders.branchId, ctx.branchId),
          inArray(orders.status, ['ready', 'out_for_delivery', 'completed']),
          gte(orders.readyAt, new Date(Date.now() - 30 * 60_000)),
        ),
      )
      .orderBy(desc(orders.readyAt))
      .limit(30);
    const all = [...active, ...recentReady];
    const items = await loadItems(db, ctx.tenantId, all.map((o) => o.id));
    // A cozinha não precisa ver pagamento nem telefone do cliente.
    return {
      serverTime: new Date(),
      orders: all.map((o) => {
        const s = serializeOrder(o, items.get(o.id) ?? []);
        return {
          id: s.id,
          number: s.number,
          status: s.status,
          fulfillment: s.fulfillment,
          customerName: s.customerName.split(' ')[0],
          tableNumber: s.tableNumber,
          notes: s.notes,
          prepTimeMinutes: s.prepTimeMinutes,
          createdAt: s.createdAt,
          confirmedAt: s.confirmedAt,
          preparingAt: s.preparingAt,
          readyAt: s.readyAt,
          items: s.items.map((i) => ({ id: i.id, productName: i.productName, quantity: i.quantity, notes: i.notes, modifiers: i.modifiers.map((m) => ({ name: m.name, quantity: m.quantity, groupName: m.groupName })) })),
        };
      }),
    };
  });

  app.patch('/orders/:id', { preHandler: requireTenant('kitchen', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const input = parse(kitchenStatusSchema, request.body);
    if (!hasAccess(ctx.permissions, 'kitchen', 'edit')) throw forbidden();
    const order = await changeOrderStatus(
      db,
      { tenantId: ctx.tenantId, orderId: id, to: input.status, reason: null, actor: { type: 'user', userId: ctx.user.id, name: ctx.user.name }, expectedFrom: input.expectedFrom },
      app.jobs,
    );
    return { id: order.id, status: order.status };
  });
}
