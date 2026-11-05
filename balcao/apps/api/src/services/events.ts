import pg from 'pg';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DbExecutor } from '../db/client';

/**
 * Barramento de eventos em tempo real usando LISTEN/NOTIFY do PostgreSQL.
 *
 * - Publicar dentro de uma transação garante que o evento só é entregue se a transação for
 *   confirmada (o NOTIFY é entregue no COMMIT).
 * - Funciona com várias instâncias da API sem infraestrutura extra: todas escutam o mesmo canal.
 * - O payload é pequeno (ids e status); o painel busca os detalhes pela API.
 */

export const EVENTS_CHANNEL = 'balcao_events';

export type RealtimeEvent =
  | { type: 'order.created'; orderId: string; branchId: string; number: number; status: string; channel: string }
  | { type: 'order.updated'; orderId: string; branchId: string; number: number; status: string; change: string }
  | { type: 'catalog.updated' }
  | { type: 'store.updated' }
  | { type: 'delivery.updated'; orderId: string; branchId: string }
  | { type: 'conversation.updated'; conversationId: string; reason: 'message' | 'status' | 'handoff' | 'read' }
  | { type: 'payment.updated'; orderId: string; status: string };

export type TenantEvent = RealtimeEvent & { tenantId: string };

export async function publishEvent(db: DbExecutor, tenantId: string, event: RealtimeEvent): Promise<void> {
  const payload = JSON.stringify({ ...event, tenantId });
  await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${payload})`);
}

type Listener = (event: TenantEvent) => void;

export class EventHub {
  private client: pg.Client | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly databaseUrl: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    client.on('notification', (msg) => {
      if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as TenantEvent;
        this.listeners.get(event.tenantId)?.forEach((fn) => fn(event));
      } catch (err) {
        this.log.warn({ err }, 'evento em tempo real inválido');
      }
    });
    client.on('error', (err) => {
      this.log.error({ err }, 'conexão de eventos perdida; reconectando');
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    await client.connect();
    await client.query(`LISTEN ${EVENTS_CHANNEL}`);
    this.client = client;
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.client = null;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        this.log.error({ err }, 'falha ao reconectar eventos');
        this.scheduleReconnect();
      });
    }, 2000);
  }

  subscribe(tenantId: string, listener: Listener): () => void {
    let set = this.listeners.get(tenantId);
    if (!set) {
      set = new Set();
      this.listeners.set(tenantId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(tenantId);
    };
  }

  connectionCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners('end');
      await client.end().catch(() => undefined);
    }
  }
}
