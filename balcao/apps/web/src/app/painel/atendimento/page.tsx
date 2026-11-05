'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, Search, X } from 'lucide-react';
import { formatPhone, hasAccess } from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { ConversationView, NoConversation } from '@/components/inbox/conversation-view';
import { CustomerPane } from '@/components/inbox/customer-pane';
import { Modal } from '@/components/ui/modal';
import { ErrorNotice, Skeleton } from '@/components/ui/misc';
import { get } from '@/lib/api';
import { cx, timeAgo } from '@/lib/format';
import { contactLabel, initials, type ConversationDetail, type ConversationSummary } from '@/lib/inbox';
import { keys, type InboxListResponse } from '@/lib/queries';

const FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'waiting', label: 'Aguardando', count: 'waiting' },
  { key: 'unread', label: 'Não lidas', count: 'unread' },
  { key: 'mine', label: 'Minhas' },
  { key: 'ai', label: 'Com a IA', count: 'ai' },
  { key: 'human', label: 'Equipe' },
  { key: 'closed', label: 'Encerradas' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

export default function InboxPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const { me, realtime } = useAdmin();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get('c');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const [customerOpen, setCustomerOpen] = useState(true);
  const [customerSheet, setCustomerSheet] = useState(false);

  const qs = new URLSearchParams({ filter, ...(deferred ? { search: deferred } : {}) }).toString();
  const list = useQuery({
    queryKey: keys.inbox(qs),
    queryFn: ({ signal }) => get<InboxListResponse>(`/inbox/conversations?${qs}`, signal),
    refetchInterval: realtime === 'online' ? false : 15_000,
    placeholderData: (prev) => prev,
  });
  const detail = useQuery({
    queryKey: keys.conversation(selected ?? ''),
    queryFn: ({ signal }) => get<ConversationDetail>(`/inbox/conversations/${selected}`, signal),
    enabled: !!selected,
  });

  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('c', id);
    else next.delete('c');
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  // Em telas menores a ficha abre como gaveta.
  useEffect(() => {
    if (!selected) setCustomerSheet(false);
  }, [selected]);

  if (!hasAccess(me.active!.permissions, 'inbox', 'view')) return <ErrorNotice message="Você não tem acesso ao atendimento." />;

  const wa = list.data?.whatsapp ?? null;
  const connected = wa?.status === 'connected';
  const blockedReason = !list.data
    ? null
    : !wa
      ? 'O WhatsApp da loja não está conectado. Conecte em Configurações › Integrações para responder por aqui.'
      : !connected
        ? `A conexão com o WhatsApp está com problema${wa.lastError ? `: ${wa.lastError}` : ''}. Verifique em Configurações › Integrações.`
        : null;

  return (
    <div className="-mx-4 -mb-12 -mt-6 flex h-[calc(100dvh-4rem)] border-line sm:-mx-6 lg:-mx-8">
      {/* Lista */}
      <aside className={cx('flex w-full min-w-0 flex-col border-r border-line bg-surface md:w-[320px] md:shrink-0', selected && 'hidden md:flex')} aria-label="Conversas">
        <div className="space-y-3 border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold tracking-[-0.01em]">Atendimento</h1>
            {wa && (
              <span className={cx('inline-flex items-center gap-1.5 text-xs', connected ? 'text-muted' : 'text-danger')}>
                <span className={cx('size-1.5 rounded-full', connected ? 'bg-brand' : 'bg-danger')} aria-hidden="true" />
                {connected ? (wa.displayPhoneNumber ?? 'WhatsApp conectado') : 'WhatsApp com erro'}
              </span>
            )}
          </div>
          {list.data && !wa && (
            <Link href="/painel/configuracoes?secao=integracoes" className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn hover:underline">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> WhatsApp não conectado. Conectar agora
            </Link>
          )}
          {list.data && (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Bot className="size-3.5" /> Assistente virtual {list.data.aiEnabled ? 'ligada' : 'desligada'} ·{' '}
              <Link href="/painel/assistente" className="text-brand hover:underline">
                ajustar
              </Link>
            </p>
          )}
          <label className="relative block">
            <span className="sr-only">Buscar conversa</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome ou telefone"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pl-9 pr-8 text-sm outline-none placeholder:text-faint focus:border-ink/40"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted hover:text-ink" aria-label="Limpar busca">
                <X className="size-3.5" />
              </button>
            )}
          </label>
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-0.5" role="tablist" aria-label="Filtrar conversas">
            {FILTERS.map((f) => {
              const n = 'count' in f && list.data ? list.data.counts[f.count] : 0;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors', filter === f.key ? 'bg-ink text-surface' : 'bg-sunken text-ink-2 hover:bg-line')}
                >
                  {f.label}
                  {n > 0 && <span className={cx('num text-2xs', filter === f.key ? 'text-surface/70' : f.key === 'waiting' ? 'text-warn' : 'text-muted')}>{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : list.error ? (
            <div className="p-4">
              <ErrorNotice message={list.error.message} onRetry={() => void list.refetch()} />
            </div>
          ) : list.data!.conversations.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted">
              {deferred ? 'Nenhuma conversa encontrada.' : filter === 'all' ? (connected ? 'Quando um cliente escrever para o WhatsApp da loja, a conversa aparece aqui.' : 'Sem conversas ainda.') : 'Nada neste filtro.'}
            </p>
          ) : (
            <ul>
              {list.data!.conversations.map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === selected} onSelect={() => select(c.id)} />
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Conversa */}
      <section className={cx('min-w-0 flex-1 flex-col', selected ? 'flex' : 'hidden md:flex')} aria-label="Conversa">
        {selected ? (
          <ConversationView
            key={selected}
            id={selected}
            canSend={!blockedReason}
            sendBlockedReason={blockedReason}
            aiEnabled={list.data?.aiEnabled ?? false}
            onBack={() => select(null)}
            onToggleCustomer={() => {
              if (window.matchMedia('(min-width: 1280px)').matches) setCustomerOpen((v) => !v);
              else setCustomerSheet(true);
            }}
          />
        ) : (
          <NoConversation whatsappConnected={connected} />
        )}
      </section>

      {/* Ficha do cliente */}
      {selected && customerOpen && (
        <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-line bg-surface xl:block" aria-label="Ficha do cliente">
          <PaneHeader title="Ficha do cliente" onClose={() => setCustomerOpen(false)} />
          {detail.data ? <CustomerPane customer={detail.data.customer} conversationId={selected} /> : <Skeleton className="m-5 h-40" />}
        </aside>
      )}
      <Modal open={customerSheet} onClose={() => setCustomerSheet(false)} side="right" size="sm" title="Ficha do cliente" bodyClassName="p-0">
        {detail.data && selected && <CustomerPane customer={detail.data.customer} conversationId={selected} />}
      </Modal>
    </div>
  );
}

function PaneHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken" aria-label="Fechar ficha">
        <X className="size-4" />
      </button>
    </div>
  );
}

