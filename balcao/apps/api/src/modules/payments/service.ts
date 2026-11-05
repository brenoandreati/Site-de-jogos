import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { webhookBaseUrl } from '../../config';
import { branches, orderEvents, orders, payments, tenants } from '../../db/schema';
import { AppError, conflict, notFound } from '../../lib/errors';
import { ProviderError } from '../../integrations/http';
import { mapMpStatus, type MpPayment } from '../../integrations/mercadopago';
import { publishEvent } from '../../services/events';
import { findIntegration, mercadoPagoClient } from '../integrations/service';
import { changeOrderStatus, type OrderRow } from '../orders/service';

const PIX_TTL_MINUTES = 30;

/** Cria a cobrança PIX de um pedido com pagamento online. Idempotente pelo id do pedido. */
export async function createPixForOrder(app: FastifyInstance, order: OrderRow) {
  const [existing] = await app.db.select().from(payments).where(and(eq(payments.tenantId, order.tenantId), eq(payments.orderId, order.id))).orderBy(desc(payments.createdAt)).limit(1);
  if (existing && existing.status === 'pending') return existing;

  const integration = await findIntegration(app.db, order.tenantId, 'mercadopago');
  if (!integration || integration.status !== 'connected') throw new AppError(409, 'payment_provider_unavailable', 'Pagamento online indisponível no momento.');
  const { client } = mercadoPagoClient(app, integration);
  const [tenant] = await app.db.select({ tradeName: tenants.tradeName, email: tenants.email }).from(tenants).where(eq(tenants.id, order.tenantId));
  const expiresAt = new Date(Date.now() + PIX_TTL_MINUTES * 60_000);

  const mp = await client.createPix({
    amountCents: order.totalCents,
    description: `Pedido #${order.number} · ${tenant?.tradeName ?? ''}`,
    // O PIX exige um e-mail do pagador; o pedido não coleta e-mail, então usamos um endereço técnico identificável.
    payerEmail: `pedido-${order.number}-${order.id.slice(0, 8)}@pagamentos.balcao.app`,
    payerFirstName: order.customerName.split(' ')[0] ?? 'Cliente',
    externalReference: order.id,
    notificationUrl: `${webhookBaseUrl(app.config)}/api/webhooks/mercadopago/${integration.id}`,
    expiresAt,
    idempotencyKey: `pix-${order.id}`,
  });

  const tx = mp.point_of_interaction?.transaction_data;
  const [row] = await app.db
    .insert(payments)
    .values({
      tenantId: order.tenantId,
      orderId: order.id,
      provider: 'mercadopago',
      providerPaymentId: String(mp.id),
      method: 'pix',
      status: mapMpStatus(mp.status),
      amountCents: Math.round(mp.transaction_amount * 100),
      qrCode: tx?.qr_code ?? null,
      qrCodeBase64: tx?.qr_code_base64 ?? null,
      ticketUrl: tx?.ticket_url ?? null,
      expiresAt: mp.date_of_expiration ? new Date(mp.date_of_expiration) : expiresAt,
      statusDetail: mp.status_detail ?? null,
      raw: mp,
    })
    .onConflictDoUpdate({ target: [payments.provider, payments.providerPaymentId], set: { updatedAt: new Date() } })
    .returning();

  // Confere de novo logo depois do vencimento: sem pagamento, o pedido é cancelado.
  await app.jobs.enqueue(app.db, 'payment_expiry', { tenantId: order.tenantId, paymentId: row!.id }, { runAt: new Date(expiresAt.getTime() + 60_000), dedupeKey: `expiry:${row!.id}` });
  return row!;
}

/**
 * Sincroniza um pagamento com o provedor. Esta é a ÚNICA forma de um pagamento online ficar
 * "pago": o status vem da consulta direta ao Mercado Pago, nunca do cliente nem do corpo do webhook.
 */
export async function syncPayment(app: FastifyInstance, tenantId: string, providerPaymentId: string) {
  const [payment] = await app.db
    .select()
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.provider, 'mercadopago'), eq(payments.providerPaymentId, providerPaymentId)));
  if (!payment) return null;
  const integration = await findIntegration(app.db, tenantId, 'mercadopago');
  if (!integration) return payment;
  const mp: MpPayment = await mercadoPagoClient(app, integration).client.getPayment(providerPaymentId);
  if (mp.external_reference && mp.external_reference !== payment.orderId) {
    throw new AppError(409, 'payment_mismatch', 'Pagamento não corresponde ao pedido.');
  }
  return applyPaymentStatus(app, payment, mp);
}

