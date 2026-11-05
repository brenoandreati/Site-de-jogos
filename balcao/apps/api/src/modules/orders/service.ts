import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  canTransition,
  computeOrderTotals,
  FULFILLMENT_LABELS,
  getStoreAvailability,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  priceItem,
  type CartItemInput,
  type FulfillmentType,
  type OrderChannel,
  type OrderStatus,
  type PaymentMethod,
  type PricedItem,
} from '@balcao/shared';
import type { Database, DbExecutor } from '../../db/client';
import {
  branches,
  customerAddresses,
  customers,
  openingHours,
  orderEvents,
  orderItemModifiers,
  orderItems,
  orders,
  products,
  type OrderAddress,
} from '../../db/schema';
import { randomToken } from '../../lib/crypto';
import { AppError, conflict, isUniqueViolation, notFound, unprocessable } from '../../lib/errors';
import { publishEvent } from '../../services/events';
import { loadPricingProducts } from '../catalog/service';

export type OrderRow = typeof orders.$inferSelect;

export type Actor =
  | { type: 'customer'; name: string }
  | { type: 'user'; userId: string; name: string }
  | { type: 'system'; name?: string };

function actorFields(actor: Actor) {
  return {
    actorType: actor.type,
    actorUserId: actor.type === 'user' ? actor.userId : null,
    actorName: actor.type === 'system' ? (actor.name ?? 'Sistema') : actor.name,
  } as const;
}

export interface CreateOrderParams {
  tenantId: string;
  branchId: string;
  idempotencyKey: string;
  channel: OrderChannel;
  fulfillment: FulfillmentType;
  paymentMethod: PaymentMethod;
  changeForCents: number | null;
  notes: string | null;
  tableNumber: string | null;
  address: OrderAddress | null;
  customer: { name: string; phone: string | null };
  marketingOptIn?: boolean;
  items: CartItemInput[];
  discountCents?: number;
  discountReason?: string | null;
  deliveryFeeOverrideCents?: number | null;
  duplicatedFromOrderId?: string | null;
  actor: Actor;
  /** Pedido do cardápio público: aplica horário, tipos de atendimento, pagamentos aceitos e pedido mínimo. */
  enforceStoreRules: boolean;
}

/** Calcula itens com os preços oficiais do banco. Lança 422 com a lista de problemas. */
export async function priceCart(db: DbExecutor, tenantId: string, items: CartItemInput[]): Promise<{ priced: (PricedItem & { categoryId: string; categoryName: string | null; trackStock: boolean })[] }> {
  const catalog = await loadPricingProducts(db, tenantId, items.map((i) => i.productId));
  const errors: string[] = [];
  const priced: (PricedItem & { categoryId: string; categoryName: string | null; trackStock: boolean })[] = [];
  for (const item of items) {
    const entry = catalog.get(item.productId);
    if (!entry) {
      errors.push('Um dos produtos do carrinho não está mais no cardápio.');
      continue;
    }
    const result = priceItem(entry.pricing, {
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes ?? null,
      modifiers: item.modifiers ?? [],
    });
    if (!result.ok) {
      errors.push(...result.errors.map((e) => e.message));
      continue;
    }
    priced.push({ ...result.item, categoryId: entry.row.categoryId, categoryName: entry.categoryName, trackStock: entry.row.trackStock });
  }
  if (errors.length) {
    throw new AppError(422, 'cart_invalid', [...new Set(errors)].join(' '), { items: [...new Set(errors)].join('\n') });
  }
  return { priced };
}

async function reserveStock(tx: DbExecutor, tenantId: string, items: { productId: string; quantity: number; productName: string; trackStock: boolean }[]) {
  const totals = new Map<string, { quantity: number; name: string }>();
  for (const i of items) {
    if (!i.trackStock) continue;
    const t = totals.get(i.productId) ?? { quantity: 0, name: i.productName };
    t.quantity += i.quantity;
    totals.set(i.productId, t);
  }
  for (const [productId, { quantity, name }] of totals) {
    const updated = await tx
      .update(products)
      .set({ stockQuantity: sql`${products.stockQuantity} - ${quantity}` })
      .where(
        and(
          eq(products.id, productId),
          eq(products.tenantId, tenantId),
          eq(products.trackStock, true),
          sql`${products.stockQuantity} >= ${quantity}`,
        ),
      )
      .returning({ id: products.id });
    if (updated.length === 0) {
      throw conflict(`Estoque insuficiente de ${name}.`, 'out_of_stock');
    }
  }
  return totals.size > 0;
}

