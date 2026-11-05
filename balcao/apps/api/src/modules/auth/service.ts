import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { branches, memberships, sessions, tenants } from '../../db/schema';
import { randomToken, sha256 } from '../../lib/crypto';
import { SESSION_COOKIE, SESSION_TTL_MS, resolveTenantContext, type SessionContext } from '../../plugins/context';

export async function createSession(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  activeTenantId: string | null,
): Promise<string> {
  const token = randomToken(32);
  const [session] = await request.server.db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    activeTenantId,
    ip: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  }).returning({ id: sessions.id });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.server.config.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return session!.id;
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function revokeUserSessions(db: Database, userId: string, exceptSessionId?: string) {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  const ids = rows.map((r) => r.id).filter((id) => id !== exceptSessionId);
  for (const id of ids) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
  }
}

/** Dados da conta, empresas às quais o usuário pertence e contexto ativo (empresa, unidade, permissões). */
export async function buildMe(request: FastifyRequest, session: SessionContext) {
  const db = request.server.db;
  const list = await db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      tradeName: tenants.tradeName,
      logoUrl: tenants.logoUrl,
      status: tenants.status,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, session.user.id), eq(memberships.status, 'active')))
    .orderBy(asc(memberships.createdAt));

  let active = null;
  if (list.some((t) => t.status === 'active')) {
    try {
      const ctx = await resolveTenantContext(request, session);
      const tenant = list.find((t) => t.tenantId === ctx.tenantId)!;
      const branchList = await db
        .select({ id: branches.id, name: branches.name, isPrimary: branches.isPrimary })
        .from(branches)
        .where(eq(branches.tenantId, ctx.tenantId))
        .orderBy(asc(branches.createdAt));
      const [membership] = await db
        .select({ branchIds: memberships.branchIds })
        .from(memberships)
        .where(eq(memberships.id, ctx.membershipId));
      active = {
        tenant: { id: tenant.tenantId, slug: tenant.slug, tradeName: tenant.tradeName, logoUrl: tenant.logoUrl },
        branchId: ctx.branchId,
        branches: branchList.filter((b) => !membership?.branchIds || membership.branchIds.includes(b.id)),
        role: ctx.role,
        permissions: ctx.permissions,
      };
    } catch {
      active = null;
    }
  }

  return {
    user: session.user,
    tenants: list.map((t) => ({
      id: t.tenantId,
      slug: t.slug,
      tradeName: t.tradeName,
      logoUrl: t.logoUrl,
      role: t.role,
      status: t.status,
    })),
    active,
  };
}
