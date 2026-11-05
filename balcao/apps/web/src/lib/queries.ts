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
};

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
