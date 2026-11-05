import { createHmac, timingSafeEqual } from 'node:crypto';
import { requestJson } from './http';

/**
 * Cliente do Mercado Pago (API de pagamentos), usado para PIX online.
 * Documentação: mercadopago.com.br/developers/pt/reference/payments/_payments/post
 */
export interface MpPayment {
  id: number;
  status: 'pending' | 'approved' | 'authorized' | 'in_process' | 'in_mediation' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back';
  status_detail?: string;
  transaction_amount: number;
  date_of_expiration?: string;
  date_approved?: string | null;
  external_reference?: string;
  transaction_amount_refunded?: number;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
}

export class MercadoPagoClient {
  private readonly base = 'https://api.mercadopago.com';

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly accessToken: string,
  ) {}

  private call<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}) {
    return requestJson<T>(
      this.fetchImpl,
      'Mercado Pago',
      `${this.base}${path}`,
      {
        method: init.method,
        body: init.body,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          ...(init.idempotencyKey ? { 'x-idempotency-key': init.idempotencyKey } : {}),
        },
      },
      (status, body) => {
        const b = body as { message?: string; cause?: { description?: string }[] } | null;
        return { message: b?.cause?.[0]?.description ?? b?.message ?? `HTTP ${status}` };
      },
    );
  }

  me() {
    return this.call<{ id: number; nickname?: string; email?: string; site_id?: string }>('/users/me');
  }

  /** Cria uma cobrança PIX. A chave de idempotência impede cobrança duplicada em novas tentativas. */
  createPix(input: {
    amountCents: number;
    description: string;
    payerEmail: string;
    payerFirstName: string;
    externalReference: string;
    notificationUrl: string;
    expiresAt: Date;
    idempotencyKey: string;
  }) {
    return this.call<MpPayment>('/v1/payments', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: {
        transaction_amount: input.amountCents / 100,
        description: input.description.slice(0, 250),
        payment_method_id: 'pix',
        external_reference: input.externalReference,
        notification_url: input.notificationUrl,
        date_of_expiration: input.expiresAt.toISOString().replace('Z', '-00:00'),
        payer: { email: input.payerEmail, first_name: input.payerFirstName },
      },
    });
  }

  getPayment(id: string) {
    return this.call<MpPayment>(`/v1/payments/${encodeURIComponent(id)}`);
  }

  cancelPayment(id: string) {
    return this.call<MpPayment>(`/v1/payments/${encodeURIComponent(id)}`, { method: 'PUT', body: { status: 'cancelled' } });
  }

  refund(id: string, idempotencyKey: string) {
    return this.call<{ id: number; status: string; amount: number }>(`/v1/payments/${encodeURIComponent(id)}/refunds`, {
      method: 'POST',
      body: {},
      idempotencyKey,
    });
  }
}

/**
 * Confere a assinatura x-signature das notificações do Mercado Pago:
 * HMAC SHA-256 de "id:{data.id};request-id:{x-request-id};ts:{ts};" com a assinatura secreta.
 */
export function verifyMercadoPagoSignature(
  secret: string,
  header: string | undefined,
  requestId: string | undefined,
  dataId: string,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const manifest = `id:${dataId.toLowerCase()};${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  const given = Buffer.from(v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function mapMpStatus(s: MpPayment['status']): 'pending' | 'approved' | 'rejected' | 'cancelled' | 'refunded' {
  switch (s) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    case 'refunded':
    case 'charged_back':
      return 'refunded';
    default:
      return 'pending';
  }
}
