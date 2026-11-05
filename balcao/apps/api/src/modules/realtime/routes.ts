import type { FastifyInstance } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { hasAccess, resolvePermissions } from '@balcao/shared';
import { memberships, sessions } from '../../db/schema';
import { createTicket, verifyTicket } from '../../lib/realtime-ticket';
import { requireTenant, tenantCtx } from '../../plugins/context';
import type { TenantEvent } from '../../services/events';

/**
 * Atualizações em tempo real para o painel.
 * 1. O navegador pede um ticket (rota autenticada pelo cookie de sessão).
 * 2. Abre o WebSocket com o ticket. A API confere sessão e vínculo antes de aceitar.
 * 3. Recebe eventos do estabelecimento (pedidos novos/alterados, cardápio, loja).
 */
export async function realtimeRoutes(app: FastifyInstance) {
  app.post('/ticket', { preHandler: requireTenant() }, async (request) => {
    const ctx = tenantCtx(request);
    return { ticket: createTicket(app.config.SESSION_SECRET, request.sessionCtx!.sessionId, ctx.tenantId) };
  });

  app.get('/', { websocket: true }, async (socket, request) => {
    const ticket = (request.query as { ticket?: string }).ticket ?? '';
    const payload = verifyTicket(app.config.SESSION_SECRET, ticket);
    if (!payload) {
      socket.close(4401, 'ticket inválido');
      return;
    }
    const [row] = await app.db
      .select({ role: memberships.role, permissions: memberships.permissions, userId: sessions.userId })
      .from(sessions)
      .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.tenantId, payload.tid)))
      .where(
        and(
          eq(sessions.id, payload.sid),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(memberships.status, 'active'),
        ),
      );
    if (!row) {
      socket.close(4403, 'sem acesso');
      return;
    }
    const perms = resolvePermissions(row.role, row.permissions);
    const canSeeOrders = hasAccess(perms, 'orders', 'view');

    const unsubscribe = app.hub.subscribe(payload.tid, (event: TenantEvent) => {
      if (event.type.startsWith('order.') && !canSeeOrders) return;
      const { tenantId: _t, ...data } = event;
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
    });

    const heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);

    socket.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    socket.send(JSON.stringify({ type: 'ready' }));
  });
}
