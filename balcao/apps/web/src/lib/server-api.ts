import type { PublicStore } from './types';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Leitura do cardápio público no servidor (renderização rápida e indexável). */
export async function fetchStore(slug: string): Promise<PublicStore | null> {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const res = await fetch(`${API}/api/public/stores/${encodeURIComponent(slug)}`, { next: { revalidate: 10 } }).catch(() => null);
  if (!res) throw new Error('API indisponível');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Erro ${res.status} ao carregar a loja`);
  return (await res.json()) as PublicStore;
}

/** Cor do texto sobre a cor da loja: branco ou grafite, pelo contraste. */
export function accentVars(hex: string | null) {
  const color = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#1f6b4f';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  const ink = lum > 0.4 ? '#1b1b18' : '#ffffff';
  return {
    '--accent': color,
    '--accent-strong': `color-mix(in srgb, ${color} 85%, black)`,
    '--accent-soft': `color-mix(in srgb, ${color} 9%, white)`,
    '--accent-ink': ink,
  } as Record<string, string>;
}
