import type { FastifyInstance } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  ROLE_LABELS,
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  updateProfileSchema,
} from '@balcao/shared';
import { authTokens, branches, memberships, sessions, tenants, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { AppError, conflict, isUniqueViolation, notFound, parse, unauthorized, unprocessable } from '../../lib/errors';
import { requireUser, resolveTenantContext, sessionCtx } from '../../plugins/context';
import { buildMe, clearSessionCookie, createSession, revokeUserSessions } from './service';

const RESET_TTL_MS = 60 * 60 * 1000;
const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export async function authRoutes(app: FastifyInstance) {
  const db = app.db;

  app.post('/signup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parse(signupSchema, request.body);

    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existingUser) {
      throw unprocessable('Já existe uma conta com este e-mail. Entre ou recupere a senha.', {
        email: 'E-mail já cadastrado',
      }, 'email_taken');
    }
    const [existingSlug] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug));
    if (existingSlug) {
      throw unprocessable('Este endereço já está em uso. Escolha outro.', { slug: 'Endereço em uso' }, 'slug_taken');
    }

    const passwordHash = await hashPassword(input.password);
    let created: { userId: string; tenantId: string };
    try {
      created = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, name: input.name, passwordHash, lastLoginAt: new Date() })
          .returning({ id: users.id });
        const [tenant] = await tx
          .insert(tenants)
          .values({
            slug: input.slug,
            tradeName: input.storeName,
            whatsapp: input.whatsapp,
            businessCategories: [input.businessCategory],
          })
          .returning({ id: tenants.id });
        await tx.insert(branches).values({
          tenantId: tenant!.id,
          name: input.storeName,
          isPrimary: true,
          whatsapp: input.whatsapp,
        });
        await tx.insert(memberships).values({ tenantId: tenant!.id, userId: user!.id, role: 'owner', status: 'active' });
        return { userId: user!.id, tenantId: tenant!.id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('E-mail ou endereço da loja já cadastrados.');
      throw err;
    }

    const sessionId = await createSession(request, reply, created.userId, created.tenantId);
    const session = await loadFreshSession(app, sessionId, created.userId, created.tenantId);
    request.sessionCtx = session;
    await audit(db, request, {
      tenantId: created.tenantId,
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: created.tenantId,
      summary: `Estabelecimento ${input.storeName} criado por ${input.email}`,
    });
    return reply.status(201).send(await buildMe(request, session));
  });

  app.post('/login', { config: strictLimit }, async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const [user] = await db.select().from(users).where(eq(users.email, input.email));
    const valid = await verifyPassword(input.password, user?.passwordHash);
    if (!user || !valid) {
      throw new AppError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const sessionId = await createSession(request, reply, user.id, null);
    const session = await loadFreshSession(app, sessionId, user.id, null);
    request.sessionCtx = session;
    await audit(db, request, { tenantId: null, action: 'auth.login', entityType: 'user', entityId: user.id });
    return buildMe(request, session);
  });

  app.post('/logout', async (request, reply) => {
    if (request.sessionCtx) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, request.sessionCtx.sessionId));
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireUser }, async (request) => buildMe(request, sessionCtx(request)));

  app.post('/switch-tenant', { preHandler: requireUser }, async (request) => {
    const { tenantId } = parse(z.object({ tenantId: z.uuid() }), request.body);
    const session = sessionCtx(request);
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, session.user.id), eq(memberships.tenantId, tenantId), eq(memberships.status, 'active')));
    if (!membership) throw notFound('Estabelecimento não encontrado.');
    await db.update(sessions).set({ activeTenantId: tenantId, activeBranchId: null }).where(eq(sessions.id, session.sessionId));
    session.activeTenantId = tenantId;
    session.activeBranchId = null;
    return buildMe(request, session);
  });

  app.post('/switch-branch', { preHandler: requireUser }, async (request) => {
    const { branchId } = parse(z.object({ branchId: z.uuid() }), request.body);
    const session = sessionCtx(request);
    const ctx = await resolveTenantContext(request, session);
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.tenantId, ctx.tenantId)));
    if (!branch) throw notFound('Unidade não encontrada.');
    await db.update(sessions).set({ activeBranchId: branchId }).where(eq(sessions.id, session.sessionId));
    session.activeBranchId = branchId;
    return buildMe(request, session);
  });

  app.put('/profile', { preHandler: requireUser }, async (request) => {
    const input = parse(updateProfileSchema, request.body);
    const session = sessionCtx(request);
    await db.update(users).set({ name: input.name }).where(eq(users.id, session.user.id));
    session.user.name = input.name;
    return buildMe(request, session);
  });

  app.put('/password', { preHandler: requireUser, config: strictLimit }, async (request) => {
    const input = parse(changePasswordSchema, request.body);
    const session = sessionCtx(request);
    const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw unprocessable('Senha atual incorreta.', { currentPassword: 'Senha atual incorreta' });
    }
    await db.update(users).set({ passwordHash: await hashPassword(input.newPassword) }).where(eq(users.id, user.id));
    // Encerra as outras sessões abertas desta conta.
    await revokeUserSessions(db, user.id, session.sessionId);
    await audit(db, request, { tenantId: null, action: 'auth.password_changed', entityType: 'user', entityId: user.id });
    return { ok: true };
  });

  app.post('/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request) => {
    const input = parse(forgotPasswordSchema, request.body);
    if (app.config.NODE_ENV === 'production' && !app.mailer.configured) {
      throw new AppError(503, 'email_not_configured', 'Recuperação de senha indisponível: o envio de e-mails não está configurado.');
    }
    const [user] = await db.select().from(users).where(eq(users.email, input.email));
    // A resposta é sempre a mesma para não revelar quais e-mails têm conta.
    if (user?.passwordHash) {
      const token = randomToken(32);
      await db.insert(authTokens).values({
        type: 'password_reset',
        tokenHash: sha256(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      });
      const link = `${app.config.APP_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
      await app.mailer.send({
        to: user.email,
        subject: 'Redefinição de senha',
        text: `Olá, ${user.name}.\n\nRecebemos um pedido para redefinir sua senha. Use o link abaixo (válido por 1 hora):\n\n${link}\n\nSe não foi você, ignore esta mensagem.`,
      });
    }
    return { ok: true };
  });

  app.post('/reset-password', { config: strictLimit }, async (request) => {
    const input = parse(resetPasswordSchema, request.body);
    const [token] = await db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, sha256(input.token)),
          eq(authTokens.type, 'password_reset'),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      );
    if (!token?.userId) throw unprocessable('Link inválido ou expirado. Peça um novo.', undefined, 'invalid_token');
    await db.transaction(async (tx) => {
      // Marca como usado de forma atômica (impede uso duplo em requisições simultâneas).
      const used = await tx
        .update(authTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(authTokens.id, token.id), isNull(authTokens.usedAt)))
        .returning({ id: authTokens.id });
      if (used.length === 0) throw unprocessable('Link já utilizado.', undefined, 'invalid_token');
      await tx.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, token.userId!));
    });
    await revokeUserSessions(db, token.userId);
    await audit(db, request, { tenantId: null, action: 'auth.password_reset', entityType: 'user', entityId: token.userId });
    return { ok: true };
  });

  // ─── Convites ───

  app.get('/invites/:token', { config: strictLimit }, async (request) => {
    const { token } = request.params as { token: string };
    const invite = await findInvite(app, token);
    return {
      tenantName: invite.tenantName,
      email: invite.email,
      role: invite.role,
      roleLabel: ROLE_LABELS[invite.role],
      name: invite.userName,
      needsPassword: !invite.hasPassword,
    };
  });

  app.post('/invites/accept', { config: strictLimit }, async (request, reply) => {
    const input = parse(acceptInviteSchema, request.body);
    const invite = await findInvite(app, input.token);
    if (!invite.hasPassword && !input.password) {
      throw unprocessable('Crie uma senha para acessar.', { password: 'Crie uma senha' });
    }
    await db.transaction(async (tx) => {
      const used = await tx
        .update(authTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(authTokens.id, invite.tokenId), isNull(authTokens.usedAt)))
        .returning({ id: authTokens.id });
      if (used.length === 0) throw unprocessable('Convite já utilizado.', undefined, 'invalid_token');
      if (!invite.hasPassword) {
        await tx
          .update(users)
          .set({ passwordHash: await hashPassword(input.password!), ...(input.name ? { name: input.name } : {}) })
          .where(eq(users.id, invite.userId));
      }
      await tx.update(memberships).set({ status: 'active' }).where(eq(memberships.id, invite.membershipId));
    });
    await audit(db, request, {
      tenantId: invite.tenantId,
      action: 'team.invite_accepted',
      entityType: 'membership',
      entityId: invite.membershipId,
      summary: `${invite.email} aceitou o convite`,
    });

    // Quem acabou de criar a senha entra direto. Quem já tinha conta faz login normalmente.
    if (!invite.hasPassword) {
      await createSession(request, reply, invite.userId, invite.tenantId);
      return { ok: true, loggedIn: true };
    }
    return { ok: true, loggedIn: false };
  });
}

async function findInvite(app: FastifyInstance, token: string) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw unprocessable('Convite inválido.', undefined, 'invalid_token');
  }
  const [row] = await app.db
    .select({
      tokenId: authTokens.id,
      membershipId: memberships.id,
      tenantId: tenants.id,
      tenantName: tenants.tradeName,
      role: memberships.role,
      membershipStatus: memberships.status,
      userId: users.id,
      email: users.email,
      userName: users.name,
      passwordHash: users.passwordHash,
    })
    .from(authTokens)
    .innerJoin(memberships, eq(memberships.id, authTokens.membershipId))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.type, 'invite'),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    );
  if (!row || row.membershipStatus !== 'invited') {
    throw unprocessable('Convite inválido, expirado ou já utilizado.', undefined, 'invalid_token');
  }
  return { ...row, hasPassword: !!row.passwordHash };
}

async function loadFreshSession(app: FastifyInstance, sessionId: string, userId: string, tenantId: string | null) {
  const [user] = await app.db.select().from(users).where(eq(users.id, userId));
  if (!user) throw unauthorized();
  return {
    sessionId,
    activeTenantId: tenantId,
    activeBranchId: null,
    user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin },
  };
}
