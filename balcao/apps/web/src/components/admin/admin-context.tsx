'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ORDER_CHANNEL_LABELS, type OrderChannel } from '@balcao/shared';
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

  const onMessage = useCallback(
    (msg: RealtimeMessage) => {
      if (msg.type === 'order.created') {
        void qc.invalidateQueries({ queryKey: ['orders'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
        if (msg.branchId !== branchId) return;
        setNotifications((list) =>
          [{ id: `${msg.orderId}-${Date.now()}`, orderId: msg.orderId, number: msg.number, channel: msg.channel, at: Date.now(), read: false }, ...list].slice(0, 30),
        );
        if (msg.channel === 'menu') {
          if (soundOn) playNewOrderSound();
          toast(`Novo pedido #${msg.number} pelo ${ORDER_CHANNEL_LABELS[msg.channel as OrderChannel].toLowerCase()}`, 'info', {
            label: 'Abrir',
            onClick: () => setOpenOrderId(msg.orderId),
          });
        }
      } else if (msg.type === 'order.updated') {
        void qc.invalidateQueries({ queryKey: ['orders'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      } else if (msg.type === 'catalog.updated') {
        void qc.invalidateQueries({ queryKey: keys.catalog });
      } else if (msg.type === 'store.updated') {
        void qc.invalidateQueries({ queryKey: keys.settings });
      }
    },
    [qc, branchId, soundOn, toast],
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
