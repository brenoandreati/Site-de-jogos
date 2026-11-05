import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  ROLE_LABELS,
  assignableRoles,
  inviteMemberSchema,
  resolvePermissions,
  updateMemberSchema,
} from '@balcao/shared';
import { authTokens, memberships, sessions, tenants, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { randomToken, sha256 } from '../../lib/crypto';
import { conflict, forbidden, notFound, parse, unprocessable } from '../../lib/errors';
import { requireTenant, tenantCtx, type TenantContext } from '../../plugins/context';
import type { DbExecutor } from '../../db/client';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const idParam = z.object({ id: z.uuid('Identificador inválido') });

export async function teamRoutes(app: FastifyInstance) {
  const db = app.db;

  async function issueInvite(tx: DbExecutor, ctx: TenantContext, membershipId: string, userId: string) {
    // Invalida convites anteriores do mesmo membro.
    await tx
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.membershipId, membershipId), eq(authTokens.type, 'invite'), isNull(authTokens.usedAt)));
    const token = randomToken(32);
    await tx.insert(authTokens).values({
      type: 'invite',
      tokenHash: sha256(token),
      userId,
      tenantId: ctx.tenantId,
      membershipId,
      createdByUserId: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    return `${app.config.APP_URL}/convite/${token}`;
  }

  async function sendInviteEmail(email: string, name: string, tenantName: string, role: keyof typeof ROLE_LABELS, inviteUrl: string, invitedBy: string) {
    try {
      await app.mailer.send({
        to: email,
        subject: `Convite para a equipe de ${tenantName}`,
        text: `Olá, ${name}!\n\n${invitedBy} convidou você para a equipe de ${tenantName} como ${ROLE_LABELS[role]}.\n\nAceite pelo link (válido por 7 dias):\n${inviteUrl}`,
      });
      return { sent: app.mailer.configured };
    } catch {
      return { sent: false };
    }
  }

  app.get('/', { preHandler: requireTenant('team', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const rows = await db
      .select({
        id: memberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        status: memberships.status,
        permissions: memberships.permissions,
        lastLoginAt: users.lastLoginAt,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, ctx.tenantId))
      .orderBy(asc(memberships.createdAt));
    return {
      members: rows.map((r) => ({
        ...r,
        isYou: r.userId === ctx.user.id,
        customPermissions: r.permissions,
        effectivePermissions: resolvePermissions(r.role, r.permissions),
      })),
      assignableRoles: assignableRoles(ctx.role),
    };
  });

  app.post('/', { preHandler: requireTenant('team', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const input = parse(inviteMemberSchema, request.body);
    if (!assignableRoles(ctx.role).includes(input.role)) throw forbidden('Você não pode atribuir esta função.');
    if (input.permissions && ctx.role !== 'owner' && ctx.role !== 'admin') {
      throw forbidden('Somente o proprietário ou administradores personalizam permissões.');
    }

    const result = await db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, input.email));
      if (!user) {
        [user] = await tx.insert(users).values({ email: input.email, name: input.name }).returning();
      }
      const [existing] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, user!.id)));
      if (existing) throw conflict('Esta pessoa já faz parte da equipe.', 'already_member');
      const [membership] = await tx
        .insert(memberships)
        .values({
          tenantId: ctx.tenantId,
          userId: user!.id,
          role: input.role,
          status: 'invited',
          permissions: input.permissions,
          invitedByUserId: ctx.user.id,
        })
        .returning();
      const inviteUrl = await issueInvite(tx, ctx, membership!.id, user!.id);
      await audit(tx, request, {
        action: 'team.member_invited',
        entityType: 'membership',
        entityId: membership!.id,
        summary: `${input.email} convidado como ${ROLE_LABELS[input.role]}`,
        changes: { role: input.role, permissions: input.permissions },
      });
      return { membershipId: membership!.id, inviteUrl };
    });

    const [tenant] = await db.select({ tradeName: tenants.tradeName }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const email = await sendInviteEmail(input.email, input.name, tenant!.tradeName, input.role, result.inviteUrl, ctx.user.name);
    return reply.status(201).send({ id: result.membershipId, inviteUrl: result.inviteUrl, emailSent: email.sent });
  });

  app.post('/:id/resend-invite', { preHandler: requireTenant('team', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const [row] = await db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, id), eq(memberships.tenantId, ctx.tenantId)));
    if (!row) throw notFound('Membro não encontrado.');
    if (row.membership.status !== 'invited') throw conflict('Este convite já foi aceito.');
    const inviteUrl = await db.transaction(async (tx) => issueInvite(tx, ctx, id, row.user.id));
    const [tenant] = await db.select({ tradeName: tenants.tradeName }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const email = await sendInviteEmail(row.user.email, row.user.name, tenant!.tradeName, row.membership.role, inviteUrl, ctx.user.name);
    return { inviteUrl, emailSent: email.sent };
  });

  app.put('/:id', { preHandler: requireTenant('team', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(updateMemberSchema, request.body);
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.id, id), eq(memberships.tenantId, ctx.tenantId)))
        .for('update');
      if (!target) throw notFound('Membro não encontrado.');
      if (target.id === ctx.membershipId) throw forbidden('Você não pode alterar a sua própria função ou acesso.');
      if (target.role === 'owner' && ctx.role !== 'owner') throw forbidden('Somente o proprietário altera outro proprietário.');
      const allowed = assignableRoles(ctx.role);
      if (!allowed.includes(target.role) || !allowed.includes(input.role)) throw forbidden('Você não pode atribuir esta função.');
      if (input.permissions && ctx.role !== 'owner' && ctx.role !== 'admin') {
        throw forbidden('Somente o proprietário ou administradores personalizam permissões.');
      }
      if (target.role === 'owner' && (input.role !== 'owner' || !input.isActive)) {
        const owners = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.role, 'owner'), eq(memberships.status, 'active')));
        if (owners.length <= 1) throw unprocessable('O estabelecimento precisa de pelo menos um proprietário ativo.');
      }
      const status = target.status === 'invited' ? 'invited' : input.isActive ? 'active' : 'disabled';
      const [updated] = await tx
        .update(memberships)
        .set({ role: input.role, permissions: input.role === 'owner' ? null : input.permissions, status })
        .where(eq(memberships.id, id))
        .returning();
      if (status === 'disabled') {
        // Acesso desativado: encerra as sessões que estavam usando este estabelecimento.
        await tx
          .update(sessions)
          .set({ activeTenantId: null, activeBranchId: null })
          .where(and(eq(sessions.userId, target.userId), eq(sessions.activeTenantId, ctx.tenantId)));
      }
      await audit(tx, request, {
        action: 'team.member_updated',
        entityType: 'membership',
        entityId: id,
        summary: `Acesso de membro atualizado (${ROLE_LABELS[input.role]}${status === 'disabled' ? ', desativado' : ''})`,
        changes: {
          role: { from: target.role, to: input.role },
          permissions: { from: target.permissions, to: updated!.permissions },
          status: { from: target.status, to: status },
        },
      });
      return { ok: true };
    });
  });

  app.delete('/:id', { preHandler: requireTenant('team', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ membership: memberships, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.id, id), eq(memberships.tenantId, ctx.tenantId)));
      if (!target) throw notFound('Membro não encontrado.');
      if (target.membership.id === ctx.membershipId) throw forbidden('Você não pode remover a si mesmo.');
      if (target.membership.role === 'owner') throw forbidden('O proprietário não pode ser removido.');
      if (!assignableRoles(ctx.role).includes(target.membership.role)) throw forbidden();
      await tx.delete(memberships).where(eq(memberships.id, id));
      await tx
        .update(sessions)
        .set({ activeTenantId: null, activeBranchId: null })
        .where(and(eq(sessions.userId, target.membership.userId), eq(sessions.activeTenantId, ctx.tenantId)));
      await audit(tx, request, { action: 'team.member_removed', entityType: 'membership', entityId: id, summary: `${target.email} removido da equipe` });
    });
    return { ok: true };
  });

  app.get('/audit', { preHandler: requireTenant('team', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { auditLogs } = await import('../../db/schema');
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, ctx.tenantId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    return {
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        summary: r.summary,
        actorName: r.actorName,
        entityType: r.entityType,
        createdAt: r.createdAt,
        ip: r.ip,
      })),
    };
  });
}
