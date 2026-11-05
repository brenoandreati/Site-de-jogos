import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { uploads } from '../../db/schema';
import { AppError, unprocessable } from '../../lib/errors';
import { requireTenant, tenantCtx } from '../../plugins/context';
import { sniffImageType } from '../../services/storage';

export async function uploadRoutes(app: FastifyInstance) {
  app.post(
    '/images',
    { preHandler: requireTenant(), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const ctx = tenantCtx(request);
      const canUpload = ['catalog', 'settings'].some((m) => ctx.permissions[m as 'catalog'] === 'edit' || ctx.permissions[m as 'catalog'] === 'manage');
      if (!canUpload) throw new AppError(403, 'forbidden', 'Você não tem permissão para enviar imagens.');
      if (!request.isMultipart()) throw unprocessable('Envie a imagem como arquivo.');

      const file = await request.file();
      if (!file) throw unprocessable('Nenhuma imagem recebida.');
      const buffer = await file.toBuffer();
      if (file.file.truncated) throw new AppError(413, 'file_too_large', 'A imagem deve ter no máximo 5 MB.');
      const type = sniffImageType(buffer);
      if (!type) throw unprocessable('Formato não suportado. Use JPG, PNG ou WEBP.');

      const key = `${ctx.tenantId}/${randomUUID()}.${type.ext}`;
      const { url } = await app.storage.put(key, buffer, type.mime);
      await app.db.insert(uploads).values({
        tenantId: ctx.tenantId,
        path: key,
        contentType: type.mime,
        sizeBytes: buffer.length,
        createdByUserId: ctx.user.id,
      });
      return reply.status(201).send({ url });
    },
  );
}
