import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import {
  branchSettingsSchema,
  companySettingsSchema,
  detectDocumentType,
  getStoreAvailability,
  hasAccess,
  messageTemplatesSchema,
  MESSAGE_TEMPLATE_KEYS,
  openingHoursSchema,
  orderSettingsSchema,
  pauseSchema,
  resolveTemplates,
} from '@balcao/shared';
import { branches, openingHours, tenants } from '../../db/schema';
import { audit, diff } from '../../lib/audit';
import { forbidden, notFound, parse } from '../../lib/errors';
import { requireTenant, tenantCtx } from '../../plugins/context';
import { publishEvent } from '../../services/events';

export async function settingsRoutes(app: FastifyInstance) {
  const db = app.db;

  async function load(tenantId: string, branchId: string) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    const [branch] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)));
    if (!tenant || !branch) throw notFound();
    const hours = await db
      .select({ weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
      .from(openingHours)
      .where(and(eq(openingHours.tenantId, tenantId), eq(openingHours.branchId, branchId)))
      .orderBy(asc(openingHours.weekday), asc(openingHours.opensAt));
    return { tenant, branch, hours };
  }

  function serialize({ tenant, branch, hours }: Awaited<ReturnType<typeof load>>) {
    const availability = getStoreAvailability({
      hours,
      timeZone: branch.timezone,
      isPaused: branch.isPaused,
      pausedUntil: branch.pausedUntil,
    });
    return {
      company: {
        slug: tenant.slug,
        tradeName: tenant.tradeName,
        legalName: tenant.legalName,
        document: tenant.document,
        documentType: tenant.documentType,
        email: tenant.email,
        phone: tenant.phone,
        whatsapp: tenant.whatsapp,
        instagram: tenant.instagram,
        description: tenant.description,
        businessCategories: tenant.businessCategories,
        logoUrl: tenant.logoUrl,
        coverUrl: tenant.coverUrl,
        brandColor: tenant.brandColor,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        phone: branch.phone,
        whatsapp: branch.whatsapp,
        timezone: branch.timezone,
        address: branch.street
          ? {
              zipCode: branch.zipCode,
              street: branch.street,
              number: branch.number,
              complement: branch.complement,
              neighborhood: branch.neighborhood,
              city: branch.city,
              state: branch.state,
              reference: branch.reference,
            }
          : null,
      },
      hours,
      orders: {
        acceptsDelivery: branch.acceptsDelivery,
        acceptsPickup: branch.acceptsPickup,
        acceptsDineIn: branch.acceptsDineIn,
        autoConfirm: branch.autoConfirm,
        minOrderCents: branch.minOrderCents,
        deliveryFeeCents: branch.deliveryFeeCents,
        freeDeliveryAboveCents: branch.freeDeliveryAboveCents,
        prepTimeMinutes: branch.prepTimeMinutes,
        deliveryTimeMinutes: branch.deliveryTimeMinutes,
        paymentMethods: branch.paymentMethods,
        pixKey: branch.pixKey,
        pixKeyType: branch.pixKeyType,
        pixHolderName: branch.pixHolderName,
        cancellationPolicy: branch.cancellationPolicy,
      },
      pause: { isPaused: branch.isPaused, pausedUntil: branch.pausedUntil, reason: branch.pauseReason },
      availability,
      messages: resolveTemplates(tenant.messageTemplates),
      menuPath: `/${tenant.slug}`,
    };
  }

  app.get('/', { preHandler: requireTenant() }, async (request) => {
    const ctx = tenantCtx(request);
    // Status da loja (aberta/fechada) é útil para toda a equipe; dados cadastrais exigem permissão.
    const data = serialize(await load(ctx.tenantId, ctx.branchId));
    if (!hasAccess(ctx.permissions, 'settings', 'view')) {
      return { company: { slug: data.company.slug, tradeName: data.company.tradeName, whatsapp: data.company.whatsapp }, availability: data.availability, pause: data.pause, messages: data.messages, menuPath: data.menuPath, orders: { prepTimeMinutes: data.orders.prepTimeMinutes, deliveryTimeMinutes: data.orders.deliveryTimeMinutes, paymentMethods: data.orders.paymentMethods, acceptsDelivery: data.orders.acceptsDelivery, acceptsPickup: data.orders.acceptsPickup, acceptsDineIn: data.orders.acceptsDineIn, deliveryFeeCents: data.orders.deliveryFeeCents, freeDeliveryAboveCents: data.orders.freeDeliveryAboveCents } };
    }
    return data;
  });

  app.put('/company', { preHandler: requireTenant('settings', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(companySettingsSchema, request.body);
    const before = await load(ctx.tenantId, ctx.branchId);
    const values = {
      tradeName: input.tradeName,
      legalName: input.legalName,
      document: input.document,
      documentType: input.document ? detectDocumentType(input.document) : null,
      email: input.email,
      phone: input.phone,
      whatsapp: input.whatsapp,
      instagram: input.instagram,
      description: input.description,
      businessCategories: input.businessCategories,
      logoUrl: input.logoUrl,
      coverUrl: input.coverUrl,
      brandColor: input.brandColor,
    };
    await db.transaction(async (tx) => {
      await tx.update(tenants).set(values).where(eq(tenants.id, ctx.tenantId));
      await audit(tx, request, {
        action: 'settings.company_updated',
        entityType: 'tenant',
        entityId: ctx.tenantId,
        summary: 'Dados da empresa atualizados',
        changes: diff(before.tenant as unknown as Record<string, unknown>, values),
      });
      await publishEvent(tx, ctx.tenantId, { type: 'store.updated' });
    });
    return serialize(await load(ctx.tenantId, ctx.branchId));
  });

  app.put('/branch', { preHandler: requireTenant('settings', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(branchSettingsSchema, request.body);
    const before = await load(ctx.tenantId, ctx.branchId);
    const a = input.address;
    const values = {
      name: input.name,
      phone: input.phone,
      whatsapp: input.whatsapp,
      timezone: input.timezone,
      zipCode: a?.zipCode ?? null,
      street: a?.street ?? null,
      number: a?.number ?? null,
      complement: a?.complement ?? null,
      neighborhood: a?.neighborhood ?? null,
      city: a?.city ?? null,
      state: a?.state ?? null,
      reference: a?.reference ?? null,
    };
    await db.transaction(async (tx) => {
      await tx.update(branches).set(values).where(and(eq(branches.id, ctx.branchId), eq(branches.tenantId, ctx.tenantId)));
      await audit(tx, request, {
        action: 'settings.branch_updated',
        entityType: 'branch',
        entityId: ctx.branchId,
        summary: 'Dados da unidade atualizados',
        changes: diff(before.branch as unknown as Record<string, unknown>, values),
      });
      await publishEvent(tx, ctx.tenantId, { type: 'store.updated' });
    });
    return serialize(await load(ctx.tenantId, ctx.branchId));
  });

  app.put('/hours', { preHandler: requireTenant('settings', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(openingHoursSchema, request.body);
    await db.transaction(async (tx) => {
      await tx
        .delete(openingHours)
        .where(and(eq(openingHours.tenantId, ctx.tenantId), eq(openingHours.branchId, ctx.branchId)));
      if (input.intervals.length) {
        await tx
          .insert(openingHours)
          .values(input.intervals.map((i) => ({ ...i, tenantId: ctx.tenantId, branchId: ctx.branchId })));
      }
      await audit(tx, request, {
        action: 'settings.hours_updated',
        entityType: 'branch',
        entityId: ctx.branchId,
        summary: 'Horário de funcionamento atualizado',
        changes: { intervals: input.intervals },
      });
      await publishEvent(tx, ctx.tenantId, { type: 'store.updated' });
    });
    return serialize(await load(ctx.tenantId, ctx.branchId));
  });

  app.put('/orders', { preHandler: requireTenant('settings', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(orderSettingsSchema, request.body);
    const before = await load(ctx.tenantId, ctx.branchId);
    await db.transaction(async (tx) => {
      await tx.update(branches).set(input).where(and(eq(branches.id, ctx.branchId), eq(branches.tenantId, ctx.tenantId)));
      await audit(tx, request, {
        action: 'settings.orders_updated',
        entityType: 'branch',
        entityId: ctx.branchId,
        summary: 'Regras de pedido, entrega e pagamento atualizadas',
        changes: diff(before.branch as unknown as Record<string, unknown>, input),
      });
      await publishEvent(tx, ctx.tenantId, { type: 'store.updated' });
    });
    return serialize(await load(ctx.tenantId, ctx.branchId));
  });

  app.post('/pause', { preHandler: requireTenant() }, async (request) => {
    const ctx = tenantCtx(request);
    if (!hasAccess(ctx.permissions, 'orders', 'manage') && !hasAccess(ctx.permissions, 'settings', 'edit')) {
      throw forbidden('Você não tem permissão para pausar ou reabrir a loja.');
    }
    const input = parse(pauseSchema, request.body);
    const values = input.paused
      ? {
          isPaused: true,
          pausedUntil: input.durationMinutes ? new Date(Date.now() + input.durationMinutes * 60_000) : null,
          pauseReason: input.reason,
        }
      : { isPaused: false, pausedUntil: null, pauseReason: null };
    await db.transaction(async (tx) => {
      await tx.update(branches).set(values).where(and(eq(branches.id, ctx.branchId), eq(branches.tenantId, ctx.tenantId)));
      await audit(tx, request, {
        action: input.paused ? 'store.paused' : 'store.resumed',
        entityType: 'branch',
        entityId: ctx.branchId,
        summary: input.paused
          ? `Loja pausada${input.durationMinutes ? ` por ${input.durationMinutes} min` : ''}${input.reason ? `: ${input.reason}` : ''}`
          : 'Loja reaberta para pedidos',
      });
      await publishEvent(tx, ctx.tenantId, { type: 'store.updated' });
    });
    return serialize(await load(ctx.tenantId, ctx.branchId));
  });

  app.put('/messages', { preHandler: requireTenant('settings', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(messageTemplatesSchema, request.body);
    const templates: Record<string, string> = {};
    for (const key of MESSAGE_TEMPLATE_KEYS) {
      const value = input.templates[key];
      if (value) templates[key] = value;
    }
    await db.transaction(async (tx) => {
      await tx.update(tenants).set({ messageTemplates: templates }).where(eq(tenants.id, ctx.tenantId));
      await audit(tx, request, {
        action: 'settings.messages_updated',
        entityType: 'tenant',
        entityId: ctx.tenantId,
        summary: 'Mensagens de atualização de pedido personalizadas',
      });
    });
    return serialize(await load(ctx.tenantId, ctx.branchId));
  });
}
