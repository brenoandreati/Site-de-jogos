import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { PricingProduct } from '@balcao/shared';
import type { DbExecutor } from '../../db/client';
import { categories, modifierGroups, modifiers, productModifierGroups, products } from '../../db/schema';

export type ProductRow = typeof products.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;

export interface CatalogGroup {
  id: string;
  name: string;
  description: string | null;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    maxQuantity: number;
    isAvailable: boolean;
  }[];
}

/** Disponibilidade efetiva de um produto (inclui esgotado por estoque). */
export function isProductAvailable(p: Pick<ProductRow, 'isAvailable' | 'isActive' | 'trackStock' | 'stockQuantity' | 'deletedAt'>) {
  if (!p.isActive || p.deletedAt || !p.isAvailable) return false;
  if (p.trackStock && (p.stockQuantity ?? 0) <= 0) return false;
  return true;
}

export async function loadGroups(db: DbExecutor, tenantId: string, groupIds?: string[]): Promise<Map<string, CatalogGroup>> {
  const groupRows = await db
    .select()
    .from(modifierGroups)
    .where(and(eq(modifierGroups.tenantId, tenantId), groupIds ? inArray(modifierGroups.id, groupIds) : undefined))
    .orderBy(asc(modifierGroups.name));
  const ids = groupRows.map((g) => g.id);
  const optionRows = ids.length
    ? await db
        .select()
        .from(modifiers)
        .where(and(eq(modifiers.tenantId, tenantId), inArray(modifiers.groupId, ids)))
        .orderBy(asc(modifiers.position), asc(modifiers.createdAt))
    : [];
  const map = new Map<string, CatalogGroup>();
  for (const g of groupRows) {
    map.set(g.id, {
      id: g.id,
      name: g.name,
      description: g.description,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      isActive: g.isActive,
      options: [],
    });
  }
  for (const o of optionRows) {
    map.get(o.groupId)?.options.push({
      id: o.id,
      name: o.name,
      description: o.description,
      priceCents: o.priceCents,
      maxQuantity: o.maxQuantity,
      isAvailable: o.isAvailable,
    });
  }
  return map;
}

export async function loadProductGroupLinks(db: DbExecutor, tenantId: string, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, string[]>();
  const rows = await db
    .select()
    .from(productModifierGroups)
    .where(and(eq(productModifierGroups.tenantId, tenantId), inArray(productModifierGroups.productId, productIds)))
    .orderBy(asc(productModifierGroups.position));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.productId) ?? [];
    list.push(r.groupId);
    map.set(r.productId, list);
  }
  return map;
}

export function serializeProduct(p: ProductRow, groupIds: string[]) {
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    priceCents: p.priceCents,
    sku: p.sku,
    prepTimeMinutes: p.prepTimeMinutes,
    isFeatured: p.isFeatured,
    isActive: p.isActive,
    isAvailable: p.isAvailable,
    trackStock: p.trackStock,
    stockQuantity: p.stockQuantity,
    isSoldOut: p.trackStock && (p.stockQuantity ?? 0) <= 0,
    position: p.position,
    modifierGroupIds: groupIds,
    updatedAt: p.updatedAt,
  };
}

/** Catálogo completo para o painel (inclui inativos). */
export async function loadAdminCatalog(db: DbExecutor, tenantId: string) {
  const cats = await db
    .select()
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), isNull(categories.deletedAt)))
    .orderBy(asc(categories.position), asc(categories.createdAt));
  const prods = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt)))
    .orderBy(asc(products.position), asc(products.createdAt));
  const links = await loadProductGroupLinks(db, tenantId, prods.map((p) => p.id));
  const groups = await loadGroups(db, tenantId);

  const usage = new Map<string, number>();
  for (const ids of links.values()) for (const id of ids) usage.set(id, (usage.get(id) ?? 0) + 1);

  return {
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      position: c.position,
      isActive: c.isActive,
      products: prods.filter((p) => p.categoryId === c.id).map((p) => serializeProduct(p, links.get(p.id) ?? [])),
    })),
    modifierGroups: [...groups.values()].map((g) => ({ ...g, productCount: usage.get(g.id) ?? 0 })),
  };
}

/** Catálogo público: somente categorias e produtos ativos, grupos ativos. Esgotados aparecem marcados. */
export async function loadPublicCatalog(db: DbExecutor, tenantId: string) {
  const cats = await db
    .select()
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.isActive, true), isNull(categories.deletedAt)))
    .orderBy(asc(categories.position), asc(categories.createdAt));
  const catIds = cats.map((c) => c.id);
  const prods = catIds.length
    ? await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            isNull(products.deletedAt),
            eq(products.isActive, true),
            inArray(products.categoryId, catIds),
          ),
        )
        .orderBy(asc(products.position), asc(products.createdAt))
    : [];
  const links = await loadProductGroupLinks(db, tenantId, prods.map((p) => p.id));
  const groups = await loadGroups(db, tenantId);

  const toPublicProduct = (p: ProductRow) => ({
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    priceCents: p.priceCents,
    isFeatured: p.isFeatured,
    isAvailable: isProductAvailable(p),
    groups: (links.get(p.id) ?? [])
      .map((id) => groups.get(id))
      .filter((g): g is CatalogGroup => !!g && g.isActive && g.options.length > 0)
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        options: g.options.map((o) => ({
          id: o.id,
          name: o.name,
          description: o.description,
          priceCents: o.priceCents,
          maxQuantity: o.maxQuantity,
          isAvailable: o.isAvailable,
        })),
      })),
  });

  return cats
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      products: prods.filter((p) => p.categoryId === c.id).map(toPublicProduct),
    }))
    .filter((c) => c.products.length > 0);
}

/**
 * Produtos no formato do cálculo de preço, lidos do banco (fonte oficial).
 * `forStaff` permite que a equipe lance produtos pausados manualmente? Não: a disponibilidade vale para todos,
 * mas produtos inativos/excluídos nunca entram.
 */
export async function loadPricingProducts(db: DbExecutor, tenantId: string, productIds: string[]) {
  const unique = [...new Set(productIds)];
  const result = new Map<string, { pricing: PricingProduct; row: ProductRow; categoryName: string | null }>();
  if (unique.length === 0) return result;
  const rows = await db
    .select({ product: products, categoryName: categories.name, categoryActive: categories.isActive })
    .from(products)
    .innerJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.tenantId, products.tenantId)))
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, unique), isNull(products.deletedAt)));
  const links = await loadProductGroupLinks(db, tenantId, rows.map((r) => r.product.id));
  const allGroupIds = [...new Set([...links.values()].flat())];
  const groups = await loadGroups(db, tenantId, allGroupIds.length ? allGroupIds : ['00000000-0000-0000-0000-000000000000']);

  for (const { product: p, categoryName, categoryActive } of rows) {
    const productGroups = (links.get(p.id) ?? [])
      .map((id) => groups.get(id))
      .filter((g): g is CatalogGroup => !!g && g.isActive && g.options.length > 0);
    result.set(p.id, {
      row: p,
      categoryName,
      pricing: {
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
        isAvailable: isProductAvailable(p) && categoryActive,
        groups: productGroups.map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          modifiers: g.options.map((o) => ({
            id: o.id,
            name: o.name,
            priceCents: o.priceCents,
            maxQuantity: o.maxQuantity,
            isAvailable: o.isAvailable,
          })),
        })),
      },
    });
  }
  return result;
}
