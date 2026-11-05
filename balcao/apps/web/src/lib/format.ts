export { formatBRL, formatPhone } from '@balcao/shared';

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

export const formatTime = (iso: string | Date) => time.format(new Date(iso));
export const formatDateTime = (iso: string | Date | number) => dateTime.format(new Date(iso));
export const formatDate = (iso: string | Date) => fullDate.format(new Date(iso));
export const formatShortDate = (iso: string | Date) => shortDate.format(new Date(iso));

/** "agora", "há 4 min", "há 2 h", ou data. */
export function timeAgo(iso: string | Date | number, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return formatDateTime(iso);
}

/** Minutos decorridos como "12:05" (min:seg) ou "1h 05". */
export function elapsed(iso: string | Date, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const m = Math.floor(total / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`;
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

export function minutesSince(iso: string | Date, now = Date.now()) {
  return (now - new Date(iso).getTime()) / 60000;
}

export function formatAddress(a: { street: string; number?: string | null; complement?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null } | null): string {
  if (!a) return '';
  const line1 = [a.street, a.number].filter(Boolean).join(', ');
  const line2 = [a.complement, a.neighborhood].filter(Boolean).join(' · ');
  const line3 = [a.city, a.state].filter(Boolean).join(' – ');
  return [line1, line2, line3].filter(Boolean).join(' · ');
}

export function pct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}
