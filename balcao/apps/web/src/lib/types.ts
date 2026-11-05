import type {
  AccessLevel,
  FulfillmentType,
  ModuleKey,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PermissionMap,
  Role,
  OpeningInterval,
  StoreAvailability,
  MessageTemplateKey,
} from '@balcao/shared';

export interface Me {
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  tenants: { id: string; slug: string; tradeName: string; logoUrl: string | null; role: Role; status: string }[];
  active: {
    tenant: { id: string; slug: string; tradeName: string; logoUrl: string | null };
    branchId: string;
    branches: { id: string; name: string; isPrimary: boolean }[];
    role: Role;
    permissions: PermissionMap;
  } | null;
}

export interface Address {
  zipCode: string | null;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  reference: string | null;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  productName: string;
  categoryName: string | null;
  quantity: number;
  basePriceCents: number;
  unitPriceCents: number;
  totalCents: number;
  notes: string | null;
  modifiers: { modifierId: string | null; groupName: string; name: string; priceCents: number; quantity: number; totalCents: number }[];
}

export interface Order {
  id: string;
  number: number;
  branchId: string;
  status: OrderStatus;
  channel: OrderChannel;
  fulfillment: FulfillmentType;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  address: Address | null;
  tableNumber: string | null;
  changeForCents: number | null;
  subtotalCents: number;
  discountCents: number;
  discountReason: string | null;
  deliveryFeeCents: number;
  totalCents: number;
  notes: string | null;
  cancelReason: string | null;
  prepTimeMinutes: number;
  deliveryTimeMinutes: number;
  publicToken: string;
  version: number;
  createdAt: string;
  confirmedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  updatedAt: string;
  items: OrderItem[];
}

export interface OrderEvent {
  id: string;
  type: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  data: Record<string, unknown>;
  actorType: 'customer' | 'user' | 'system';
  actorName: string | null;
  createdAt: string;
}

export interface OrderDetail extends Order {
  duplicatedFromOrderId: string | null;
  events: OrderEvent[];
  customer: {
    id: string;
    name: string;
    phone: string;
    notes: string | null;
    createdAt: string;
    ordersCount: number;
    totalSpentCents: number;
    averageTicketCents: number;
    previousOrders: { id: string; number: number; totalCents: number; status: OrderStatus; createdAt: string }[];
  } | null;
}

export interface ModifierOption {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  maxQuantity: number;
  isAvailable: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  description: string | null;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: ModifierOption[];
  productCount?: number;
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  sku: string | null;
  prepTimeMinutes: number | null;
  isFeatured: boolean;
  isActive: boolean;
  isAvailable: boolean;
  trackStock: boolean;
  stockQuantity: number | null;
  isSoldOut: boolean;
  position: number;
  modifierGroupIds: string[];
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  position: number;
  isActive: boolean;
  products: Product[];
}

export interface AdminCatalog {
  categories: Category[];
  modifierGroups: (ModifierGroup & { productCount: number })[];
}

export interface Settings {
  company: {
    slug: string;
    tradeName: string;
    legalName: string | null;
    document: string | null;
    documentType: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    instagram: string | null;
    description: string | null;
    businessCategories: string[];
    logoUrl: string | null;
    coverUrl: string | null;
    brandColor: string | null;
  };
  branch: {
    id: string;
    name: string;
    phone: string | null;
    whatsapp: string | null;
    timezone: string;
    address: Address | null;
  };
  hours: OpeningInterval[];
  orders: {
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    acceptsDineIn: boolean;
    autoConfirm: boolean;
    minOrderCents: number;
    deliveryFeeCents: number;
    freeDeliveryAboveCents: number | null;
    prepTimeMinutes: number;
    deliveryTimeMinutes: number;
    paymentMethods: PaymentMethod[];
    pixKey: string | null;
    pixKeyType: string | null;
    pixHolderName: string | null;
    cancellationPolicy: string | null;
  };
  pause: { isPaused: boolean; pausedUntil: string | null; reason: string | null };
  availability: StoreAvailability;
  messages: Record<MessageTemplateKey, string>;
  menuPath: string;
}

export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
  customPermissions: Partial<Record<ModuleKey, AccessLevel>> | null;
  effectivePermissions: PermissionMap;
  lastLoginAt: string | null;
  createdAt: string;
  isYou: boolean;
}

export interface PublicProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  isFeatured: boolean;
  isAvailable: boolean;
  groups: {
    id: string;
    name: string;
    description: string | null;
    minSelect: number;
    maxSelect: number;
    options: ModifierOption[];
  }[];
}

export interface PublicStore {
  store: {
    slug: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    brandColor: string | null;
    whatsapp: string | null;
    instagram: string | null;
    address: { street: string; number: string | null; complement: string | null; neighborhood: string | null; city: string | null; state: string | null } | null;
    timezone: string;
    availability: StoreAvailability;
    availabilityText: string;
    hours: OpeningInterval[];
    prepTimeMinutes: number;
    deliveryTimeMinutes: number;
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    acceptsDineIn: boolean;
    minOrderCents: number;
    deliveryFeeCents: number;
    freeDeliveryAboveCents: number | null;
    paymentMethods: PaymentMethod[];
    pix: { key: string; keyType: string | null; holderName: string | null } | null;
    cancellationPolicy: string | null;
  };
  categories: { id: string; name: string; description: string | null; products: PublicProduct[] }[];
}

export interface Tracking {
  number: number;
  status: OrderStatus;
  fulfillment: FulfillmentType;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  customerName: string;
  address: Address | null;
  tableNumber: string | null;
  changeForCents: number | null;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  notes: string | null;
  cancelReason: string | null;
  prepTimeMinutes: number;
  deliveryTimeMinutes: number;
  createdAt: string;
  confirmedAt: string | null;
  items: { productName: string; quantity: number; unitPriceCents: number; totalCents: number; notes: string | null; modifiers: { name: string; quantity: number; groupName: string }[] }[];
  timeline: { status: OrderStatus; at: string }[];
  store: { name: string; slug: string; logoUrl: string | null; whatsapp: string | null; pix: { key: string; keyType: string | null; holderName: string | null } | null };
}

export interface Dashboard {
  period: { from: string; to: string; days: number; timezone: string; granularity: 'hour' | 'day' };
  revenueTodayCents: number;
  revenueMonthCents: number;
  current: DashboardSummary;
  previous: DashboardSummary;
  live: Partial<Record<OrderStatus, number>>;
  series: { bucket: string; revenueCents: number; previousRevenueCents: number; orders: number; averageTicketCents: number }[];
  byCategory: { name: string; revenue: number; quantity: number }[];
  topProducts: { name: string; revenue: number; quantity: number }[];
  topByRevenue: { name: string; revenue: number; quantity: number }[];
  byPayment: { key: PaymentMethod; revenue: number; orders: number }[];
  byChannel: { key: OrderChannel; revenue: number; orders: number }[];
  byFulfillment: { key: FulfillmentType; revenue: number; orders: number }[];
  activity: (
    | { kind: 'order'; id: string; type: string; toStatus: OrderStatus | null; fromStatus: OrderStatus | null; actorName: string | null; actorType: string; data: Record<string, unknown>; createdAt: string; orderId: string; orderNumber: number; customerName: string; totalCents: number }
    | { kind: 'change'; id: string; action: string; summary: string | null; actorName: string | null; createdAt: string }
  )[];
}

export interface DashboardSummary {
  orders: number;
  accepted: number;
  completed: number;
  canceled: number;
  revenueCents: number;
  discountsCents: number;
  deliveryFeesCents: number;
  averageTicketCents: number;
  newCustomers: number;
  returningCustomers: number;
}