async function releaseStock(tx: DbExecutor, tenantId: string, orderId: string) {
  const items = await tx
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(and(eq(orderItems.tenantId, tenantId), eq(orderItems.orderId, orderId)));
  const totals = new Map<string, number>();
  for (const i of items) if (i.productId) totals.set(i.productId, (totals.get(i.productId) ?? 0) + i.quantity);
  for (const [productId, quantity] of totals) {
    await tx
      .update(products)
      .set({ stockQuantity: sql`${products.stockQuantity} + ${quantity}` })
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId), eq(products.trackStock, true)));
  }
}

async function insertItems(tx: DbExecutor, tenantId: string, orderId: string, priced: Awaited<ReturnType<typeof priceCart>>['priced']) {
  for (const [position, item] of priced.entries()) {
    const [row] = await tx
      .insert(orderItems)
      .values({
        tenantId,
        orderId,
        productId: item.productId,
        categoryId: item.categoryId,
        productName: item.productName,
        categoryName: item.categoryName,
        basePriceCents: item.basePriceCents,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        totalCents: item.totalCents,
        notes: item.notes,
        position,
      })
      .returning({ id: orderItems.id });
    if (item.modifiers.length) {
      await tx.insert(orderItemModifiers).values(
        item.modifiers.map((m) => ({
          tenantId,
          orderItemId: row!.id,
          modifierId: m.modifierId,
          groupName: m.groupName,
          name: m.name,
          priceCents: m.priceCents,
          quantity: m.quantity,
          totalCents: m.totalCents,
        })),
      );
    }
  }
}

async function findByIdempotencyKey(db: DbExecutor, tenantId: string, key: string) {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.idempotencyKey, key)));
  return row ?? null;
}

