import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, branches, orderEvents, orders } from '../../db/schema';
import { parse, unprocessable } from '../../lib/errors';
import { requireTenant, tenantCtx } from '../../plugins/context';

/**
 * Indicadores da visão geral.
 *
 * Faturamento considera pedidos ACEITOS (confirmados em diante, não cancelados): pedidos novos ainda
 * aguardando confirmação não entram. É faturamento bruto (o que o cliente paga), não lucro.
 * Datas são interpretadas no fuso horário da unidade.
 */
const REVENUE_STATUSES = sql.raw(`('confirmed','preparing','ready','out_for_delivery','completed')`);

const querySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'A data inicial deve ser anterior à final');

type Num = number;

export async function dashboardRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', { preHandler: requireTenant('dashboard', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const q = parse(querySchema, request.query);
    const [branch] = await db.select({ timezone: branches.timezone }).from(branches).where(eq(branches.id, ctx.branchId));
    const tz = branch?.timezone ?? 'America/Sao_Paulo';

    const { rows: [today] } = await db.execute<{ today: string }>(sql`select (now() at time zone ${tz})::date::text as today`);
    const from = q.from ?? today!.today;
    const to = q.to ?? q.from ?? today!.today;
    const { rows: [range] } = await db.execute<{ days: number; start: Date; end: Date; prev_start: Date }>(sql`
      select (${to}::date - ${from}::date + 1)::int as days,
             (${from}::date)::timestamp at time zone ${tz} as start,
             (${to}::date + 1)::timestamp at time zone ${tz} as "end",
             (${from}::date - (${to}::date - ${from}::date + 1))::timestamp at time zone ${tz} as prev_start
    `);
    if (!range || range.days > 366) throw unprocessable('Escolha um período de até 366 dias.');
    const start = new Date(range.start);
    const end = new Date(range.end);
    const prevStart = new Date(range.prev_start);
    const t = ctx.tenantId;
    const b = ctx.branchId;
    const scope = sql`o.tenant_id = ${t} and o.branch_id = ${b}`;

    const summary = async (s: Date, e: Date) => {
      const { rows: [r] } = await db.execute<Record<string, Num>>(sql`
        select count(*)::int as orders,
               count(*) filter (where o.status in ${REVENUE_STATUSES})::int as accepted,
               count(*) filter (where o.status = 'completed')::int as completed,
               count(*) filter (where o.status = 'canceled')::int as canceled,
               coalesce(sum(o.total_cents) filter (where o.status in ${REVENUE_STATUSES}), 0)::bigint as revenue,
               coalesce(sum(o.discount_cents) filter (where o.status in ${REVENUE_STATUSES}), 0)::bigint as discounts,
               coalesce(sum(o.delivery_fee_cents) filter (where o.status in ${REVENUE_STATUSES}), 0)::bigint as delivery_fees
        from orders o where ${scope} and o.created_at >= ${s} and o.created_at < ${e}`);
      const revenue = Number(r!.revenue);
      const accepted = Number(r!.accepted);
      return {
        orders: Number(r!.orders),
        accepted,
        completed: Number(r!.completed),
        canceled: Number(r!.canceled),
        revenueCents: revenue,
        discountsCents: Number(r!.discounts),
        deliveryFeesCents: Number(r!.delivery_fees),
        averageTicketCents: accepted > 0 ? Math.round(revenue / accepted) : 0,
      };
    };

    const customersIn = async (s: Date, e: Date) => {
      const { rows: [r] } = await db.execute<{ new_customers: number; returning_customers: number }>(sql`
        with period as (
          select distinct o.customer_id from orders o
          where ${scope} and o.created_at >= ${s} and o.created_at < ${e} and o.status <> 'canceled' and o.customer_id is not null
        ), firsts as (
          select o.customer_id, min(o.created_at) as first_at from orders o
          where ${scope} and o.status <> 'canceled' and o.customer_id in (select customer_id from period)
          group by o.customer_id
        )
        select count(*) filter (where first_at >= ${s})::int as new_customers,
               count(*) filter (where first_at < ${s})::int as returning_customers
        from firsts`);
      return { newCustomers: Number(r?.new_customers ?? 0), returningCustomers: Number(r?.returning_customers ?? 0) };
    };

    const [current, previous, currentCustomers, previousCustomers] = await Promise.all([
      summary(start, end),
      summary(prevStart, start),
      customersIn(start, end),
      customersIn(prevStart, start),
    ]);

    const { rows: [fixed] } = await db.execute<{ today: string; month: string }>(sql`
      select coalesce(sum(o.total_cents) filter (where o.created_at >= (now() at time zone ${tz})::date::timestamp at time zone ${tz}), 0)::bigint as today,
             coalesce(sum(o.total_cents), 0)::bigint as month
      from orders o
      where ${scope} and o.status in ${REVENUE_STATUSES}
        and o.created_at >= date_trunc('month', now() at time zone ${tz}) at time zone ${tz}`);

    const { rows: live } = await db.execute<{ status: string; count: number }>(sql`
      select o.status, count(*)::int as count from orders o
      where ${scope} and o.status in ('new','awaiting_confirmation','confirmed','preparing','ready','out_for_delivery')
      group by o.status`);

    const hourly = range.days === 1;
    const { rows: series } = hourly
      ? await db.execute<{ bucket: string; revenue: string; orders: number; accepted: number }>(sql`
          with buckets as (select generate_series(0, 23) as h)
          select lpad(b.h::text, 2, '0') || 'h' as bucket,
                 coalesce(sum(o.total_cents) filter (where o.status in ${REVENUE_STATUSES}), 0)::bigint as revenue,
                 count(o.id)::int as orders,
                 count(o.id) filter (where o.status in ${REVENUE_STATUSES})::int as accepted
          from buckets b
          left join orders o on ${scope} and o.created_at >= ${start} and o.created_at < ${end}
            and extract(hour from o.created_at at time zone ${tz}) = b.h
          group by b.h order by b.h`)
      : await db.execute<{ bucket: string; revenue: string; orders: number; accepted: number }>(sql`
          with days as (select generate_series(${from}::date, ${to}::date, interval '1 day')::date as d)
          select d.d::text as bucket,
                 coalesce(sum(o.total_cents) filter (where o.status in ${REVENUE_STATUSES}), 0)::bigint as revenue,
                 count(o.id)::int as orders,
                 count(o.id) filter (where o.status in ${REVENUE_STATUSES})::int as accepted
          from days d
          left join orders o on ${scope} and (o.created_at at time zone ${tz})::date = d.d
          group by d.d order by d.d`);

    // Série do período anterior (mesmo tamanho) para comparação no gráfico.
    const { rows: previousSeries } = hourly
      ? await db.execute<{ revenue: string }>(sql`
          with buckets as (select generate_series(0, 23) as h)
          select coalesce(sum(o.total_cents) filter (where o.status in ${REVENUE_STATUSES}), 0)::bigint as revenue
          from buckets b
          left join orders o on ${scope} and o.created_at >= ${prevStart} and o.created_at < ${start}
            and extract(hour from o.created_at at time zone ${tz}) = b.h
          group by b.h order by b.h`)
      : await db.execute<{ revenue: string }>(sql`
          with days as (select generate_series((${from}::date - ${range.days}::int), (${from}::date - 1), interval '1 day')::date as d)
          select coalesce(sum(o.total_cents) filter (where o.status in ${REVENUE_STATUSES}), 0)::bigint as revenue
          from days d
          left join orders o on ${scope} and (o.created_at at time zone ${tz})::date = d.d
          group by d.d order by d.d`);

    const accepted = sql`${scope} and o.status in ${REVENUE_STATUSES} and o.created_at >= ${start} and o.created_at < ${end}`;

    const { rows: byCategory } = await db.execute<{ name: string; revenue: string; quantity: number }>(sql`
      select coalesce(i.category_name, 'Sem categoria') as name, sum(i.total_cents)::bigint as revenue, sum(i.quantity)::int as quantity
      from order_items i join orders o on o.id = i.order_id and o.tenant_id = i.tenant_id
      where ${accepted}
      group by 1 order by revenue desc limit 10`);

    const { rows: topProducts } = await db.execute<{ name: string; revenue: string; quantity: number }>(sql`
      select i.product_name as name, sum(i.total_cents)::bigint as revenue, sum(i.quantity)::int as quantity
      from order_items i join orders o on o.id = i.order_id and o.tenant_id = i.tenant_id
      where ${accepted}
      group by coalesce(i.product_id::text, i.product_name), i.product_name
      order by quantity desc, revenue desc limit 8`);

    const { rows: topByRevenue } = await db.execute<{ name: string; revenue: string; quantity: number }>(sql`
      select i.product_name as name, sum(i.total_cents)::bigint as revenue, sum(i.quantity)::int as quantity
      from order_items i join orders o on o.id = i.order_id and o.tenant_id = i.tenant_id
      where ${accepted}
      group by coalesce(i.product_id::text, i.product_name), i.product_name
      order by revenue desc limit 8`);

    const { rows: byPayment } = await db.execute<{ key: string; revenue: string; orders: number }>(sql`
      select o.payment_method as key, sum(o.total_cents)::bigint as revenue, count(*)::int as orders
      from orders o where ${accepted} group by 1 order by revenue desc`);

    const { rows: byChannel } = await db.execute<{ key: string; revenue: string; orders: number }>(sql`
      select o.channel as key, sum(o.total_cents)::bigint as revenue, count(*)::int as orders
      from orders o where ${accepted} group by 1 order by revenue desc`);

    const { rows: byFulfillment } = await db.execute<{ key: string; revenue: string; orders: number }>(sql`
      select o.fulfillment as key, sum(o.total_cents)::bigint as revenue, count(*)::int as orders
      from orders o where ${accepted} group by 1 order by revenue desc`);

    const events = await db
      .select({
        id: orderEvents.id,
        type: orderEvents.type,
        toStatus: orderEvents.toStatus,
        fromStatus: orderEvents.fromStatus,
        actorName: orderEvents.actorName,
        actorType: orderEvents.actorType,
        data: orderEvents.data,
        createdAt: orderEvents.createdAt,
        orderId: orders.id,
        orderNumber: orders.number,
        customerName: orders.customerName,
        totalCents: orders.totalCents,
      })
      .from(orderEvents)
      .innerJoin(orders, and(eq(orders.id, orderEvents.orderId), eq(orders.tenantId, orderEvents.tenantId)))
      .where(and(eq(orderEvents.tenantId, t), eq(orders.branchId, b), sql`${orderEvents.type} in ('created','status_changed','discount_applied','items_updated','duplicated_from')`))
      .orderBy(desc(orderEvents.createdAt))
      .limit(15);

    const changes = await db
      .select({ id: auditLogs.id, action: auditLogs.action, summary: auditLogs.summary, actorName: auditLogs.actorName, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, t), sql`${auditLogs.action} not like 'auth.%' and ${auditLogs.action} not like 'order.%'`))
      .orderBy(desc(auditLogs.createdAt))
      .limit(10);

    const activity = [
      ...events.map((e) => ({ kind: 'order' as const, ...e })),
      ...changes.map((c) => ({ kind: 'change' as const, ...c })),
    ]
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .slice(0, 20);

    const money = <T extends { revenue: string }>(rows: T[]) => rows.map((r) => ({ ...r, revenue: Number(r.revenue) }));

    return {
      period: { from, to, days: range.days, timezone: tz, granularity: hourly ? 'hour' : 'day' },
      revenueTodayCents: Number(fixed?.today ?? 0),
      revenueMonthCents: Number(fixed?.month ?? 0),
      current: { ...current, ...currentCustomers },
      previous: { ...previous, ...previousCustomers },
      live: Object.fromEntries(live.map((l) => [l.status, Number(l.count)])),
      series: series.map((s, i) => ({
        bucket: s.bucket,
        revenueCents: Number(s.revenue),
        previousRevenueCents: Number(previousSeries[i]?.revenue ?? 0),
        orders: Number(s.orders),
        averageTicketCents: Number(s.accepted) > 0 ? Math.round(Number(s.revenue) / Number(s.accepted)) : 0,
      })),
      byCategory: money(byCategory),
      topProducts: money(topProducts),
      topByRevenue: money(topByRevenue),
      byPayment: money(byPayment),
      byChannel: money(byChannel),
      byFulfillment: money(byFulfillment),
      activity,
    };
  });
}
