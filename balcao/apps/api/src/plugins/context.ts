import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { hasAccess, resolvePermissions, type AccessLevel, type ModuleKey, type PermissionMap, type Role } from '@balcao/shared';
import { branches, memberships, sessions, tenants, users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { sha256 } from '../lib/crypto';

export const SESSION_COOKIE = 'balcao_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export interface SessionContext {
  sessionId: string;
  activeTenantId: string | null;
  activeBranchId: string | null;
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
}

export interface TenantContext {
  tenantId: string;
  branchId: string;
  membershipId: string;
  role: Role;
  permissions: PermissionMap;
  user: SessionContext['user'];
  tenant: { id: string; slug: string; tradeName: string };
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionCtx: SessionContext | null;
    tenantCtx: TenantContext | null;
  }
}

/** Carrega a sessão a partir do cookie (se houver). Não bloqueia a requisição. */
export async function loadSession(request: FastifyRequest): Promise<void> {
  request.sessionCtx = null;
  request.tenantCtx = null;
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;

  const db = request.server.db;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      activeTenantId: sessions.activeTenantId,
      activeBranchId: sessions.activeBranchId,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      isPlatformAdmin: users.isPlatformAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return;

  // Sessão deslizante: renova a validade periodicamente enquanto o usuário usa o sistema.
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.sessionId));
  }

  request.sessionCtx = {
    sessionId: row.sessionId,
    activeTenantId: row.activeTenantId,
    activeBranchId: row.activeBranchId,
    user: { id: row.userId, email: row.email, name: row.name, isPlatformAdmin: row.isPlatformAdmin },
  };
}

export async function requireUser(request: FastifyRequest): Promise<void> {
  if (!request.sessionCtx) throw unauthorized();
}

/**
 * Resolve o estabelecimento ativo da sessão e verifica a permissão no módulo.
 * O tenant vem SEMPRE da sessão do usuário autenticado, nunca de parâmetros da requisição.
 */
export function requireTenant(module?: ModuleKey, level: Exclude<AccessLevel, 'none'> = 'view') {
  return async function guard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const session = request.sessionCtx;
    if (!session) throw unauthorized();
    const ctx = await resolveTenantContext(request, session);
    if (module && !hasAccess(ctx.permissions, module, level)) {
      throw forbidden();
    }
    request.tenantCtx = ctx;
  };
}

export async function resolveTenantContext(request: FastifyRequest, session: SessionContext): Promise<TenantContext> {
  const db = request.server.db;
  const rows = await db
    .select({
      membershipId: memberships.id,
      tenantId: memberships.tenantId,
      role: memberships.role,
      permissions: memberships.permissions,
      branchIds: memberships.branchIds,
      slug: tenants.slug,
      tradeName: tenants.tradeName,
      tenantStatus: tenants.status,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, session.user.id), eq(memberships.status, 'active')))
    .orderBy(asc(memberships.createdAt));

  if (rows.length === 0) throw forbidden('Sua conta não está vinculada a nenhum estabelecimento ativo.');
  const membership = rows.find((r) => r.tenantId === session.activeTenantId) ?? rows[0]!;
  if (membership.tenantStatus !== 'active') {
    throw forbidden('Este estabelecimento está suspenso. Fale com o suporte da plataforma.');
  }

  const tenantBranches = await db
    .select({ id: branches.id, isPrimary: branches.isPrimary })
    .from(branches)
    .where(eq(branches.tenantId, membership.tenantId))
    .orderBy(asc(branches.createdAt));
  const allowed = tenantBranches.filter((b) => !membership.branchIds || membership.branchIds.includes(b.id));
  const branch =
    allowed.find((b) => b.id === session.activeBranchId) ?? allowed.find((b) => b.isPrimary) ?? allowed[0];
  if (!branch) throw forbidden('Você não tem acesso a nenhuma unidade deste estabelecimento.');

  if (membership.tenantId !== session.activeTenantId || branch.id !== session.activeBranchId) {
    await db
      .update(sessions)
      .set({ activeTenantId: membership.tenantId, activeBranchId: branch.id })
      .where(eq(sessions.id, session.sessionId));
    session.activeTenantId = membership.tenantId;
    session.activeBranchId = branch.id;
  }

  return {
    tenantId: membership.tenantId,
    branchId: branch.id,
    membershipId: membership.membershipId,
    role: membership.role,
    permissions: resolvePermissions(membership.role, membership.permissions),
    user: session.user,
    tenant: { id: membership.tenantId, slug: membership.slug, tradeName: membership.tradeName },
  };
}

export function tenantCtx(request: FastifyRequest): TenantContext {
  if (!request.tenantCtx) throw unauthorized();
  return request.tenantCtx;
}

export function sessionCtx(request: FastifyRequest): SessionContext {
  if (!request.sessionCtx) throw unauthorized();
  return request.sessionCtx;
}

export function assertAccess(ctx: TenantContext, module: ModuleKey, level: Exclude<AccessLevel, 'none'>, message?: string) {
  if (!hasAccess(ctx.permissions, module, level)) throw forbidden(message);
}
