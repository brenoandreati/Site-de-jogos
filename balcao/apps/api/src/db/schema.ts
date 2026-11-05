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
  CONVERSATION_MODES,
  CONVERSATION_STATUSES,
  COURIER_STATUSES,
  DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_SENDERS,
  MESSAGE_STATUSES,
  MESSAGE_TYPES,
  PAYMENT_TRANSACTION_STATUSES,
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
    tags: text().array().notNull().default(sql`'{}'::text[]`),
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

// ═════════════════════════════ Fase 2 ═════════════════════════════

export const deliveryStatusEnum = pgEnum('delivery_status', DELIVERY_STATUSES);
export const courierStatusEnum = pgEnum('courier_status', COURIER_STATUSES);
export const conversationStatusEnum = pgEnum('conversation_status', CONVERSATION_STATUSES);
export const conversationModeEnum = pgEnum('conversation_mode', CONVERSATION_MODES);
export const messageDirectionEnum = pgEnum('message_direction', MESSAGE_DIRECTIONS);
export const messageSenderEnum = pgEnum('message_sender', MESSAGE_SENDERS);
export const messageTypeEnum = pgEnum('message_type', MESSAGE_TYPES);
export const messageStatusEnum = pgEnum('message_status', MESSAGE_STATUSES);
export const integrationProviderEnum = pgEnum('integration_provider', ['whatsapp_cloud', 'mercadopago']);
export const integrationStatusEnum = pgEnum('integration_status', ['connected', 'error', 'disconnected']);
export const paymentTxStatusEnum = pgEnum('payment_tx_status', PAYMENT_TRANSACTION_STATUSES);
export const jobStatusEnum = pgEnum('job_status', ['queued', 'running', 'done', 'failed']);

// ───────────────────────────── Entregas ─────────────────────────────

