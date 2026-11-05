import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  categorySchema,
  modifierGroupSchema,
  productAvailabilitySchema,
  productSchema,
  reorderSchema,
} from '@balcao/shared';
import { categories, modifierGroups, modifiers, productModifierGroups, products } from '../../db/schema';
import type { DbExecutor } from '../../db/client';
import { audit, diff } from '../../lib/audit';
import { conflict, isUniqueViolation, notFound, parse, unprocessable } from '../../lib/errors';
import { requireTenant, tenantCtx } from '../../plugins/context';
import { publishEvent } from '../../services/events';
import { loadAdminCatalog, loadGroups, loadProductGroupLinks, serializeProduct } from './service';

const idParam = z.object({ id: z.uuid('Identificador inválido') });

export async function catalogRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', { preHandler: requireTenant('catalog', 'view') }, async (request) => {
    return loadAdminCatalog(db, tenantCtx(request).tenantId);
  });

  // ─── Categorias ───

  app.post('/categories', { preHandler: requireTenant('catalog', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const input = parse(categorySchema, request.body);
    const category = await db.transaction(async (tx) => {
      const [{ value } = { value: null }] = await tx
        .select({ value: max(categories.position) })
        .from(categories)
        .where(and(eq(categories.tenantId, ctx.tenantId), isNull(categories.deletedAt)));
      const [row] = await tx
        .insert(categories)
        .values({ ...input, tenantId: ctx.tenantId, position: (value ?? -1) + 1 })
        .returning();
      await audit(tx, request, { action: 'catalog.category_created', entityType: 'category', entityId: row!.id, summary: `Categoria "${row!.name}" criada` });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
      return row!;
    });
    return reply.status(201).send(category);
  });

  app.put('/categories/:id', { preHandler: requireTenant('catalog', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(categorySchema, request.body);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenantId), isNull(categories.deletedAt)));
      if (!before) throw notFound('Categoria não encontrada.');
      const [row] = await tx
        .update(categories)
        .set(input)
        .where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenantId)))
        .returning();
      await audit(tx, request, {
        action: 'catalog.category_updated',
        entityType: 'category',
        entityId: id,
        summary: `Categoria "${row!.name}" atualizada`,
        changes: diff(before as unknown as Record<string, unknown>, input),
      });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
      return row;
    });
  });

  app.delete('/categories/:id', { preHandler: requireTenant('catalog', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    await db.transaction(async (tx) => {
      const [category] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenantId), isNull(categories.deletedAt)));
      if (!category) throw notFound('Categoria não encontrada.');
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.categoryId, id), isNull(products.deletedAt)));
      if (count > 0) {
        throw conflict(`Esta categoria tem ${count} produto(s). Mova ou exclua os produtos antes.`, 'category_not_empty');
      }
      // Exclusão lógica: produtos já excluídos continuam ligados à categoria para o histórico de pedidos.
      await tx
        .update(categories)
        .set({ deletedAt: new Date(), isActive: false })
        .where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenantId)));
      await audit(tx, request, { action: 'catalog.category_deleted', entityType: 'category', entityId: id, summary: `Categoria "${category.name}" excluída` });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
    });
    return { ok: true };
  });

  app.post('/categories/reorder', { preHandler: requireTenant('catalog', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { ids } = parse(reorderSchema, request.body);
    await db.transaction(async (tx) => {
      await ensureAllBelong(tx, 'categories', ctx.tenantId, ids);
      for (const [position, id] of ids.entries()) {
        await tx.update(categories).set({ position }).where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenantId)));
      }
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
    });
    return { ok: true };
  });

  // ─── Produtos ───

  app.get('/products/:id', { preHandler: requireTenant('catalog', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)));
    if (!row) throw notFound('Produto não encontrado.');
    const links = await loadProductGroupLinks(db, ctx.tenantId, [id]);
    return serializeProduct(row, links.get(id) ?? []);
  });

  app.post('/products', { preHandler: requireTenant('catalog', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const input = parse(productSchema, request.body);
    const { modifierGroupIds, ...values } = input;
    try {
      const product = await db.transaction(async (tx) => {
        await ensureCategory(tx, ctx.tenantId, values.categoryId);
        await ensureAllBelong(tx, 'modifier_groups', ctx.tenantId, modifierGroupIds);
        const [{ value } = { value: null }] = await tx
          .select({ value: max(products.position) })
          .from(products)
          .where(and(eq(products.tenantId, ctx.tenantId), eq(products.categoryId, values.categoryId)));
        const [row] = await tx
          .insert(products)
          .values({ ...values, stockQuantity: values.trackStock ? values.stockQuantity : null, tenantId: ctx.tenantId, position: (value ?? -1) + 1 })
          .returning();
        await setProductGroups(tx, ctx.tenantId, row!.id, modifierGroupIds);
        await audit(tx, request, { action: 'catalog.product_created', entityType: 'product', entityId: row!.id, summary: `Produto "${row!.name}" criado` });
        await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
        return serializeProduct(row!, modifierGroupIds);
      });
      return reply.status(201).send(product);
    } catch (err) {
      if (isUniqueViolation(err, 'products_tenant_sku_key')) throw unprocessable('Já existe um produto com este código.', { sku: 'Código em uso' });
      throw err;
    }
  });

  app.put('/products/:id', { preHandler: requireTenant('catalog', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(productSchema, request.body);
    const { modifierGroupIds, ...values } = input;
    try {
      return await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)));
        if (!before) throw notFound('Produto não encontrado.');
        await ensureCategory(tx, ctx.tenantId, values.categoryId);
        await ensureAllBelong(tx, 'modifier_groups', ctx.tenantId, modifierGroupIds);
        const update = { ...values, stockQuantity: values.trackStock ? values.stockQuantity : null };
        const [row] = await tx
          .update(products)
          .set(update)
          .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)))
          .returning();
        await setProductGroups(tx, ctx.tenantId, id, modifierGroupIds);
        await audit(tx, request, {
          action: 'catalog.product_updated',
          entityType: 'product',
          entityId: id,
          summary: `Produto "${row!.name}" atualizado`,
          changes: diff(before as unknown as Record<string, unknown>, update),
        });
        await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
        return serializeProduct(row!, modifierGroupIds);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'products_tenant_sku_key')) throw unprocessable('Já existe um produto com este código.', { sku: 'Código em uso' });
      throw err;
    }
  });

  app.patch('/products/:id/availability', { preHandler: requireTenant('catalog', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const { isAvailable } = parse(productAvailabilitySchema, request.body);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(products)
        .set({ isAvailable })
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)))
        .returning();
      if (!row) throw notFound('Produto não encontrado.');
      await audit(tx, request, {
        action: 'catalog.product_availability',
        entityType: 'product',
        entityId: id,
        summary: `"${row.name}" ${isAvailable ? 'disponível' : 'pausado'}`,
      });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
      const links = await loadProductGroupLinks(tx, ctx.tenantId, [id]);
      return serializeProduct(row, links.get(id) ?? []);
    });
  });

  app.post('/products/:id/duplicate', { preHandler: requireTenant('catalog', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const product = await db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)));
      if (!source) throw notFound('Produto não encontrado.');
      const links = await loadProductGroupLinks(tx, ctx.tenantId, [id]);
      const groupIds = links.get(id) ?? [];
      const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = source;
      const [row] = await tx
        .insert(products)
        .values({ ...rest, name: `${source.name} (cópia)`.slice(0, 80), sku: null, isActive: false, position: source.position + 1 })
        .returning();
      await setProductGroups(tx, ctx.tenantId, row!.id, groupIds);
      await audit(tx, request, { action: 'catalog.product_duplicated', entityType: 'product', entityId: row!.id, summary: `Produto "${source.name}" duplicado (cópia criada inativa)` });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
      return serializeProduct(row!, groupIds);
    });
    return reply.status(201).send(product);
  });

  app.delete('/products/:id', { preHandler: requireTenant('catalog', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    await db.transaction(async (tx) => {
      // Exclusão lógica: o produto some do cardápio, mas o histórico de pedidos continua íntegro.
      const [row] = await tx
        .update(products)
        .set({ deletedAt: new Date(), isActive: false, sku: null })
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)))
        .returning();
      if (!row) throw notFound('Produto não encontrado.');
      await tx
        .delete(productModifierGroups)
        .where(and(eq(productModifierGroups.tenantId, ctx.tenantId), eq(productModifierGroups.productId, id)));
      await audit(tx, request, { action: 'catalog.product_deleted', entityType: 'product', entityId: id, summary: `Produto "${row.name}" excluído` });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
    });
    return { ok: true };
  });

  app.post('/products/reorder', { preHandler: requireTenant('catalog', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { ids } = parse(reorderSchema, request.body);
    await db.transaction(async (tx) => {
      await ensureAllBelong(tx, 'products', ctx.tenantId, ids);
      for (const [position, id] of ids.entries()) {
        await tx.update(products).set({ position }).where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)));
      }
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
    });
    return { ok: true };
  });

  // ─── Grupos de adicionais ───

  app.get('/modifier-groups/:id', { preHandler: requireTenant('catalog', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const group = (await loadGroups(db, ctx.tenantId, [id])).get(id);
    if (!group) throw notFound('Grupo não encontrado.');
    return group;
  });

  app.post('/modifier-groups', { preHandler: requireTenant('catalog', 'edit') }, async (request, reply) => {
    const ctx = tenantCtx(request);
    const input = parse(modifierGroupSchema, request.body);
    const group = await db.transaction(async (tx) => {
      const { options, ...values } = input;
      const [row] = await tx.insert(modifierGroups).values({ ...values, tenantId: ctx.tenantId }).returning();
      await tx.insert(modifiers).values(
        options.map((o, position) => ({
          tenantId: ctx.tenantId,
          groupId: row!.id,
          name: o.name,
          description: o.description,
          priceCents: o.priceCents,
          maxQuantity: o.maxQuantity,
          isAvailable: o.isAvailable,
          position,
        })),
      );
      await audit(tx, request, { action: 'catalog.group_created', entityType: 'modifier_group', entityId: row!.id, summary: `Grupo de adicionais "${row!.name}" criado` });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
      return (await loadGroups(tx, ctx.tenantId, [row!.id])).get(row!.id);
    });
    return reply.status(201).send(group);
  });

  app.put('/modifier-groups/:id', { preHandler: requireTenant('catalog', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    const input = parse(modifierGroupSchema, request.body);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(modifierGroups)
        .where(and(eq(modifierGroups.id, id), eq(modifierGroups.tenantId, ctx.tenantId)));
      if (!before) throw notFound('Grupo não encontrado.');
      const { options, ...values } = input;
      await tx.update(modifierGroups).set(values).where(and(eq(modifierGroups.id, id), eq(modifierGroups.tenantId, ctx.tenantId)));

      const existing = await tx
        .select({ id: modifiers.id })
        .from(modifiers)
        .where(and(eq(modifiers.tenantId, ctx.tenantId), eq(modifiers.groupId, id)));
      const existingIds = new Set(existing.map((e) => e.id));
      const keep = new Set<string>();
      for (const [position, o] of options.entries()) {
        const data = {
          name: o.name,
          description: o.description,
          priceCents: o.priceCents,
          maxQuantity: o.maxQuantity,
          isAvailable: o.isAvailable,
          position,
        };
        if (o.id && existingIds.has(o.id)) {
          keep.add(o.id);
          await tx.update(modifiers).set(data).where(and(eq(modifiers.id, o.id), eq(modifiers.tenantId, ctx.tenantId)));
        } else {
          await tx.insert(modifiers).values({ ...data, tenantId: ctx.tenantId, groupId: id });
        }
      }
      const removed = [...existingIds].filter((x) => !keep.has(x));
      if (removed.length) {
        await tx.delete(modifiers).where(and(eq(modifiers.tenantId, ctx.tenantId), inArray(modifiers.id, removed)));
      }
      await audit(tx, request, {
        action: 'catalog.group_updated',
        entityType: 'modifier_group',
        entityId: id,
        summary: `Grupo de adicionais "${values.name}" atualizado`,
        changes: { ...diff(before as unknown as Record<string, unknown>, values), optionsRemoved: removed.length },
      });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
      return (await loadGroups(tx, ctx.tenantId, [id])).get(id);
    });
  });

  app.delete('/modifier-groups/:id', { preHandler: requireTenant('catalog', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { id } = parse(idParam, request.params);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(modifierGroups)
        .where(and(eq(modifierGroups.id, id), eq(modifierGroups.tenantId, ctx.tenantId)))
        .returning();
      if (!row) throw notFound('Grupo não encontrado.');
      await audit(tx, request, { action: 'catalog.group_deleted', entityType: 'modifier_group', entityId: id, summary: `Grupo de adicionais "${row.name}" excluído` });
      await publishEvent(tx, ctx.tenantId, { type: 'catalog.updated' });
    });
    return { ok: true };
  });
}

async function ensureCategory(tx: DbExecutor, tenantId: string, categoryId: string) {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId), isNull(categories.deletedAt)));
  if (!row) throw unprocessable('Categoria inválida.', { categoryId: 'Escolha uma categoria' });
}

async function ensureAllBelong(tx: DbExecutor, table: 'categories' | 'products' | 'modifier_groups', tenantId: string, ids: string[]) {
  if (ids.length === 0) return;
  const t = table === 'categories' ? categories : table === 'products' ? products : modifierGroups;
  const rows = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), inArray(t.id, ids)));
  if (rows.length !== new Set(ids).size) throw unprocessable('Um ou mais itens não pertencem a este estabelecimento.');
}

async function setProductGroups(tx: DbExecutor, tenantId: string, productId: string, groupIds: string[]) {
  await tx
    .delete(productModifierGroups)
    .where(and(eq(productModifierGroups.tenantId, tenantId), eq(productModifierGroups.productId, productId)));
  if (groupIds.length) {
    await tx
      .insert(productModifierGroups)
      .values(groupIds.map((groupId, position) => ({ tenantId, productId, groupId, position })));
  }
}