export async function createOrder(db: Database, params: CreateOrderParams): Promise<{ order: OrderRow; created: boolean }> {
  const existing = await findByIdempotencyKey(db, params.tenantId, params.idempotencyKey);
  if (existing) return { order: existing, created: false };

  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, params.branchId), eq(branches.tenantId, params.tenantId)));
  if (!branch) throw notFound('Unidade não encontrada.');

  if (params.enforceStoreRules) {
    const hours = await db
      .select({ weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
      .from(openingHours)
      .where(eq(openingHours.branchId, branch.id));
    const availability = getStoreAvailability({ hours, timeZone: branch.timezone, isPaused: branch.isPaused, pausedUntil: branch.pausedUntil });
    if (!availability.isOpen) throw conflict('A loja está fechada no momento e não está recebendo pedidos.', 'store_closed');
    const accepted = { delivery: branch.acceptsDelivery, pickup: branch.acceptsPickup, dine_in: branch.acceptsDineIn };
    if (!accepted[params.fulfillment]) {
      throw unprocessable(`${FULFILLMENT_LABELS[params.fulfillment]} não está disponível nesta loja.`, { fulfillment: 'Indisponível' });
    }
    if (!branch.paymentMethods.includes(params.paymentMethod)) {
      throw unprocessable(`A loja não aceita ${PAYMENT_METHOD_LABELS[params.paymentMethod]}.`, { paymentMethod: 'Indisponível' });
    }
  }

  const { priced } = await priceCart(db, params.tenantId, params.items);
  const subtotal = priced.reduce((s, i) => s + i.totalCents, 0);

  let deliveryFeeCents = 0;
  if (params.fulfillment === 'delivery') {
    deliveryFeeCents = params.deliveryFeeOverrideCents ?? branch.deliveryFeeCents;
    if (params.deliveryFeeOverrideCents == null && branch.freeDeliveryAboveCents !== null && subtotal >= branch.freeDeliveryAboveCents) {
      deliveryFeeCents = 0;
    }
    if (params.enforceStoreRules && subtotal < branch.minOrderCents) {
      throw unprocessable(`O pedido mínimo para entrega é de R$ ${(branch.minOrderCents / 100).toFixed(2).replace('.', ',')}.`, undefined, 'min_order');
    }
  }

  const discountCents = params.discountCents ?? 0;
  if (discountCents > subtotal) throw unprocessable('O desconto não pode ser maior que o valor dos produtos.', { discountCents: 'Desconto maior que o subtotal' });
  const totals = computeOrderTotals({ items: priced, discountCents, deliveryFeeCents });

  if (params.paymentMethod === 'cash' && params.changeForCents !== null && params.changeForCents < totals.totalCents) {
    throw unprocessable('O valor para troco deve ser maior que o total do pedido.', { changeForCents: 'Menor que o total' });
  }

  const status: OrderStatus = params.channel === 'menu' && !branch.autoConfirm ? 'new' : 'confirmed';
  const now = new Date();

  try {
    const order = await db.transaction(async (tx) => {
      let customerId: string | null = null;
      if (params.customer.phone) {
        const [customer] = await tx
          .insert(customers)
          .values({
            tenantId: params.tenantId,
            name: params.customer.name,
            phone: params.customer.phone,
            firstOrderAt: now,
            marketingOptInAt: params.marketingOptIn ? now : null,
          })
          .onConflictDoUpdate({
            target: [customers.tenantId, customers.phone],
            set: {
              name: sql`excluded.name`,
              firstOrderAt: sql`coalesce(${customers.firstOrderAt}, excluded.first_order_at)`,
              marketingOptInAt: sql`coalesce(${customers.marketingOptInAt}, excluded.marketing_opt_in_at)`,
              updatedAt: now,
            },
          })
          .returning({ id: customers.id });
        customerId = customer!.id;

        if (params.address) {
          const a = params.address;
          const [same] = await tx
            .select({ id: customerAddresses.id })
            .from(customerAddresses)
            .where(
              and(
                eq(customerAddresses.tenantId, params.tenantId),
                eq(customerAddresses.customerId, customerId),
                sql`lower(${customerAddresses.street}) = lower(${a.street})`,
                sql`lower(${customerAddresses.number}) = lower(${a.number})`,
                sql`lower(${customerAddresses.neighborhood}) = lower(${a.neighborhood})`,
              ),
            );
          if (same) {
            await tx.update(customerAddresses).set({ ...a, lastUsedAt: now }).where(eq(customerAddresses.id, same.id));
          } else {
            await tx.insert(customerAddresses).values({ ...a, tenantId: params.tenantId, customerId });
          }
        }
      }

      const stockReserved = await reserveStock(tx, params.tenantId, priced);

      const [counter] = await tx
        .update(branches)
        .set({ orderCounter: sql`${branches.orderCounter} + 1` })
        .where(eq(branches.id, branch.id))
        .returning({ value: branches.orderCounter });

      const [row] = await tx
        .insert(orders)
        .values({
          tenantId: params.tenantId,
          branchId: branch.id,
          number: counter!.value,
          publicToken: randomToken(18),
          idempotencyKey: params.idempotencyKey,
          channel: params.channel,
          fulfillment: params.fulfillment,
          status,
          paymentMethod: params.paymentMethod,
          customerId,
          customerName: params.customer.name,
          customerPhone: params.customer.phone,
          address: params.fulfillment === 'delivery' ? params.address : null,
          tableNumber: params.fulfillment === 'dine_in' ? params.tableNumber : null,
          changeForCents: params.paymentMethod === 'cash' ? params.changeForCents : null,
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          discountReason: totals.discountCents > 0 ? (params.discountReason ?? null) : null,
          deliveryFeeCents: totals.deliveryFeeCents,
          totalCents: totals.totalCents,
          notes: params.notes,
          prepTimeMinutes: branch.prepTimeMinutes,
          deliveryTimeMinutes: params.fulfillment === 'delivery' ? branch.deliveryTimeMinutes : 0,
          stockReserved,
          createdByUserId: params.actor.type === 'user' ? params.actor.userId : null,
          duplicatedFromOrderId: params.duplicatedFromOrderId ?? null,
          confirmedAt: status === 'confirmed' ? now : null,
        })
        .returning();

      await insertItems(tx, params.tenantId, row!.id, priced);

      const actor = actorFields(params.actor);
      await tx.insert(orderEvents).values({
        tenantId: params.tenantId,
        orderId: row!.id,
        type: params.duplicatedFromOrderId ? 'duplicated_from' : 'created',
        toStatus: 'new',
        data: { channel: params.channel, totalCents: totals.totalCents, duplicatedFromOrderId: params.duplicatedFromOrderId ?? undefined },
        ...actor,
      });
      if (status === 'confirmed') {
        await tx.insert(orderEvents).values({
          tenantId: params.tenantId,
          orderId: row!.id,
          type: 'status_changed',
          fromStatus: 'new',
          toStatus: 'confirmed',
          data: { automatic: params.channel === 'menu' },
          ...(params.channel === 'menu' ? actorFields({ type: 'system', name: 'Confirmação automática' }) : actor),
        });
      }
      if (totals.discountCents > 0) {
        await tx.insert(orderEvents).values({
          tenantId: params.tenantId,
          orderId: row!.id,
          type: 'discount_applied',
          data: { discountCents: totals.discountCents, reason: params.discountReason },
          ...actor,
        });
      }
      await publishEvent(tx, params.tenantId, {
        type: 'order.created',
        orderId: row!.id,
        branchId: branch.id,
        number: row!.number,
        status,
        channel: params.channel,
      });
      return row!;
    });
    return { order, created: true };
  } catch (err) {
    // Duas requisições simultâneas com a mesma chave: devolve o pedido que venceu a corrida.
    if (isUniqueViolation(err, 'orders_tenant_idempotency_key')) {
      const winner = await findByIdempotencyKey(db, params.tenantId, params.idempotencyKey);
      if (winner) return { order: winner, created: false };
    }
    throw err;
  }
}

const TIMESTAMP: Partial<Record<OrderStatus, keyof OrderRow>> = {
  confirmed: 'confirmedAt',
  preparing: 'preparingAt',
  ready: 'readyAt',
  out_for_delivery: 'dispatchedAt',
  completed: 'completedAt',
  canceled: 'canceledAt',
};

async function lockOrder(tx: DbExecutor, tenantId: string, orderId: string) {
  const [row] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .for('update');
  if (!row) throw notFound('Pedido não encontrado.');
  return row;
}

export async function changeOrderStatus(
  db: Database,
  params: { tenantId: string; orderId: string; to: OrderStatus; reason: string | null; actor: Actor; expectedFrom?: OrderStatus },
) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, params.tenantId, params.orderId);
    if (params.expectedFrom && order.status !== params.expectedFrom) {
      throw conflict(`O pedido já está como "${ORDER_STATUS_LABELS[order.status]}". Atualize a tela.`, 'status_changed');
    }
    if (order.status === params.to) return order;
    if (!canTransition(order.status, params.to, order.fulfillment)) {
      throw conflict(
        `Não é possível passar de "${ORDER_STATUS_LABELS[order.status]}" para "${ORDER_STATUS_LABELS[params.to]}".`,
        'invalid_transition',
      );
    }
    const now = new Date();
    const field = TIMESTAMP[params.to];
    const [updated] = await tx
      .update(orders)
      .set({
        status: params.to,
        ...(field ? { [field]: now } : {}),
        ...(params.to === 'canceled' ? { cancelReason: params.reason, stockReserved: false } : {}),
        version: sql`${orders.version} + 1`,
      })
      .where(and(eq(orders.id, order.id), eq(orders.tenantId, params.tenantId)))
      .returning();

    if (params.to === 'canceled' && order.stockReserved) {
      await releaseStock(tx, params.tenantId, order.id);
    }
    if (params.to === 'completed' && order.customerId) {
      await tx
        .update(customers)
        .set({
          ordersCount: sql`${customers.ordersCount} + 1`,
          totalSpentCents: sql`${customers.totalSpentCents} + ${order.totalCents}`,
          lastOrderAt: order.createdAt,
        })
        .where(and(eq(customers.id, order.customerId), eq(customers.tenantId, params.tenantId)));
    }

    await tx.insert(orderEvents).values({
      tenantId: params.tenantId,
      orderId: order.id,
      type: 'status_changed',
      fromStatus: order.status,
      toStatus: params.to,
      data: params.reason ? { reason: params.reason } : {},
      ...actorFields(params.actor),
    });
    await publishEvent(tx, params.tenantId, {
      type: 'order.updated',
      orderId: order.id,
      branchId: order.branchId,
      number: order.number,
      status: params.to,
      change: 'status',
    });
    return updated!;
  });
}

