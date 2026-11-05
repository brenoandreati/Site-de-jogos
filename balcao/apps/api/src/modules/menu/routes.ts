import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { describeAvailability, getStoreAvailability, localTime, publicCheckoutSchema } from '@balcao/shared';
import { branches, deliveryZones, integrations, openingHours, orderEvents, orders, tenants } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { createPixForOrder, latestPayment, publicPayment } from '../payments/service';
import { changeOrderStatus } from '../orders/service';
import { notFound, parse } from '../../lib/errors';
import { loadPublicCatalog } from '../catalog/service';
import { createOrder, loadItems } from '../orders/service';

/**
 * Rotas públicas do cardápio digital (sem login).
 * Só expõem o que o cliente precisa ver: nada de dados internos, notas da equipe ou nomes de funcionários.
 */
export async function publicMenuRoutes(app: FastifyInstance) {
  const db = app.db;

  async function findStore(slug: string) {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(and(eq(tenants.slug, slug.toLowerCase()), eq(tenants.status, 'active')));
    if (!tenant) throw notFound('Loja não encontrada.');
    const [branch] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.tenantId, tenant.id), eq(branches.isPrimary, true)));
    if (!branch) throw notFound('Loja não encontrada.');
    return { tenant, branch };
  }

  app.get('/stores/:slug', async (request, reply) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(60) }), request.params);
    const { tenant, branch } = await findStore(slug);
    const hours = await db
      .select({ weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
      .from(openingHours)
      .where(eq(openingHours.branchId, branch.id))
      .orderBy(asc(openingHours.weekday), asc(openingHours.opensAt));
    const availability = getStoreAvailability({ hours, timeZone: branch.timezone, isPaused: branch.isPaused, pausedUntil: branch.pausedUntil });
    const today = localTime(new Date(), branch.timezone).weekday;
    const categories = await loadPublicCatalog(db, tenant.id);
    const zones = await db
      .select({ id: deliveryZones.id, name: deliveryZones.name, feeCents: deliveryZones.feeCents, minOrderCents: deliveryZones.minOrderCents, etaMinutes: deliveryZones.etaMinutes })
      .from(deliveryZones)
      .where(and(eq(deliveryZones.branchId, branch.id), eq(deliveryZones.isActive, true)))
      .orderBy(asc(deliveryZones.name));
    const [mp] = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.tenantId, tenant.id), eq(integrations.provider, 'mercadopago'), eq(integrations.status, 'connected')));
    reply.header('cache-control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=30');
    return {
      store: {
        slug: tenant.slug,
        name: tenant.tradeName,
        description: tenant.description,
        logoUrl: tenant.logoUrl,
        coverUrl: tenant.coverUrl,
        brandColor: tenant.brandColor,
        whatsapp: branch.whatsapp ?? tenant.whatsapp,
        instagram: tenant.instagram,
        address: branch.street
          ? {
              street: branch.street,
              number: branch.number,
              complement: branch.complement,
              neighborhood: branch.neighborhood,
              city: branch.city,
              state: branch.state,
            }
          : null,
        timezone: branch.timezone,
        availability,
        availabilityText: describeAvailability(availability, today),
        hours,
        prepTimeMinutes: branch.prepTimeMinutes,
        deliveryTimeMinutes: branch.deliveryTimeMinutes,
        acceptsDelivery: branch.acceptsDelivery,
        acceptsPickup: branch.acceptsPickup,
        acceptsDineIn: branch.acceptsDineIn,
        minOrderCents: branch.minOrderCents,
        deliveryFeeCents: branch.deliveryFeeCents,
        freeDeliveryAboveCents: branch.freeDeliveryAboveCents,
        paymentMethods: branch.paymentMethods,
        pix: branch.paymentMethods.includes('pix') && branch.pixKey
          ? { key: branch.pixKey, keyType: branch.pixKeyType, holderName: branch.pixHolderName }
          : null,
        cancellationPolicy: branch.cancellationPolicy,
        deliveryZones: branch.acceptsDelivery ? zones : [],
        onlinePayment: !!mp,
      },
      categories,
    };
  });

  app.post(
    '/stores/:slug/orders',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { slug } = parse(z.object({ slug: z.string().min(1).max(60) }), request.params);
      const input = parse(publicCheckoutSchema, request.body);
      const { tenant, branch } = await findStore(slug);
      const { order, created } = await createOrder(db, {
        tenantId: tenant.id,
        branchId: branch.id,
        idempotencyKey: input.idempotencyKey,
        channel: 'menu',
        fulfillment: input.fulfillment,
        paymentMethod: input.paymentMethod,
        changeForCents: input.changeForCents,
        notes: input.notes,
        tableNumber: input.tableNumber,
        address: input.address,
        customer: input.customer,
        marketingOptIn: input.marketingOptIn,
        deliveryZoneId: input.deliveryZoneId,
        items: input.items,
        actor: { type: 'customer', name: input.customer.name },
        enforceStoreRules: true,
      }, app.jobs);
      if (order.paymentMethod === 'online' && order.status === 'awaiting_confirmation') {
        try {
          await createPixForOrder(app, order);
        } catch (err) {
          request.log.error({ err, orderId: order.id }, 'falha ao gerar PIX');
          if (created) {
            await changeOrderStatus(db, { tenantId: tenant.id, orderId: order.id, to: 'canceled', reason: 'Não foi possível gerar o PIX', actor: { type: 'system', name: 'Pagamento online' } }, app.jobs).catch(() => undefined);
          }
          throw new AppError(502, 'pix_failed', 'Não conseguimos gerar o PIX agora. Tente de novo ou escolha pagar na entrega/retirada.');
        }
      }
      return reply.status(created ? 201 : 200).send({ token: order.publicToken, number: order.number, status: order.status });
    },
  );

  app.get('/orders/:token', async (request) => {
    const { token } = parse(z.object({ token: z.string().min(16).max(64) }), request.params);
    const [order] = await db.select().from(orders).where(eq(orders.publicToken, token));
    if (!order) throw notFound('Pedido não encontrado.');
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, order.tenantId));
    const [branch] = await db.select().from(branches).where(eq(branches.id, order.branchId));
    const items = (await loadItems(db, order.tenantId, [order.id])).get(order.id) ?? [];
    const payment = order.paymentMethod === 'online' ? await latestPayment(app, order.tenantId, order.id) : null;
    if (payment?.status === 'pending' && order.status === 'awaiting_confirmation') {
      // Cliente esperando o PIX: confere com o Mercado Pago no máximo a cada 10 s por pagamento.
      await app.jobs.enqueue(db, 'payment_sync', { tenantId: order.tenantId, providerPaymentId: payment.providerPaymentId }, { dedupeKey: `payment-sync:${payment.id}:${Math.floor(Date.now() / 10_000)}`, maxAttempts: 1 });
    }
    const timeline = await db
      .select({ toStatus: orderEvents.toStatus, createdAt: orderEvents.createdAt })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), inArray(orderEvents.type, ['created', 'status_changed', 'duplicated_from'])))
      .orderBy(asc(orderEvents.createdAt));
    return {
      number: order.number,
      status: order.status,
      fulfillment: order.fulfillment,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      customerName: order.customerName,
      address: order.address,
      tableNumber: order.tableNumber,
      changeForCents: order.changeForCents,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      deliveryFeeCents: order.deliveryFeeCents,
      totalCents: order.totalCents,
      notes: order.notes,
      cancelReason: order.status === 'canceled' ? order.cancelReason : null,
      prepTimeMinutes: order.prepTimeMinutes,
      deliveryTimeMinutes: order.deliveryTimeMinutes,
      createdAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      items: items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        totalCents: i.totalCents,
        notes: i.notes,
        modifiers: i.modifiers.map((m) => ({ name: m.name, quantity: m.quantity, groupName: m.groupName })),
      })),
      timeline: timeline.map((t) => ({ status: t.toStatus, at: t.createdAt })),
      payment: order.paymentMethod === 'online' ? publicPayment(payment) : null,
      store: {
        name: tenant?.tradeName ?? '',
        slug: tenant?.slug ?? '',
        logoUrl: tenant?.logoUrl ?? null,
        whatsapp: branch?.whatsapp ?? tenant?.whatsapp ?? null,
        pix:
          order.paymentMethod === 'pix' && branch?.pixKey
            ? { key: branch.pixKey, keyType: branch.pixKeyType, holderName: branch.pixHolderName }
            : null,
      },
    };
  });
}