/** Bairros/regiões atendidos e a taxa de cada um. Sem nenhum ativo, vale a taxa única da unidade. */
export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: id(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    name: text().notNull(),
    feeCents: integer().notNull(),
    minOrderCents: integer(),
    etaMinutes: integer(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('delivery_zones_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete('cascade'),
    uniqueIndex('delivery_zones_branch_name_key').on(t.branchId, sql`lower(${t.name})`),
    check('delivery_zones_fee_non_negative', sql`${t.feeCents} >= 0`),
  ],
);

export const couriers = pgTable(
  'couriers',
  {
    id: id(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    name: text().notNull(),
    phone: text().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    status: courierStatusEnum().notNull().default('available'),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('couriers_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete('cascade'),
    index('couriers_branch_idx').on(t.branchId),
  ],
);

/** Uma entrega por pedido de entrega, acompanhando o status do pedido. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: id(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    orderId: uuid().notNull(),
    courierId: uuid(),
    zoneId: uuid(),
    zoneName: text(),
    status: deliveryStatusEnum().notNull().default('awaiting_courier'),
    problemReason: text(),
    assignedAt: timestamp({ withTimezone: true }),
    dispatchedAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    problemAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('deliveries_order_key').on(t.orderId),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.courierId], foreignColumns: [couriers.tenantId, couriers.id] }),
    index('deliveries_branch_status_idx').on(t.branchId, t.status),
    index('deliveries_courier_idx').on(t.courierId),
  ],
);

// ───────────────────────────── Integrações ─────────────────────────────

/**
 * Integrações por estabelecimento. `secrets` guarda credenciais cifradas (AES-256-GCM) e nunca
 * volta para o navegador. `externalId` roteia webhooks (ex.: phone_number_id da WhatsApp).
 */
export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: integrationProviderEnum().notNull(),
    status: integrationStatusEnum().notNull().default('connected'),
    externalId: text(),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    secrets: text().notNull(),
    lastError: text(),
    lastCheckedAt: timestamp({ withTimezone: true }),
    connectedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('integrations_tenant_provider_key').on(t.tenantId, t.provider),
    uniqueIndex('integrations_provider_external_key').on(t.provider, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
  ],
);

/** Registro bruto dos webhooks recebidos (auditoria e diagnóstico). */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    provider: integrationProviderEnum().notNull(),
    tenantId: uuid().references(() => tenants.id, { onDelete: 'cascade' }),
    signatureValid: boolean().notNull(),
    payload: jsonb().$type<unknown>().notNull(),
    error: text(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('webhook_events_received_idx').on(t.receivedAt)],
);

// ───────────────────────────── Atendimento ─────────────────────────────

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    tenantId: uuid().notNull(),
    channel: text().notNull().default('whatsapp'),
    customerId: uuid(),
    /** wa_id exatamente como a WhatsApp envia (usado para responder). */
    contactId: text().notNull(),
    contactName: text(),
    status: conversationStatusEnum().notNull().default('open'),
    mode: conversationModeEnum().notNull().default('ai'),
    assignedUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    unreadCount: integer().notNull().default(0),
    lastMessageAt: timestamp({ withTimezone: true }),
    lastInboundAt: timestamp({ withTimezone: true }),
    lastMessagePreview: text(),
    handoffReason: text(),
    handoffAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    /** Rascunho do pedido montado pela IA, aguardando a confirmação do cliente. */
    aiDraft: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('conversations_tenant_id_id_key').on(t.tenantId, t.id),
    unique('conversations_tenant_contact_key').on(t.tenantId, t.channel, t.contactId),
    foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }),
    index('conversations_tenant_last_idx').on(t.tenantId, t.lastMessageAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    tenantId: uuid().notNull(),
    conversationId: uuid().notNull(),
    direction: messageDirectionEnum().notNull(),
    sender: messageSenderEnum().notNull(),
    senderUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    senderName: text(),
    type: messageTypeEnum().notNull().default('text'),
    body: text(),
    mediaId: text(),
    mediaUrl: text(),
    mediaMime: text(),
    templateName: text(),
    externalId: text(),
    status: messageStatusEnum().notNull(),
    error: text(),
    statusAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.conversationId], foreignColumns: [conversations.tenantId, conversations.id] }).onDelete('cascade'),
    uniqueIndex('messages_external_key').on(t.externalId).where(sql`${t.externalId} IS NOT NULL`),
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
  ],
);

export const quickReplies = pgTable(
  'quick_replies',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('quick_replies_tenant_idx').on(t.tenantId)],
);

// ───────────────────────────── Assistente de IA ─────────────────────────────

export const aiSettings = pgTable('ai_settings', {
  tenantId: uuid()
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  settings: jsonb().$type<Record<string, unknown>>().notNull(),
  updatedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/** Consumo de IA por estabelecimento (base para limites por plano na Fase 5). */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid(),
    purpose: text().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

// ───────────────────────────── Pagamentos ─────────────────────────────

export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: uuid().notNull(),
    orderId: uuid().notNull(),
    provider: integrationProviderEnum().notNull(),
    providerPaymentId: text().notNull(),
    method: text().notNull(),
    status: paymentTxStatusEnum().notNull(),
    amountCents: integer().notNull(),
    refundedCents: integer().notNull().default(0),
    qrCode: text(),
    qrCodeBase64: text(),
    ticketUrl: text(),
    expiresAt: timestamp({ withTimezone: true }),
    approvedAt: timestamp({ withTimezone: true }),
    statusDetail: text(),
    raw: jsonb().$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    uniqueIndex('payments_provider_external_key').on(t.provider, t.providerPaymentId),
    index('payments_order_idx').on(t.orderId),
  ],
);

// ───────────────────────────── Fila de tarefas ─────────────────────────────

/** Tarefas em segundo plano (envio de mensagens, respostas da IA, expiração de PIX). */
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: jobStatusEnum().notNull().default('queued'),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    dedupeKey: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_queue_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_key').on(t.dedupeKey).where(sql`${t.dedupeKey} IS NOT NULL`),
  ],
);