const EDITABLE: OrderStatus[] = ['new', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready'];

export async function updateOrderItems(
  db: Database,
  params: { tenantId: string; orderId: string; items: CartItemInput[]; reason: string | null; actor: Actor },
) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, params.tenantId, params.orderId);
    if (!EDITABLE.includes(order.status)) {
      throw conflict(`Pedidos "${ORDER_STATUS_LABELS[order.status]}" não podem ter os itens alterados.`, 'not_editable');
    }
    const beforeItems = await tx
      .select({ productName: orderItems.productName, quantity: orderItems.quantity, totalCents: orderItems.totalCents })
      .from(orderItems)
      .where(and(eq(orderItems.tenantId, params.tenantId), eq(orderItems.orderId, order.id)));

    if (order.stockReserved) await releaseStock(tx, params.tenantId, order.id);
    const { priced } = await priceCart(tx, params.tenantId, params.items);
    const stockReserved = await reserveStock(tx, params.tenantId, priced);

    await tx.delete(orderItems).where(and(eq(orderItems.tenantId, params.tenantId), eq(orderItems.orderId, order.id)));
    await insertItems(tx, params.tenantId, order.id, priced);

    const totals = computeOrderTotals({ items: priced, discountCents: order.discountCents, deliveryFeeCents: order.deliveryFeeCents });
    const [updated] = await tx
      .update(orders)
      .set({
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        stockReserved,
        changeForCents: order.changeForCents !== null && order.changeForCents < totals.totalCents ? null : order.changeForCents,
        version: sql`${orders.version} + 1`,
      })
      .where(eq(orders.id, order.id))
      .returning();

    await tx.insert(orderEvents).values({
      tenantId: params.tenantId,
      orderId: order.id,
      type: 'items_updated',
      data: {
        reason: params.reason,
        before: beforeItems.map((i) => `${i.quantity}x ${i.productName}`),
        after: priced.map((i) => `${i.quantity}x ${i.productName}`),
        previousTotalCents: order.totalCents,
        totalCents: totals.totalCents,
      },
      ...actorFields(params.actor),
    });
    await publishEvent(tx, params.tenantId, {
      type: 'order.updated',
      orderId: order.id,
      branchId: order.branchId,
      number: order.number,
      status: order.status,
      change: 'items',
    });
    return updated!;
  });
}

