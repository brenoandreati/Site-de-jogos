'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  Bike,
  BookOpen,
  Boxes,
  Calculator,
  ChartColumn,
  ChefHat,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  ExternalLink,
  Gift,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu as MenuIcon,
  MessagesSquare,
  Receipt,
  Settings,
  Store,
  UsersRound,
  Wallet,
  X,
  ContactRound,
  Check,
  Pause,
  Play,
  ChevronDown,
} from 'lucide-react';
import { CURRENT_PHASE, ROLE_LABELS, hasAccess, type ModuleKey, MODULES } from '@balcao/shared';
import { BrandMark } from '@/components/brand';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { Badge } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { errorMessage, post } from '@/lib/api';
import { useBoard, useSettings, keys } from '@/lib/queries';
import { cx, timeAgo } from '@/lib/format';
import type { Me } from '@/lib/types';
import { useAdmin } from './admin-context';
import { PauseStoreModal } from './pause-store';
import { PasswordModal } from './password-modal';

const NAV: { module: ModuleKey; href?: string; label: string; icon: ReactNode }[] = [
  { module: 'dashboard', href: '/painel', label: 'Visão geral', icon: <LayoutDashboard /> },
  { module: 'orders', href: '/painel/pedidos', label: 'Pedidos', icon: <Receipt /> },
  { module: 'inbox', label: 'Atendimento', icon: <MessagesSquare /> },
  { module: 'catalog', href: '/painel/cardapio', label: 'Cardápio', icon: <BookOpen /> },
  { module: 'customers', label: 'Clientes', icon: <ContactRound /> },
  { module: 'marketing', label: 'Marketing', icon: <Megaphone /> },
  { module: 'loyalty', label: 'Fidelidade', icon: <Gift /> },
  { module: 'inventory', label: 'Estoque', icon: <Boxes /> },
  { module: 'delivery', label: 'Entregas', icon: <Bike /> },
  { module: 'kitchen', label: 'Cozinha', icon: <ChefHat /> },
  { module: 'financial', label: 'Financeiro', icon: <Wallet /> },
  { module: 'cash_register', label: 'Caixa', icon: <Calculator /> },
  { module: 'reports', label: 'Relatórios', icon: <ChartColumn /> },
  { module: 'team', href: '/painel/equipe', label: 'Funcionários', icon: <UsersRound /> },
  { module: 'settings', href: '/painel/configuracoes', label: 'Configurações', icon: <Settings /> },
];

const PHASE = Object.fromEntries(MODULES.map((m) => [m.key, m.phase])) as Record<ModuleKey, number>;
const COLLAPSE_KEY = 'balcao:sidebar';

