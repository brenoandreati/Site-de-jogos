'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ORDER_CHANNEL_LABELS, hasAccess, type OrderChannel } from '@balcao/shared';
import { playNewOrderSound, unlockAudio, useRealtime, type RealtimeMessage, type RealtimeStatus } from '@/lib/realtime';
import { keys } from '@/lib/queries';
import { useFeedback } from '@/components/ui/feedback';
import type { Me } from '@/lib/types';

export interface AppNotification {
  id: string;
  orderId: string;
  number: number;
  channel: string;
  at: number;
  read: boolean;
}

interface AdminContextValue {
  me: Me;
  realtime: RealtimeStatus;
  notifications: AppNotification[];
  markAllRead: () => void;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
  openOrder: (id: string | null) => void;
  openOrderId: string | null;
}

const Ctx = createContext<AdminContextValue | null>(null);

const SOUND_KEY = 'balcao:sound';

export function AdminProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [soundOn, setSoundState] = useState(true);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSoundState(localStorage.getItem(SOUND_KEY) !== 'off');
    } catch {
      /* armazenamento indisponível */
    }
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const setSoundOn = useCallback((v: boolean) => {
    setSoundState(v);
    if (v) unlockAudio();
    try {
      localStorage.setItem(SOUND_KEY, v ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);

  const branchId = me.active?.branchId;
  const router = useRouter();
  const canInbox = !!me.active && hasAccess(me.active.permissions, 'inbox', 'view');

  const onMessage = useCallback(
    (msg: RealtimeMessage) => {
      if (msg.type === 'order.created' || msg.type === 'order.updated') void qc.invalidateQueries({ queryKey: ['kitchen'] });
      const announce = (orderId: string, number: number, channel: string, text: string) => {
        setNotifications((list) => [{ id: `${orderId}-${Date.now()}`, orderId, number, channel, at: Date.now(), read: false }, ...list].slice(0, 30));
        if (channel !== 'menu') return;
        if (soundOn) playNewOrderSound();
        toast(text, 'info', { label: 'Abrir', onClick: () => setOpenOrderId(orderId) });
      };
      if (msg.type === 'order.created') {
        void qc.invalidateQueries({ queryKey: ['orders'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
        // Pedido com PIX online só é anunciado quando o Mercado Pago confirmar o pagamento.
        if (msg.branchId !== branchId || msg.status === 'awaiting_confirmation') return;
        announce(msg.orderId, msg.number, msg.channel, `Novo pedido #${msg.number} pelo ${ORDER_CHANNEL_LABELS[msg.channel as OrderChannel].toLowerCase()}`);
      } else if (msg.type === 'order.updated') {
        void qc.invalidateQueries({ queryKey: ['orders'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
        if (msg.branchId === branchId && msg.fromStatus === 'awaiting_confirmation' && (msg.status === 'new' || msg.status === 'confirmed')) {
          announce(msg.orderId, msg.number, 'menu', `Novo pedido #${msg.number} com PIX pago`);
        }
      } else if (msg.type === 'catalog.updated') {
        void qc.invalidateQueries({ queryKey: keys.catalog });
      } else if (msg.type === 'store.updated') {
        void qc.invalidateQueries({ queryKey: keys.settings });
        void qc.invalidateQueries({ queryKey: keys.zones });
      } else if (msg.type === 'delivery.updated') {
        void qc.invalidateQueries({ queryKey: ['delivery'] });
      } else if (msg.type === 'payment.updated') {
        // O anúncio do pedido pago vem pelo order.updated (aguardando pagamento → novo).
        void qc.invalidateQueries({ queryKey: ['orders'] });
      } else if (msg.type === 'conversation.updated') {
        void qc.invalidateQueries({ queryKey: ['inbox'] });
        if (msg.reason === 'handoff' && canInbox) {
          if (soundOn) playNewOrderSound();
          toast('Cliente aguardando atendimento humano.', 'info', { label: 'Atender', onClick: () => router.push(`/painel/atendimento?c=${msg.conversationId}`) });
        }
      }
    },
    [qc, branchId, soundOn, toast, canInbox, router],
  );

  const realtime = useRealtime(me.active?.tenant.id, onMessage);

  const value = useMemo<AdminContextValue>(
    () => ({
      me,
      realtime,
      notifications,
      markAllRead: () => setNotifications((list) => list.map((n) => ({ ...n, read: true }))),
      soundOn,
      setSoundOn,
      openOrder: setOpenOrderId,
      openOrderId,
    }),
    [me, realtime, notifications, soundOn, setSoundOn, openOrderId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AdminProvider ausente');
  return ctx;
}