/** Alterações simples com registro no histórico (desconto, pagamento, observação, avisos). */
export async function mutateOrder(
  db: Database,
  params: {
    tenantId: string;
    orderId: string;
    actor: Actor;
    eventType: 'discount_applied' | 'payment_method_changed' | 'payment_status_changed' | 'note_added' | 'customer_notified' | 'printed';
    allowFinal?: boolean;
    apply: (order: OrderRow) => { values?: Partial<typeof orders.$inferInsert>; data: Record<string, unknown> };
  },
) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, params.tenantId, params.orderId);
    if (!params.allowFinal && (order.status === 'canceled' || order.status === 'completed')) {
      throw conflict('Pedidos finalizados não podem ser alterados.', 'not_editable');
    }
    const { values, data } = params.apply(order);
    let updated = order;
    if (values && Object.keys(values).length) {
      [updated] = (await tx
        .update(orders)
        .set({ ...values, version: sql`${orders.version} + 1` })
        .where(eq(orders.id, order.id))
        .returning()) as [OrderRow];
    }
    await tx.insert(orderEvents).values({
      tenantId: params.tenantId,
      orderId: order.id,
      type: params.eventType,
      data,
      ...actorFields(params.actor),
    });
    await publishEvent(tx, params.tenantId, {
      type: 'order.updated',
      orderId: order.id,
      branchId: order.branchId,
      number: order.number,
      status: updated.status,
      change: params.eventType,
    });
    return updated;
  });
}

// ───────────────────────────── Leitura ─────────────────────────────

