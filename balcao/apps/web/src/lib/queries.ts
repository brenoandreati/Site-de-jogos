'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import type { AdminCatalog, Order, Settings } from './types';

export const keys = {
  me: ['me'] as const,
  board: ['orders', 'board'] as const,
  orders: (params: string) => ['orders', 'list', params] as const,
  order: (id: string) => ['orders', 'detail', id] as const,
  settings: ['settings'] as const,
  catalog: ['catalog'] as const,
  dashboard: (params: string) => ['dashboard', params] as const,
  team: ['team'] as const,
  inbox: (filter: string) => ['inbox', 'list', filter] as const,
  conversation: (id: string) => ['inbox', 'conversation', id] as const,
  kitchen: ['kitchen'] as const,
  delivery: ['delivery', 'board'] as const,
  zones: ['delivery', 'zones'] as const,
  integrations: ['integrations'] as const,
  ai: ['ai', 'settings'] as const,
};

export interface InboxListResponse {
  conversations: {
    id: string;
    contactId: string;
    contactName: string | null;
    customerName: string | null;
    customerPhone: string | null;
    status: 'open' | 'waiting' | 'closed';
    mode: 'ai' | 'human';
    unreadCount: number;
    lastMessageAt: string | null;
    lastInboundAt: string | null;
    lastMessagePreview: string | null;
    handoffReason: string | null;
    assignedUserId: string | null;
    assignedUserName: string | null;
    windowOpen: boolean;
  }[];
  counts: { unread: number; waiting: number; ai: number };
  whatsapp: { status: string; displayPhoneNumber: string | null; lastError: string | null } | null;
  aiEnabled: boolean;
}

export function useInboxCounts(enabled = true) {
  return useQuery({
    queryKey: keys.inbox('all'),
    queryFn: ({ signal }) => get<InboxListResponse>('/inbox/conversations?filter=all', signal),
    enabled,
    staleTime: 10_000,
  });
}

export function useBoard(options: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: keys.board,
    queryFn: ({ signal }) => get<{ serverTime: string; orders: Order[] }>('/orders/board', signal),
    enabled: options.enabled ?? true,
    // Se o tempo real cair, o quadro continua atualizando sozinho.
    refetchInterval: options.poll ? 20_000 : false,
  });
}

export function useSettings(enabled = true) {
  return useQuery({ queryKey: keys.settings, queryFn: ({ signal }) => get<Settings>('/settings', signal), enabled });
}

export function useCatalog(enabled = true) {
  return useQuery({ queryKey: keys.catalog, queryFn: ({ signal }) => get<AdminCatalog>('/catalog', signal), enabled });
}
