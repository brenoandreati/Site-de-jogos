'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  Clock,
  FileText,
  ImagePlus,
  Lock,
  MessageSquareText,
  MoreHorizontal,
  PanelRight,
  Send,
  StickyNote,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { MESSAGE_STATUS_LABELS, formatPhone, hasAccess } from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { Badge, ErrorNotice, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { ApiError, errorMessage, get, patch, post, uploadImage } from '@/lib/api';
import { cx, formatDate, formatTime } from '@/lib/format';
import { contactLabel, type ConversationDetail, type InboxMessage, type QuickReply } from '@/lib/inbox';
import { keys } from '@/lib/queries';
import { QuickRepliesModal } from './quick-replies';

type Action = { action: 'assign_me' } | { action: 'transfer_user'; userId: string } | { action: 'to_ai' } | { action: 'to_human'; reason?: string } | { action: 'close' } | { action: 'reopen' };

export function ConversationView({
  id,
  canSend,
  sendBlockedReason,
  aiEnabled,
  onBack,
  onToggleCustomer,
}: {
  id: string;
  canSend: boolean;
  sendBlockedReason: string | null;
  aiEnabled: boolean;
  onBack: () => void;
  onToggleCustomer: () => void;
}) {
  const qc = useQueryClient();
  const { me, realtime } = useAdmin();
  const { toast, confirm } = useFeedback();
  const canEdit = hasAccess(me.active!.permissions, 'inbox', 'edit');
  const detail = useQuery({
    queryKey: keys.conversation(id),
    queryFn: ({ signal }) => get<ConversationDetail>(`/inbox/conversations/${id}`, signal),
    refetchInterval: realtime === 'online' ? false : 10_000,
  });
  const c = detail.data?.conversation;

  // Abrir a conversa (ou chegar mensagem com ela aberta) zera as não lidas.
  const unread = c?.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0) {
      void post(`/inbox/conversations/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ['inbox', 'list'] }));
    }
  }, [id, unread, qc]);

  const act = useMutation({
    mutationFn: (body: Action) => patch(`/inbox/conversations/${id}`, body),
    onSuccess: (_d, body) => {
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      const msg = { assign_me: 'Você assumiu o atendimento.', transfer_user: 'Conversa transferida.', to_ai: 'A assistente virtual voltou a responder.', to_human: 'Conversa na fila de atendimento humano.', close: 'Atendimento encerrado.', reopen: 'Atendimento reaberto.' }[body.action];
      toast(msg);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (detail.isLoading) {
    return (
      <div className="flex-1 space-y-3 p-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="ml-auto h-16 w-1/2" />
      </div>
    );
  }
  if (detail.error || !detail.data || !c) {
    return (
      <div className="flex-1 p-6">
        <ErrorNotice message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const name = contactLabel({ customerName: detail.data.customer?.name, contactName: c.contactName, contactId: c.contactId });
  const mine = c.assignedUserId === me.user.id;
  const closed = c.status === 'closed';

  const close = async () => {
    const r = await confirm({ title: `Encerrar o atendimento de ${name}?`, description: 'A conversa sai da fila. Se o cliente escrever de novo, ela reabre sozinha.', confirmLabel: 'Encerrar' });
    if (r.confirmed) act.mutate({ action: 'close' });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
        <button type="button" onClick={onBack} className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-sunken md:hidden" aria-label="Voltar para a lista">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span className="num">{formatPhone(c.contactId)}</span>
            <span aria-hidden="true">·</span>
            {closed ? (
              <span>Encerrada</span>
            ) : c.mode === 'ai' ? (
              <span className="inline-flex items-center gap-1 text-brand">
                <Bot className="size-3.5" /> Assistente virtual
              </span>
            ) : c.assignedUserName ? (
              <span>Com {mine ? 'você' : c.assignedUserName}</span>
            ) : (
              <span className="text-warn">Aguardando atendente</span>
            )}
          </p>
        </div>
        {canEdit && !closed && !mine && (
          <Button size="sm" icon={<UserRoundCheck className="size-4" />} loading={act.isPending && act.variables?.action === 'assign_me'} onClick={() => act.mutate({ action: 'assign_me' })}>
            Assumir
          </Button>
        )}
        {canEdit && (
          <Menu
            label="Ações da conversa"
            trigger={({ toggle, open }) => (
              <Button variant="ghost" size="icon-sm" onClick={toggle} aria-expanded={open} aria-label="Ações da conversa">
                <MoreHorizontal className="size-[18px]" />
              </Button>
            )}
          >
            {(closeMenu) => (
              <>
                {closed ? (
                  <MenuItem onClick={() => { closeMenu(); act.mutate({ action: 'reopen' }); }}>Reabrir atendimento</MenuItem>
                ) : (
                  <>
                    {c.mode === 'human' && (
                      <MenuItem icon={<Bot />} disabled={!aiEnabled} onClick={() => { closeMenu(); act.mutate({ action: 'to_ai' }); }}>
                        {aiEnabled ? 'Devolver para a assistente' : 'Assistente desativada'}
                      </MenuItem>
                    )}
                    {c.mode === 'ai' && (
                      <MenuItem icon={<UserRoundCheck />} onClick={() => { closeMenu(); act.mutate({ action: 'to_human', reason: `Transferida por ${me.user.name}` }); }}>
                        Passar para a fila humana
                      </MenuItem>
                    )}
                    {detail.data!.team.filter((t) => t.id !== c.assignedUserId).length > 0 && <MenuSeparator />}
                    {detail.data!.team
                      .filter((t) => t.id !== c.assignedUserId)
                      .map((t) => (
                        <MenuItem key={t.id} onClick={() => { closeMenu(); act.mutate({ action: 'transfer_user', userId: t.id }); }}>
                          Transferir para {t.id === me.user.id ? 'mim' : t.name}
                        </MenuItem>
                      ))}
                    <MenuSeparator />
                    <MenuItem onClick={() => { closeMenu(); void close(); }}>Encerrar atendimento</MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onToggleCustomer} aria-label="Ficha do cliente">
          <PanelRight className="size-[18px]" />
        </Button>
      </header>

      {c.mode === 'human' && c.handoffReason && !closed && !c.assignedUserId && (
        <p className="border-b border-warn/20 bg-warn-soft px-4 py-2 text-[0.8125rem] text-warn">Motivo da transferência: {c.handoffReason}</p>
      )}

      <Thread messages={detail.data.messages} />

      {canEdit && (
        <Composer
          key={id}
          conversationId={id}
          customerFirstName={(detail.data.customer?.name ?? c.contactName ?? '').split(' ')[0] ?? ''}
          blocked={
            !canSend
              ? sendBlockedReason
              : !c.windowOpen
                ? 'A janela de 24 horas da WhatsApp está fechada: só dá para escrever quando o cliente mandar uma nova mensagem. Avisos de pedido continuam saindo pelos modelos aprovados.'
                : c.mode === 'ai' && !closed
                  ? 'ai'
                  : null
          }
          onAssume={() => act.mutate({ action: 'assign_me' })}
        />
      )}
    </div>
  );
}

function Thread({ messages }: { messages: InboxMessage[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const groups = useMemo(() => {
    const out: { day: string; items: InboxMessage[] }[] = [];
    for (const m of messages) {
      const day = dayLabel(m.createdAt);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(m);
    }
    return out;
  }, [messages]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto bg-canvas px-3 py-4 sm:px-6"
      aria-live="polite"
    >
      {messages.length === 0 && <p className="py-10 text-center text-sm text-muted">Nenhuma mensagem nesta conversa ainda.</p>}
      {groups.map((g) => (
        <div key={g.day} className="space-y-2">
          <p className="sticky top-0 z-10 mx-auto my-3 w-fit rounded-full bg-sunken px-3 py-1 text-2xs font-medium text-muted">{g.day}</p>
          {g.items.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Bubble({ m }: { m: InboxMessage }) {
  if (m.direction === 'internal') {
    if (m.sender === 'system') {
      return <p className="py-1 text-center text-xs text-muted">{m.body} · {formatTime(m.createdAt)}</p>;
    }
    return (
      <div className="mx-auto max-w-[85%] rounded-lg border border-dashed border-warn/40 bg-warn-soft px-3 py-2 text-sm text-ink sm:max-w-[70%]">
        <p className="mb-0.5 flex items-center gap-1 text-2xs font-semibold text-warn">
          <StickyNote className="size-3" /> Nota interna · {m.senderName}
        </p>
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <p className="mt-1 text-right text-2xs text-muted">{formatTime(m.createdAt)}</p>
      </div>
    );
  }
  const inbound = m.direction === 'inbound';
  const who = inbound ? null : m.sender === 'ai' ? 'Assistente virtual' : m.sender === 'system' ? 'Mensagem automática' : m.senderName;
  return (
    <div className={cx('flex', inbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cx(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%]',
          inbound ? 'rounded-bl-md border border-line bg-surface text-ink' : m.status === 'failed' ? 'rounded-br-md border border-danger/30 bg-danger-soft text-ink' : 'rounded-br-md bg-brand-soft text-ink',
        )}
      >
        {who && (
          <p className={cx('mb-0.5 flex items-center gap-1 text-2xs font-semibold', m.sender === 'ai' ? 'text-brand' : 'text-muted')}>
            {m.sender === 'ai' && <Bot className="size-3" />}
            {who}
            {m.templateName && <span className="font-normal">· modelo {m.templateName}</span>}
          </p>
        )}
        <Media m={m} />
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        <p className="mt-1 flex items-center justify-end gap-1 text-2xs text-muted">
          {formatTime(m.createdAt)}
          {!inbound && <StatusIcon m={m} />}
        </p>
        {m.status === 'failed' && m.error && (
          <p className="mt-1 flex items-start gap-1 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> Não enviada: {m.error}
          </p>
        )}
      </div>
    </div>
  );
}

function Media({ m }: { m: InboxMessage }) {
  const src = m.direction === 'inbound' ? (m.hasMedia ? `/api/inbox/messages/${m.id}/media` : null) : m.mediaUrl;
  if (!src) {
    if (m.type !== 'text' && m.type !== 'template' && m.type !== 'image' && !m.body) return <p className="italic text-muted">Mensagem de um tipo que o painel ainda não exibe.</p>;
    return null;
  }
  if (m.type === 'image') {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        <img src={src} alt="Imagem da conversa" className="max-h-72 rounded-lg object-cover" loading="lazy" />
      </a>
    );
  }
  if (m.type === 'audio') return <audio controls src={src} className="mb-1 max-w-full" />;
  if (m.type === 'video') return <video controls src={src} className="mb-1 max-h-72 rounded-lg" />;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-sunken px-2.5 py-1.5 text-[0.8125rem] font-medium hover:bg-line">
      <FileText className="size-4" /> Abrir arquivo
    </a>
  );
}

function StatusIcon({ m }: { m: InboxMessage }) {
  const label = MESSAGE_STATUS_LABELS[m.status];
  if (m.status === 'pending') return <Clock className="size-3" aria-label={label} />;
  if (m.status === 'sent') return <Check className="size-3" aria-label={label} />;
  if (m.status === 'delivered') return <CheckCheck className="size-3" aria-label={label} />;
  if (m.status === 'read') return <CheckCheck className="size-3 text-info" aria-label={label} />;
  if (m.status === 'failed') return <AlertCircle className="size-3 text-danger" aria-label={label} />;
  return null;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return formatDate(d);
}

function Composer({
  conversationId,
  customerFirstName,
  blocked,
  onAssume,
}: {
  conversationId: string;
  customerFirstName: string;
  /** null: pode enviar. 'ai': a assistente está respondendo. Outro texto: motivo do bloqueio. */
  blocked: string | null;
  onAssume: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [manage, setManage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const replies = useQuery({ queryKey: ['inbox', 'quick-replies'], queryFn: ({ signal }) => get<QuickReply[]>('/inbox/quick-replies', signal), staleTime: 60_000 });

  const replyBlocked = mode === 'reply' && blocked !== null;
  const slash = mode === 'reply' && text.startsWith('/') && !text.includes('\n') ? text.slice(1).toLowerCase() : null;
  const suggestions = slash !== null ? (replies.data ?? []).filter((r) => r.title.toLowerCase().includes(slash)).slice(0, 6) : [];

  const send = useMutation({
    mutationFn: () =>
      mode === 'note'
        ? post(`/inbox/conversations/${conversationId}/notes`, { text })
        : post(`/inbox/conversations/${conversationId}/messages`, { text: text || null, imageUrl: image?.url ?? null }),
    onSuccess: () => {
      setText('');
      setImage(null);
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      area.current?.focus();
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: keys.conversation(conversationId) });
      toast(e instanceof ApiError ? e.message : errorMessage(e), 'error');
    },
  });

  const applyReply = (r: QuickReply) => {
    setText(r.body.replaceAll('{cliente}', customerFirstName));
    area.current?.focus();
  };

  const submit = () => {
    if (send.isPending || replyBlocked) return;
    if (mode === 'note' ? !text.trim() : !text.trim() && !image) return;
    send.mutate();
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      setImage({ url: await uploadImage(file), name: file.name });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="border-t border-line bg-surface px-3 pb-3 pt-2 sm:px-4">
      <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Tipo de mensagem">
        {(['reply', 'note'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cx('rounded-md px-2.5 py-1 text-xs font-medium transition-colors', mode === m ? (m === 'note' ? 'bg-warn-soft text-warn' : 'bg-sunken text-ink') : 'text-muted hover:text-ink')}
          >
            {m === 'reply' ? 'Responder' : 'Nota interna'}
          </button>
        ))}
      </div>

      {replyBlocked ? (
        blocked === 'ai' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-soft px-3.5 py-3 text-sm text-brand-ink">
            <span className="flex items-center gap-2">
              <Bot className="size-4" /> A assistente virtual está respondendo esta conversa.
            </span>
            <Button size="sm" onClick={onAssume}>
              Assumir e responder
            </Button>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-lg bg-sunken px-3.5 py-3 text-[0.8125rem] text-ink-2">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted" /> {blocked}
          </p>
        )
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className={cx('relative rounded-xl border bg-surface transition-colors focus-within:border-ink/40', mode === 'note' ? 'border-warn/40 bg-warn-soft/40' : 'border-line-strong')}
        >
          {suggestions.length > 0 && (
            <ul className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-lg border border-line bg-surface shadow-pop" role="listbox" aria-label="Respostas rápidas">
              {suggestions.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => applyReply(r)} className="block w-full px-3 py-2 text-left hover:bg-canvas">
                    <span className="text-[0.8125rem] font-medium">/{r.title}</span>
                    <span className="block truncate text-xs text-muted">{r.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {image && (
            <div className="flex items-center gap-2 px-3 pt-3">
              <img src={image.url} alt="" className="size-14 rounded-md object-cover" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{image.name}</span>
              <button type="button" onClick={() => setImage(null)} className="grid size-7 place-items-center rounded text-muted hover:bg-sunken" aria-label="Remover imagem">
                <X className="size-4" />
              </button>
            </div>
          )}
          <textarea
            ref={area}
            rows={2}
            value={text}
            maxLength={mode === 'note' ? 2000 : 4096}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (suggestions[0] && slash !== null) applyReply(suggestions[0]);
                else submit();
              }
            }}
            placeholder={mode === 'note' ? 'Só a equipe vê esta nota' : image ? 'Legenda (opcional)' : 'Escreva a resposta. Digite / para respostas rápidas'}
            aria-label={mode === 'note' ? 'Nota interna' : 'Mensagem para o cliente'}
            className="block max-h-40 min-h-[3.25rem] w-full resize-none bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            {mode === 'reply' && (
              <>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
                <Button type="button" variant="ghost" size="icon-sm" loading={uploading} onClick={() => fileRef.current?.click()} aria-label="Enviar imagem">
                  <ImagePlus className="size-[18px]" />
                </Button>
                <Menu
                  align="start"
                  label="Respostas rápidas"
                  trigger={({ toggle, open }) => (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={toggle} aria-expanded={open} aria-label="Respostas rápidas">
                      <MessageSquareText className="size-[18px]" />
                    </Button>
                  )}
                >
                  {(closeMenu) => (
                    <>
                      {(replies.data ?? []).length === 0 && <p className="px-3 py-2 text-xs text-muted">Nenhuma resposta rápida ainda.</p>}
                      {(replies.data ?? []).map((r) => (
                        <MenuItem key={r.id} onClick={() => { closeMenu(); applyReply(r); }}>
                          {r.title}
                        </MenuItem>
                      ))}
                      <MenuSeparator />
                      <MenuItem onClick={() => { closeMenu(); setManage(true); }}>Gerenciar respostas rápidas</MenuItem>
                    </>
                  )}
                </Menu>
              </>
            )}
            <span className="ml-auto mr-2 hidden text-2xs text-faint sm:inline">Enter envia · Shift+Enter quebra a linha</span>
            <Button type="submit" size="sm" icon={<Send className="size-4" />} loading={send.isPending} disabled={mode === 'note' ? !text.trim() : !text.trim() && !image}>
              {mode === 'note' ? 'Anotar' : 'Enviar'}
            </Button>
          </div>
        </form>
      )}
      {manage && <QuickRepliesModal onClose={() => setManage(false)} />}
    </div>
  );
}

export function NoConversation({ whatsappConnected }: { whatsappConnected: boolean }) {
  return (
    <div className="hidden flex-1 flex-col items-center justify-center gap-2 bg-canvas p-8 text-center md:flex">
      <MessageSquareText className="size-8 text-faint" />
      <p className="font-medium">Escolha uma conversa</p>
      <p className="max-w-xs text-sm text-muted">
        {whatsappConnected ? 'As mensagens do WhatsApp da loja chegam aqui em tempo real.' : 'Conecte o WhatsApp da loja para receber as mensagens aqui.'}
      </p>
      {!whatsappConnected && (
        <Link href="/painel/configuracoes?secao=integracoes" className="mt-2 text-sm font-medium text-brand hover:underline">
          Conectar WhatsApp
        </Link>
      )}
      <Badge className="mt-4">Canal: WhatsApp oficial (Cloud API)</Badge>
    </div>
  );
}
