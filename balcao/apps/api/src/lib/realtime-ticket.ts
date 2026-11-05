import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Ticket de curta duração para abrir a conexão WebSocket.
 * É assinado (HMAC) para funcionar com várias instâncias da API sem estado compartilhado.
 */
const TTL_MS = 60_000;

export interface TicketPayload {
  sid: string; // sessão
  tid: string; // tenant
  exp: number;
}

export function createTicket(secret: string, sessionId: string, tenantId: string): string {
  const payload: TicketPayload = { sid: sessionId, tid: tenantId, exp: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyTicket(secret: string, ticket: string): TicketPayload | null {
  const [body, sig] = ticket.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TicketPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
