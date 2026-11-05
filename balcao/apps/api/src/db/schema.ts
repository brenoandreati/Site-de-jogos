/**
 * Esquema relacional da Fase 1.
 *
 * Regras de isolamento multiempresa:
 * - Toda tabela que pertence a um estabelecimento tem `tenant_id`.
 * - Relacionamentos entre entidades de um estabelecimento usam chave estrangeira COMPOSTA
 *   (tenant_id, id). Assim o próprio banco impede que um produto aponte para a categoria de outra
 *   empresa, ou que um pedido referencie o cliente de outra loja.
 * - Toda consulta da API filtra por tenant_id obtido da sessão (nunca do corpo da requisição).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  FULFILLMENT_TYPES,
  ORDER_CHANNELS,
  ORDER_EVENT_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  ROLES,
  type AddressInput,
  type PermissionOverrides,
} from '@balcao/shared';

const id = () => uuid().primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const roleEnum = pgEnum('member_role', ROLES);
export const memberStatusEnum = pgEnum('member_status', ['invited', 'active', 'disabled']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended']);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const orderChannelEnum = pgEnum('order_channel', ORDER_CHANNELS);
export const fulfillmentEnum = pgEnum('fulfillment_type', FULFILLMENT_TYPES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const orderEventTypeEnum = pgEnum('order_event_type', ORDER_EVENT_TYPES);
export const actorTypeEnum = pgEnum('actor_type', ['customer', 'user', 'system']);
export const authTokenTypeEnum = pgEnum('auth_token_type', ['password_reset', 'invite']);

// ───────────────────────────── Identidade e acesso ─────────────────────────────

export const users = pgTable('users', {
  id: id(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text(),
  isPlatformAdmin: boolean().notNull().default(false),
  lastLoginAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tenants = pgTable('tenants', {
  id: id(),
  slug: text().notNull().unique(),
  tradeName: text().notNull(),
  legalName: text(),
  document: text(),
  documentType: text(),
  email: text(),
  phone: text(),
  whatsapp: text(),
  instagram: text(),
  description: text(),
  logoUrl: text(),
  coverUrl: text(),
  brandColor: text(),
  businessCategories: text().array().notNull().default(sql`'{}'::text[]`),
  status: tenantStatusEnum().notNull().default('active'),
  messageTemplates: jsonb().$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    isPrimary: boolean().notNull().default(false),
    phone: text(),
    whatsapp: text(),
    timezone: text().notNull().default('America/Sao_Paulo'),
    zipCode: text(),
    street: text(),
    number: text(),
    complement: text(),
    neighborhood: text(),
    city: text(),
    state: text(),
    reference: text(),
    acceptsDelivery: boolean().notNull().default(true),
    acceptsPickup: boolean().notNull().default(true),
    acceptsDineIn: boolean().notNull().default(false),
    autoConfirm: boolean().notNull().default(false),
    minOrderCents: integer().notNull().default(0),
    deliveryFeeCents: integer().notNull().default(0),
    freeDeliveryAboveCents: integer(),
    prepTimeMinutes: integer().notNull().default(30),
    deliveryTimeMinutes: integer().notNull().default(30),
    paymentMethods: text()
      .array()
      .notNull()
      .default(sql`'{cash,credit_card,debit_card}'::text[]`),
    pixKey: text(),
    pixKeyType: text(),
    pixHolderName: text(),
    cancellationPolicy: text(),
    isPaused: boolean().notNull().default(false),
    pausedUntil: timestamp({ withTimezone: true }),
    pauseReason: text(),
    orderCounter: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('branches_tenant_id_id_key').on(t.tenantId, t.id),
    uniqueIndex('branches_one_primary_per_tenant').on(t.tenantId).where(sql`${t.isPrimary}`),
    check('branches_fees_non_negative', sql`${t.minOrderCents} >= 0 AND ${t.deliveryFeeCents} >= 0`),
  ],
);

export const openingHours = pgTable(
  'opening_hours',
  {
    id: id(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    weekday: smallint().notNull(),
    opensAt: text().notNull(),
    closesAt: text().notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete('cascade'),
    index('opening_hours_branch_idx').on(t.branchId),
    check('opening_hours_weekday', sql`${t.weekday} BETWEEN 0 AND 6`),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum().notNull(),
    status: memberStatusEnum().notNull().default('active'),
    /** Personalizações por módulo. null = padrão da função. */
    permissions: jsonb().$type<PermissionOverrides>(),
    /** Unidades às quais o membro tem acesso. null = todas. */
    branchIds: uuid().array(),
    invitedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('memberships_tenant_user_key').on(t.tenantId, t.userId), index('memberships_user_idx').on(t.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull().unique(),
    activeTenantId: uuid().references(() => tenants.id, { onDelete: 'set null' }),
    activeBranchId: uuid().references(() => branches.id, { onDelete: 'set null' }),
    ip: text(),
    userAgent: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    type: authTokenTypeEnum().notNull(),
    tokenHash: text().notNull().unique(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid().references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid().references(() => memberships.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('auth_tokens_user_idx').on(t.userId)],
);

// ───────────────────────────── Cardápio ─────────────────────────────

export const categories = pgTable(
  'categories',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    position: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('categories_tenant_id_id_key').on(t.tenantId, t.id), index('categories_tenant_idx').on(t.tenantId, t.position)],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    categoryId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    imageUrl: text(),
    priceCents: integer().notNull(),
    sku: text(),
    prepTimeMinutes: integer(),
    isFeatured: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    isAvailable: boolean().notNull().default(true),
    trackStock: boolean().notNull().default(false),
    stockQuantity: integer(),
    position: integer().notNull().default(0),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('products_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.categoryId], foreignColumns: [categories.tenantId, categories.id] }),
    index('products_tenant_category_idx').on(t.tenantId, t.categoryId, t.position),
    uniqueIndex('products_tenant_sku_key').on(t.tenantId, t.sku).where(sql`${t.sku} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check('products_price_non_negative', sql`${t.priceCents} >= 0`),
    check('products_stock_non_negative', sql`${t.stockQuantity} IS NULL OR ${t.stockQuantity} >= 0`),
  ],
);

export const modifierGroups = pgTable(
  'modifier_groups',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    minSelect: integer().notNull().default(0),
    maxSelect: integer().notNull().default(1),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('modifier_groups_tenant_id_id_key').on(t.tenantId, t.id),
    check('modifier_groups_limits', sql`${t.minSelect} >= 0 AND ${t.maxSelect} >= 1 AND ${t.maxSelect} >= ${t.minSelect}`),
  ],
);

export const modifiers = pgTable(
  'modifiers',
  {
    id: id(),
    tenantId: uuid().notNull(),
    groupId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    priceCents: integer().notNull().default(0),
    maxQuantity: integer().notNull().default(1),
    isAvailable: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.groupId], foreignColumns: [modifierGroups.tenantId, modifierGroups.id] }).onDelete(
      'cascade',
    ),
    index('modifiers_group_idx').on(t.groupId, t.position),
    check('modifiers_price_non_negative', sql`${t.priceCents} >= 0`),
    check('modifiers_max_quantity', sql`${t.maxQuantity} >= 1`),
  ],
);

export const productModifierGroups = pgTable(
  'product_modifier_groups',
  {
    tenantId: uuid().notNull(),
    productId: uuid().notNull(),
    groupId: uuid().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.groupId] }),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.groupId], foreignColumns: [modifierGroups.tenantId, modifierGroups.id] }).onDelete(
      'cascade',
    ),
    index('product_modifier_groups_group_idx').on(t.groupId),
  ],
);

// ───────────────────────────── Clientes ─────────────────────────────

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    phone: text().notNull(),
    email: text(),
    notes: text(),
    ordersCount: integer().notNull().default(0),
    totalSpentCents: integer().notNull().default(0),
    firstOrderAt: timestamp({ withTimezone: true }),
    lastOrderAt: timestamp({ withTimezone: true }),
    /** Consentimento LGPD para receber campanhas (opt-in). null = sem consentimento. */
    marketingOptInAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('customers_tenant_id_id_key').on(t.tenantId, t.id),
    unique('customers_tenant_phone_key').on(t.tenantId, t.phone),
    index('customers_tenant_created_idx').on(t.tenantId, t.createdAt),
  ],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: id(),
    tenantId: uuid().notNull(),
    customerId: uuid().notNull(),
    zipCode: text(),
    street: text().notNull(),
    number: text().notNull(),
    complement: text(),
    neighborhood: text().notNull(),
    city: text().notNull(),
    state: text().notNull(),
    reference: text(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }).onDelete('cascade'),
    index('customer_addresses_customer_idx').on(t.customerId),
  ],
);

// ───────────────────────────── Pedidos ─────────────────────────────

export type OrderAddress = {
  zipCode: string | null;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: AddressInput['state'];
  reference: string | null;
};

export const orders = pgTable(
  'orders',
  {
    id: id(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    number: integer().notNull(),
    publicToken: text().notNull().unique(),
    idempotencyKey: uuid().notNull(),
    channel: orderChannelEnum().notNull(),
    fulfillment: fulfillmentEnum().notNull(),
    status: orderStatusEnum().notNull(),
    paymentMethod: paymentMethodEnum().notNull(),
    paymentStatus: paymentStatusEnum().notNull().default('pending'),
    customerId: uuid(),
    customerName: text().notNull(),
    customerPhone: text(),
    address: jsonb().$type<OrderAddress>(),
    tableNumber: text(),
    changeForCents: integer(),
    subtotalCents: integer().notNull(),
    discountCents: integer().notNull().default(0),
    discountReason: text(),
    deliveryFeeCents: integer().notNull().default(0),
    totalCents: integer().notNull(),
    notes: text(),
    cancelReason: text(),
    prepTimeMinutes: integer().notNull(),
    deliveryTimeMinutes: integer().notNull().default(0),
    stockReserved: boolean().notNull().default(false),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    duplicatedFromOrderId: uuid(),
    version: integer().notNull().default(1),
    confirmedAt: timestamp({ withTimezone: true }),
    preparingAt: timestamp({ withTimezone: true }),
    readyAt: timestamp({ withTimezone: true }),
    dispatchedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    canceledAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('orders_tenant_id_id_key').on(t.tenantId, t.id),
    unique('orders_tenant_idempotency_key').on(t.tenantId, t.idempotencyKey),
    unique('orders_branch_number_key').on(t.branchId, t.number),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }),
    foreignKey({ columns: [t.tenantId, t.duplicatedFromOrderId], foreignColumns: [t.tenantId, t.id] }),
    index('orders_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('orders_branch_status_idx').on(t.branchId, t.status),
    index('orders_customer_idx').on(t.customerId),
    check(
      'orders_amounts_valid',
      sql`${t.subtotalCents} >= 0 AND ${t.discountCents} >= 0 AND ${t.deliveryFeeCents} >= 0 AND ${t.discountCents} <= ${t.subtotalCents} AND ${t.totalCents} = ${t.subtotalCents} - ${t.discountCents} + ${t.deliveryFeeCents}`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    tenantId: uuid().notNull(),
    orderId: uuid().notNull(),
    productId: uuid(),
    categoryId: uuid(),
    productName: text().notNull(),
    categoryName: text(),
    basePriceCents: integer().notNull(),
    unitPriceCents: integer().notNull(),
    quantity: integer().notNull(),
    totalCents: integer().notNull(),
    notes: text(),
    position: integer().notNull().default(0),
  },
  (t) => [
    unique('order_items_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }),
    index('order_items_order_idx').on(t.orderId),
    index('order_items_product_idx').on(t.tenantId, t.productId),
    check('order_items_amounts', sql`${t.quantity} > 0 AND ${t.totalCents} = ${t.unitPriceCents} * ${t.quantity}`),
  ],
);

export const orderItemModifiers = pgTable(
  'order_item_modifiers',
  {
    id: id(),
    tenantId: uuid().notNull(),
    orderItemId: uuid().notNull(),
    modifierId: uuid().references(() => modifiers.id, { onDelete: 'set null' }),
    groupName: text().notNull(),
    name: text().notNull(),
    priceCents: integer().notNull(),
    quantity: integer().notNull(),
    totalCents: integer().notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.orderItemId], foreignColumns: [orderItems.tenantId, orderItems.id] }).onDelete(
      'cascade',
    ),
    index('order_item_modifiers_item_idx').on(t.orderItemId),
  ],
);

/** Histórico de cada pedido: mudanças de status, edições, descontos, observações. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    tenantId: uuid().notNull(),
    orderId: uuid().notNull(),
    type: orderEventTypeEnum().notNull(),
    fromStatus: orderStatusEnum(),
    toStatus: orderStatusEnum(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    actorType: actorTypeEnum().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    actorName: text(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    index('order_events_order_idx').on(t.orderId, t.createdAt),
    index('order_events_tenant_created_idx').on(t.tenantId, t.createdAt),
  ],
);

// ───────────────────────────── Plataforma ─────────────────────────────

export const uploads = pgTable(
  'uploads',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    path: text().notNull().unique(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('uploads_tenant_idx').on(t.tenantId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: uuid().references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    actorName: text(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    summary: text(),
    changes: jsonb().$type<Record<string, unknown>>(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt)],
);
