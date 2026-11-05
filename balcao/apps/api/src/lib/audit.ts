import type { FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/client';
import { auditLogs } from '../db/schema';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  changes?: Record<string, unknown>;
  tenantId?: string | null;
}

/** Registra uma ação administrativa relevante: quem, o quê, quando e em qual empresa. */
export async function audit(db: DbExecutor, request: FastifyRequest, entry: AuditEntry): Promise<void> {
  const user = request.tenantCtx?.user ?? request.sessionCtx?.user ?? null;
  await db.insert(auditLogs).values({
    tenantId: entry.tenantId !== undefined ? entry.tenantId : (request.tenantCtx?.tenantId ?? null),
    actorUserId: user?.id ?? null,
    actorName: user?.name ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary ?? null,
    changes: entry.changes ?? null,
    ip: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
  });
}

/** Diferença rasa entre dois objetos, para registrar no histórico apenas o que mudou. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}
