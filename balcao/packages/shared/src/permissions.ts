/**
 * Módulos da plataforma, funções (perfis) e níveis de acesso.
 *
 * Cada módulo tem um nível por membro da equipe: none < view < edit < manage.
 * - view: visualizar
 * - edit: criar e alterar no dia a dia (ex.: mudar status de pedido)
 * - manage: ações sensíveis do módulo (ex.: cancelar pedido, aplicar desconto, excluir produto)
 *
 * O registro inclui os módulos das próximas fases para que permissões, menu e planos
 * já nasçam preparados; `phase` indica quando o módulo passa a existir.
 */

export const CURRENT_PHASE = 2;

export const MODULES = [
  { key: 'dashboard', label: 'Visão geral', phase: 1 },
  { key: 'orders', label: 'Pedidos', phase: 1 },
  { key: 'catalog', label: 'Cardápio e produtos', phase: 1 },
  { key: 'team', label: 'Funcionários', phase: 1 },
  { key: 'settings', label: 'Configurações', phase: 1 },
  { key: 'inbox', label: 'Atendimento', phase: 2 },
  { key: 'ai_assistant', label: 'Assistente de IA', phase: 2 },
  { key: 'kitchen', label: 'Cozinha', phase: 2 },
  { key: 'delivery', label: 'Entregas', phase: 2 },
  { key: 'customers', label: 'Clientes', phase: 3 },
  { key: 'marketing', label: 'Marketing', phase: 3 },
  { key: 'loyalty', label: 'Fidelidade', phase: 3 },
  { key: 'inventory', label: 'Estoque', phase: 4 },
  { key: 'financial', label: 'Financeiro', phase: 4 },
  { key: 'cash_register', label: 'Caixa', phase: 4 },
  { key: 'reports', label: 'Relatórios', phase: 4 },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];
export const AVAILABLE_MODULES = MODULES.filter((m) => m.phase <= CURRENT_PHASE);

export const ACCESS_LEVELS = ['none', 'view', 'edit', 'manage'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  none: 'Sem acesso',
  view: 'Visualizar',
  edit: 'Editar',
  manage: 'Administrar',
};

export const ROLES = ['owner', 'admin', 'manager', 'attendant', 'cashier', 'kitchen', 'courier'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  manager: 'Gerente',
  attendant: 'Atendente',
  cashier: 'Operador de caixa',
  kitchen: 'Cozinha / produção',
  courier: 'Entregador',
};
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Acesso total, inclusive dados da empresa e equipe.',
  admin: 'Administra a loja inteira, exceto remover o proprietário.',
  manager: 'Opera pedidos e cardápio, acompanha resultados.',
  attendant: 'Recebe e acompanha pedidos e atendimentos.',
  cashier: 'Pedidos, pagamentos e caixa.',
  kitchen: 'Vê e atualiza os pedidos em produção.',
  courier: 'Vê as entregas atribuídas a ele.',
};

export type PermissionMap = Record<ModuleKey, AccessLevel>;
export type PermissionOverrides = Partial<Record<ModuleKey, AccessLevel>>;

function fill(level: AccessLevel, overrides: PermissionOverrides = {}): PermissionMap {
  const map = {} as PermissionMap;
  for (const key of MODULE_KEYS) map[key] = overrides[key] ?? level;
  return map;
}

export const ROLE_DEFAULTS: Record<Role, PermissionMap> = {
  owner: fill('manage'),
  admin: fill('manage'),
  manager: fill('edit', { dashboard: 'view', team: 'view', settings: 'view', financial: 'view', reports: 'view' }),
  attendant: fill('none', { orders: 'edit', catalog: 'view', inbox: 'edit', ai_assistant: 'view', customers: 'view', kitchen: 'view', delivery: 'view' }),
  cashier: fill('none', { orders: 'edit', catalog: 'view', cash_register: 'edit', customers: 'view', delivery: 'view' }),
  kitchen: fill('none', { orders: 'view', kitchen: 'edit', inventory: 'view' }),
  // O entregador vê e atualiza apenas as entregas atribuídas a ele.
  courier: fill('none', { delivery: 'edit' }),
};

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 };

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);
}

/** Permissões efetivas: padrão da função + personalizações do proprietário. O proprietário é sempre total. */
export function resolvePermissions(role: Role, overrides?: PermissionOverrides | null): PermissionMap {
  const base = ROLE_DEFAULTS[role];
  if (role === 'owner' || !overrides) return { ...base };
  const result = { ...base };
  for (const key of MODULE_KEYS) {
    const value = overrides[key];
    if (isAccessLevel(value)) result[key] = value;
  }
  return result;
}

export function hasAccess(perms: PermissionMap, module: ModuleKey, level: Exclude<AccessLevel, 'none'>): boolean {
  return RANK[perms[module] ?? 'none'] >= RANK[level];
}

/** Funções que um membro com a função `actor` pode atribuir. */
export function assignableRoles(actor: Role): Role[] {
  if (actor === 'owner') return [...ROLES];
  if (actor === 'admin') return ROLES.filter((r) => r !== 'owner');
  if (actor === 'manager') return ['attendant', 'cashier', 'kitchen', 'courier'];
  return [];
}