async function applyPaymentStatus(app: FastifyInstance, payment: typeof payments.$inferSelect, mp: MpPayment) {
  const status = mapMpStatus(mp.status);
  const [order] = await app.db.select().from(orders).where(and(eq(orders.id, payment.orderId), eq(orders.tenantId, payment.tenantId)));
  if (!order) throw notFound('Pedido do pagamento não encontrado.');
  const amountOk = Math.round(mp.transaction_amount * 100) === order.totalCents;

  await app.db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({
        status,
        statusDetail: mp.status_detail ?? null,
        approvedAt: mp.date_approved ? new Date(mp.date_approved) : payment.approvedAt,
        refundedCents: Math.round((mp.transaction_amount_refunded ?? 0) * 100),
        raw: mp,
      })
      .where(eq(payments.id, payment.id));
    if (status !== payment.status) {
      await tx.insert(orderEvents).values({
        tenantId: payment.tenantId,
        orderId: order.id,
        type: 'payment_updated',
        data: { provider: 'mercadopago', from: payment.status, to: status, detail: mp.status_detail, amountMatches: amountOk },
        actorType: 'system',
        actorName: 'Mercado Pago',
      });
    }
    if (status === 'approved' && amountOk && order.paymentStatus !== 'paid') {
      await tx.update(orders).set({ paymentStatus: 'paid' }).where(eq(orders.id, order.id));
    }
    if (status === 'refunded' && order.paymentStatus !== 'refunded') {
      await tx.update(orders).set({ paymentStatus: 'refunded' }).where(eq(orders.id, order.id));
    }
    await publishEvent(tx, payment.tenantId, { type: 'payment.updated', orderId: order.id, status });
  });

  // Pago e no valor certo: o pedido entra na fila da loja (ou já confirmado, se a loja confirma sozinha).
  if (status === 'approved' && amountOk && order.status === 'awaiting_confirmation') {
    const [branch] = await app.db.select({ autoConfirm: branches.autoConfirm }).from(branches).where(eq(branches.id, order.branchId));
    await changeOrderStatus(
      app.db,
      { tenantId: order.tenantId, orderId: order.id, to: branch?.autoConfirm ? 'confirmed' : 'new', reason: null, actor: { type: 'system', name: 'Pagamento confirmado pelo Mercado Pago' }, expectedFrom: 'awaiting_confirmation' },
      app.jobs,
    ).catch((err) => {
      if (!(err instanceof AppError && err.status === 409)) throw err;
    });
  }
  if (status === 'approved' && !amountOk) {
    app.log.error({ orderId: order.id, paymentId: payment.id }, 'valor pago diferente do total do pedido');
  }
  if ((status === 'rejected' || status === 'cancelled') && order.status === 'awaiting_confirmation') {
    await changeOrderStatus(
      app.db,
      { tenantId: order.tenantId, orderId: order.id, to: 'canceled', reason: status === 'rejected' ? 'Pagamento recusado' : 'Pagamento cancelado', actor: { type: 'system', name: 'Mercado Pago' }, expectedFrom: 'awaiting_confirmation' },
      app.jobs,
    ).catch(() => undefined);
  }
  const [fresh] = await app.db.select().from(payments).where(eq(payments.id, payment.id));
  return fresh!;
}

/** Vencimento do PIX: consulta o provedor; se ainda pendente, cancela a cobrança e o pedido. */
export async function expirePayment(app: FastifyInstance, tenantId: string, paymentId: string) {
  const [payment] = await app.db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)));
  if (!payment || payment.status !== 'pending') return;
  const synced = await syncPayment(app, tenantId, payment.providerPaymentId);
  if (synced?.status !== 'pending') return;
  const integration = await findIntegration(app.db, tenantId, 'mercadopago');
  if (integration) {
    const mp = await mercadoPagoClient(app, integration).client.cancelPayment(payment.providerPaymentId).catch((err) => {
      if (err instanceof ProviderError && !err.retryable) return null;
      throw err;
    });
    if (mp && mapMpStatus(mp.status) === 'approved') {
      await applyPaymentStatus(app, payment, mp);
      return;
    }
  }
  await app.db.update(payments).set({ status: 'expired' }).where(eq(payments.id, payment.id));
  const [order] = await app.db.select().from(orders).where(eq(orders.id, payment.orderId));
  if (order?.status === 'awaiting_confirmation') {
    await changeOrderStatus(
      app.db,
      { tenantId, orderId: order.id, to: 'canceled', reason: 'PIX não pago dentro do prazo', actor: { type: 'system', name: 'Vencimento do PIX' }, expectedFrom: 'awaiting_confirmation' },
      app.jobs,
    ).catch(() => undefined);
  }
}

export async function refundOrderPayment(app: FastifyInstance, tenantId: string, orderId: string) {
  const [payment] = await app.db
    .select()
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId), eq(payments.status, 'approved')))
    .limit(1);
  if (!payment) throw conflict('Não há pagamento online aprovado para estornar neste pedido.');
  const integration = await findIntegration(app.db, tenantId, 'mercadopago');
  if (!integration) throw new AppError(409, 'payment_provider_unavailable', 'Mercado Pago desconectado: reconecte para estornar.');
  try {
    await mercadoPagoClient(app, integration).client.refund(payment.providerPaymentId, `refund-${payment.id}`);
  } catch (err) {
    if (err instanceof ProviderError) throw new AppError(502, 'refund_failed', `O Mercado Pago não fez o estorno: ${err.message}`);
    throw err;
  }
  // O estado oficial vem da consulta ao provedor.
  return syncPayment(app, tenantId, payment.providerPaymentId);
}

export function publicPayment(p: typeof payments.$inferSelect | null | undefined) {
  if (!p) return null;
  return { status: p.status, amountCents: p.amountCents, qrCode: p.qrCode, qrCodeBase64: p.qrCodeBase64, ticketUrl: p.ticketUrl, expiresAt: p.expiresAt, approvedAt: p.approvedAt };
}

export async function latestPayment(app: FastifyInstance, tenantId: string, orderId: string) {
  const [p] = await app.db
    .select()
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId)))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return p ?? null;
}