function ConversationRow({ c, active, onSelect }: { c: ConversationSummary; active: boolean; onSelect: () => void }) {
  const name = contactLabel(c);
  const waiting = c.status === 'waiting';
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cx('flex w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors', active ? 'bg-brand-soft' : 'hover:bg-canvas')}
      >
        <span className={cx('relative grid size-10 shrink-0 place-items-center rounded-full text-xs font-semibold', c.status === 'closed' ? 'bg-sunken text-muted' : 'bg-ink text-surface')}>
          {initials(name)}
          {c.mode === 'ai' && c.status !== 'closed' && (
            <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-brand text-white ring-2 ring-surface" title="Com a assistente virtual">
              <Bot className="size-2.5" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cx('truncate text-sm', c.unreadCount > 0 ? 'font-semibold text-ink' : 'font-medium text-ink-2')}>{name}</span>
            {c.lastMessageAt && <span className="shrink-0 text-2xs text-faint">{timeAgo(c.lastMessageAt)}</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={cx('min-w-0 flex-1 truncate text-xs', c.unreadCount > 0 ? 'text-ink-2' : 'text-muted')}>{c.lastMessagePreview ?? formatPhone(c.contactId)}</span>
            {c.unreadCount > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-2xs font-semibold text-white">{c.unreadCount}</span>}
          </span>
          {(waiting || c.assignedUserName) && (
            <span className={cx('mt-1 block truncate text-2xs', waiting ? 'font-medium text-warn' : 'text-faint')}>
              {waiting ? `Aguardando atendente${c.handoffReason ? ` · ${c.handoffReason}` : ''}` : `Com ${c.assignedUserName}`}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
