'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasAccess, type AccessLevel, type ModuleKey } from '@balcao/shared';
import { get } from './api';
import type { Me } from './types';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: ({ signal }) => get<Me>('/auth/me', signal), staleTime: 60_000 });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (me: Me) => {
    qc.setQueryData(['me'], me);
  };
}

/** Verifica permissão no cliente apenas para esconder ações; a API sempre verifica de novo. */
export function useCan() {
  const { data } = useMe();
  return (module: ModuleKey, level: Exclude<AccessLevel, 'none'> = 'view') =>
    !!data?.active && hasAccess(data.active.permissions, module, level);
}