export function AdminShell({ children }: { children: ReactNode }) {
  const { me } = useAdmin();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      // Em telas médias (tablet no balcão) o menu começa recolhido para dar espaço ao quadro de pedidos.
      setCollapsed(saved === null ? window.innerWidth < 1280 : saved === '1');
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  return (
    <div className="flex min-h-dvh">
      <aside
        className={cx(
          'no-print sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        <Sidebar me={me} collapsed={collapsed} onToggle={toggle} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 animate-fade bg-ink/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-[rise_180ms] flex-col bg-surface shadow-pop">
            <Sidebar me={me} collapsed={false} onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header me={me} onMenu={() => setMobileOpen(true)} />
        <main className="min-w-0 flex-1 px-4 pb-12 pt-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ me, collapsed, onToggle, onClose }: { me: Me; collapsed: boolean; onToggle?: () => void; onClose?: () => void }) {
  const pathname = usePathname();
  const perms = me.active!.permissions;
  const board = useBoard({ enabled: hasAccess(perms, 'orders', 'view') });
  const pending = board.data?.orders.filter((o) => o.status === 'new' || o.status === 'awaiting_confirmation').length ?? 0;

  const available = NAV.filter((n) => PHASE[n.module] <= CURRENT_PHASE && hasAccess(perms, n.module, 'view'));
  const upcoming = NAV.filter((n) => PHASE[n.module] > CURRENT_PHASE);
  const [showUpcoming, setShowUpcoming] = useState(false);

  return (
    <>
      <div className={cx('flex h-16 items-center border-b border-line', collapsed ? 'justify-center' : 'justify-between px-4')}>
        <Link href="/painel" className="flex items-center gap-2" aria-label="Balcão, visão geral">
          <BrandMark />
          {!collapsed && <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">Balcão</span>}
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken" aria-label="Fechar menu">
            <X className="size-[18px]" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Principal">
        <ul className="space-y-0.5">
          {available.map((item) => {
            const active = item.href === '/painel' ? pathname === '/painel' : pathname.startsWith(item.href!);
            return (
              <li key={item.module}>
                <Link
                  href={item.href!}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'group relative flex h-9 items-center gap-3 rounded-md text-sm font-medium transition-colors [&>svg]:size-[18px] [&>svg]:shrink-0',
                    collapsed ? 'justify-center' : 'px-2.5',
                    active ? 'bg-brand-soft text-brand-ink [&>svg]:text-brand' : 'text-ink-2 hover:bg-sunken hover:text-ink [&>svg]:text-muted',
                  )}
                >
                  {item.icon}
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  {item.module === 'orders' && pending > 0 && (
                    <span
                      className={cx(
                        'num grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[0.625rem] font-semibold text-white',
                        collapsed && 'absolute right-1 top-0.5 h-4 min-w-4 px-1',
                      )}
                      aria-label={`${pending} pedidos aguardando`}
                    >
                      {pending}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {!collapsed && upcoming.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => setShowUpcoming((v) => !v)}
              aria-expanded={showUpcoming}
              className="flex w-full items-center justify-between px-2.5 text-2xs font-medium uppercase tracking-[0.08em] text-faint hover:text-muted"
            >
              Próximas fases
              <ChevronDown className={cx('size-3.5 transition-transform', showUpcoming && 'rotate-180')} />
            </button>
            {showUpcoming && (
              <ul className="mt-2 space-y-0.5" aria-label="Módulos em desenvolvimento">
                {upcoming.map((item) => (
                  <li key={item.module} className="flex h-8 items-center gap-3 px-2.5 text-[0.8125rem] text-faint [&>svg]:size-4">
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    <span className="text-2xs">Fase {PHASE[item.module]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>

      {onToggle && (
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={onToggle}
            className={cx('flex h-9 w-full items-center gap-3 rounded-md text-sm text-muted hover:bg-sunken hover:text-ink', collapsed ? 'justify-center' : 'px-2.5')}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <ChevronsRight className="size-[18px]" /> : <ChevronsLeft className="size-[18px]" />}
            {!collapsed && 'Recolher'}
          </button>
        </div>
      )}
    </>
  );
}

function Header({ me, onMenu }: { me: Me; onMenu: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const { notifications, markAllRead, soundOn, setSoundOn, openOrder, realtime } = useAdmin();
  const active = me.active!;
  const settings = useSettings();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;
  const canPause = hasAccess(active.permissions, 'orders', 'manage') || hasAccess(active.permissions, 'settings', 'edit');

  const switchBranch = useMutation({
    mutationFn: (branchId: string) => post<Me>('/auth/switch-branch', { branchId }),
    onSuccess: (data) => {
      qc.setQueryData(keys.me, data);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const switchTenant = useMutation({
    mutationFn: (tenantId: string) => post<Me>('/auth/switch-tenant', { tenantId }),
    onSuccess: (data) => {
      qc.clear();
      qc.setQueryData(keys.me, data);
      router.push('/painel');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const logout = useMutation({
    mutationFn: () => post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      router.replace('/entrar');
    },
  });

  const availability = settings.data?.availability;
  const storeState = !availability ? null : availability.isOpen ? 'open' : availability.reason === 'paused' ? 'paused' : 'closed';
  const branch = active.branches.find((b) => b.id === active.branchId);

  return (
    <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:px-6 lg:px-8">
      <button type="button" onClick={onMenu} className="-ml-1 grid size-9 place-items-center rounded-md text-ink-2 hover:bg-sunken lg:hidden" aria-label="Abrir menu">
        <MenuIcon className="size-5" />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        {me.tenants.length > 1 ? (
          <Menu
            align="start"
            label="Trocar de estabelecimento"
            trigger={({ toggle, open }) => (
              <button type="button" onClick={toggle} aria-expanded={open} className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-sunken">
                <span className="truncate font-semibold">{active.tenant.tradeName}</span>
                <ChevronDown className="size-4 shrink-0 text-muted" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>Estabelecimentos</MenuLabel>
                {me.tenants.map((t) => (
                  <MenuItem
                    key={t.id}
                    icon={t.id === active.tenant.id ? <Check /> : <Store />}
                    onClick={() => {
                      close();
                      if (t.id !== active.tenant.id) switchTenant.mutate(t.id);
                    }}
                  >
                    {t.tradeName}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        ) : (
          <span className="truncate px-1 font-semibold">{active.tenant.tradeName}</span>
        )}

        {active.branches.length > 1 ? (
          <Menu
            align="start"
            label="Trocar de unidade"
            trigger={({ toggle, open }) => (
              <button type="button" onClick={toggle} aria-expanded={open} className="hidden items-center gap-1 rounded-md border border-line px-2 py-1 text-[0.8125rem] text-ink-2 hover:bg-sunken sm:flex">
                {branch?.name}
                <ChevronDown className="size-3.5 text-muted" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>Unidades</MenuLabel>
                {active.branches.map((b) => (
                  <MenuItem
                    key={b.id}
                    icon={b.id === active.branchId ? <Check /> : <Store />}
                    onClick={() => {
                      close();
                      if (b.id !== active.branchId) switchBranch.mutate(b.id);
                    }}
                  >
                    {b.name}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        ) : null}

        {storeState && (
          <button
            type="button"
            onClick={() => (canPause ? setPauseOpen(true) : undefined)}
            disabled={!canPause}
            title={canPause ? 'Pausar ou reabrir a loja' : undefined}
            className={cx(
              'ml-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors',
              storeState === 'open' && 'bg-brand-soft text-brand-ink hover:bg-brand-soft/70',
              storeState === 'paused' && 'bg-warn-soft text-warn',
              storeState === 'closed' && 'bg-sunken text-muted',
              !canPause && 'cursor-default',
            )}
          >
            <span className={cx('size-1.5 rounded-full', storeState === 'open' ? 'bg-brand' : storeState === 'paused' ? 'bg-warn' : 'bg-faint')} />
            {storeState === 'open' ? 'Aberta' : storeState === 'paused' ? 'Pausada' : 'Fechada'}
            {canPause && (storeState === 'paused' ? <Play className="size-3" /> : storeState === 'open' ? <Pause className="size-3" /> : null)}
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {realtime === 'offline' && (
          <Badge tone="warn" className="mr-1 hidden md:inline-flex" dot>
            Reconectando
          </Badge>
        )}

        <Menu
          label="Notificações"
          className="w-80"
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={() => {
                toggle();
                if (!open) setTimeout(markAllRead, 1500);
              }}
              aria-expanded={open}
              className="relative grid size-9 place-items-center rounded-md text-ink-2 hover:bg-sunken"
              aria-label={unread ? `Notificações, ${unread} novas` : 'Notificações'}
            >
              {soundOn ? <Bell className="size-[18px]" /> : <BellOff className="size-[18px]" />}
              {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-surface" />}
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
                <span className="text-sm font-semibold">Notificações</span>
                <button type="button" onClick={() => setSoundOn(!soundOn)} className="text-xs font-medium text-brand hover:underline">
                  {soundOn ? 'Desativar som' : 'Ativar som'}
                </button>
              </div>
              {notifications.length === 0 ? (
                <p className="px-2.5 py-6 text-center text-[0.8125rem] text-muted">Os pedidos novos aparecem aqui enquanto o painel estiver aberto.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {notifications.map((n) => (
                    <MenuItem
                      key={n.id}
                      icon={<Receipt />}
                      onClick={() => {
                        close();
                        openOrder(n.orderId);
                      }}
                    >
                      <span className="flex flex-1 items-center justify-between gap-3">
                        <span>
                          Pedido <span className="num">#{n.number}</span>
                          {!n.read && <span className="ml-2 inline-block size-1.5 rounded-full bg-brand align-middle" />}
                        </span>
                        <span className="text-xs text-faint">{timeAgo(n.at)}</span>
                      </span>
                    </MenuItem>
                  ))}
                </div>
              )}
            </>
          )}
        </Menu>

        <Menu
          label="Ajuda"
          trigger={({ toggle, open }) => (
            <button type="button" onClick={toggle} aria-expanded={open} className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-sunken" aria-label="Ajuda">
              <CircleHelp className="size-[18px]" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<ExternalLink />} href={`/${active.tenant.slug}`} external onClick={close}>
                Ver meu cardápio
              </MenuItem>
              <MenuItem
                icon={<LayoutDashboard />}
                onClick={() => {
                  close();
                  router.push('/painel?primeiros-passos=1');
                }}
              >
                Primeiros passos
              </MenuItem>
              <MenuSeparator />
              <div className="px-2.5 py-2 text-xs leading-relaxed text-muted">
                Pedidos novos tocam um aviso sonoro. Deixe esta aba aberta no computador ou tablet do balcão.
              </div>
            </>
          )}
        </Menu>

        <Menu
          label="Sua conta"
          trigger={({ toggle, open }) => (
            <button type="button" onClick={toggle} aria-expanded={open} className="ml-1 flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-sunken" aria-label="Sua conta">
              <span className="grid size-8 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{initials(me.user.name)}</span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block max-w-36 truncate text-[0.8125rem] font-medium">{me.user.name}</span>
                <span className="block text-2xs text-muted">{ROLE_LABELS[active.role]}</span>
              </span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-medium">{me.user.name}</p>
                <p className="truncate text-xs text-muted">{me.user.email}</p>
              </div>
              <MenuSeparator />
              <MenuItem
                icon={<KeyRound />}
                onClick={() => {
                  close();
                  setPasswordOpen(true);
                }}
              >
                Trocar senha
              </MenuItem>
              <MenuItem icon={<LogOut />} tone="danger" onClick={() => logout.mutate()}>
                Sair
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      {settings.data && <PauseStoreModal open={pauseOpen} onClose={() => setPauseOpen(false)} settings={settings.data} />}
      <PasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </header>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}