export async function loadItems(db: DbExecutor, tenantId: string, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, SerializedItem[]>();
  const items = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.tenantId, tenantId), inArray(orderItems.orderId, orderIds)))
    .orderBy(asc(orderItems.position));
  const mods = items.length
    ? await db
        .select()
        .from(orderItemModifiers)
        .where(and(eq(orderItemModifiers.tenantId, tenantId), inArray(orderItemModifiers.orderItemId, items.map((i) => i.id))))
    : [];
  const modsByItem = new Map<string, typeof mods>();
  for (const m of mods) {
    const list = modsByItem.get(m.orderItemId) ?? [];
    list.push(m);
    modsByItem.set(m.orderItemId, list);
  }
  const map = new Map<string, SerializedItem[]>();
  for (const i of items) {
    const list = map.get(i.orderId) ?? [];
    list.push({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      categoryName: i.categoryName,
      quantity: i.quantity,
      basePriceCents: i.basePriceCents,
      unitPriceCents: i.unitPriceCents,
      totalCents: i.totalCents,
      notes: i.notes,
      modifiers: (modsByItem.get(i.id) ?? []).map((m) => ({
        modifierId: m.modifierId,
        groupName: m.groupName,
        name: m.name,
        priceCents: m.priceCents,
        quantity: m.quantity,
        totalCents: m.totalCents,
      })),
    });
    map.set(i.orderId, list);
  }
  return map;
}

export interface SerializedItem {
  id: string;
  productId: string | null;
  productName: string;
  categoryName: string | null;
  quantity: number;
  basePriceCents: number;
  unitPriceCents: number;
  totalCents: number;
  notes: string | null;
  modifiers: { modifierId: string | null; groupName: string; name: string; priceCents: number; quantity: number; totalCents: number }[];
}

export function serializeOrder(o: OrderRow, items: SerializedItem[]) {
  return {
    id: o.id,
    number: o.number,
    branchId: o.branchId,
    status: o.status,
    channel: o.channel,
    fulfillment: o.fulfillment,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    customerId: o.customerId,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    address: o.address,
    tableNumber: o.tableNumber,
    changeForCents: o.changeForCents,
    subtotalCents: o.subtotalCents,
    discountCents: o.discountCents,
    discountReason: o.discountReason,
    deliveryFeeCents: o.deliveryFeeCents,
    totalCents: o.totalCents,
    notes: o.notes,
    cancelReason: o.cancelReason,
    prepTimeMinutes: o.prepTimeMinutes,
    deliveryTimeMinutes: o.deliveryTimeMinutes,
    publicToken: o.publicToken,
    version: o.version,
    createdAt: o.createdAt,
    confirmedAt: o.confirmedAt,
    preparingAt: o.preparingAt,
    readyAt: o.readyAt,
    dispatchedAt: o.dispatchedAt,
    completedAt: o.completedAt,
    canceledAt: o.canceledAt,
    updatedAt: o.updatedAt,
    items,
  };
}

export async function getOrderDetail(db: DbExecutor, tenantId: string, orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
  if (!order) throw notFound('Pedido não encontrado.');
  const items = (await loadItems(db, tenantId, [order.id])).get(order.id) ?? [];
  const events = await db
    .select()
    .from(orderEvents)
    .where(and(eq(orderEvents.tenantId, tenantId), eq(orderEvents.orderId, order.id)))
    .orderBy(asc(orderEvents.createdAt));

  let customer = null;
  if (order.customerId) {
    const [c] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, order.customerId), eq(customers.tenantId, tenantId)));
    if (c) {
      const [stats] = await db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::bigint`.mapWith(Number),
        })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, c.id), sql`${orders.status} <> 'canceled'`));
      const previous = await db
        .select({ id: orders.id, number: orders.number, totalCents: orders.totalCents, status: orders.status, createdAt: orders.createdAt })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, c.id), sql`${orders.id} <> ${order.id}`))
        .orderBy(desc(orders.createdAt))
        .limit(5);
      customer = {
        id: c.id,
        name: c.name,
        phone: c.phone,
        notes: c.notes,
        createdAt: c.createdAt,
        ordersCount: stats?.count ?? 0,
        totalSpentCents: stats?.total ?? 0,
        averageTicketCents: stats && stats.count > 0 ? Math.round(stats.total / stats.count) : 0,
        previousOrders: previous,
      };
    }
  }

  return {
    ...serializeOrder(order, items),
    duplicatedFromOrderId: order.duplicatedFromOrderId,
    customer,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      data: e.data,
      actorType: e.actorType,
      actorName: e.actorName,
      createdAt: e.createdAt,
    })),
  };
}
