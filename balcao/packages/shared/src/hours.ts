/**
 * Horário de funcionamento. Os intervalos são no fuso horário da unidade.
 * Um intervalo que fecha "antes" de abrir atravessa a meia-noite (ex.: 18:00–02:00).
 */

export const WEEKDAYS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
] as const;
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export interface OpeningInterval {
  weekday: number; // 0 = domingo
  opensAt: string; // HH:MM
  closesAt: string; // HH:MM
}

export interface StoreAvailabilityInput {
  hours: OpeningInterval[];
  timeZone: string;
  /** Fechamento temporário manual. Enquanto estiver no futuro (ou sem data), a loja fica fechada. */
  pausedUntil?: Date | null;
  isPaused?: boolean;
}

export interface StoreAvailability {
  isOpen: boolean;
  reason: 'open' | 'paused' | 'outside_hours' | 'no_hours';
  /** Próxima abertura conhecida, quando fechada. */
  nextOpening: { weekday: number; opensAt: string } | null;
  /** Horário de fechamento do intervalo atual, quando aberta. */
  closesAt: string | null;
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

/** Dia da semana e minuto do dia em um fuso horário. */
export function localTime(date: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function activeInterval(hours: OpeningInterval[], weekday: number, minutes: number): OpeningInterval | null {
  for (const h of hours) {
    const open = toMinutes(h.opensAt);
    const close = toMinutes(h.closesAt);
    const overnight = close <= open;
    if (h.weekday === weekday) {
      if (!overnight && minutes >= open && minutes < close) return h;
      if (overnight && minutes >= open) return h;
    }
    // Intervalo de ontem que atravessa a meia-noite.
    if (overnight && h.weekday === (weekday + 6) % 7 && minutes < close) return h;
  }
  return null;
}

function findNextOpening(hours: OpeningInterval[], weekday: number, minutes: number) {
  for (let offset = 0; offset < 8; offset++) {
    const day = (weekday + offset) % 7;
    const candidates = hours
      .filter((h) => h.weekday === day && (offset > 0 || toMinutes(h.opensAt) > minutes))
      .sort((a, b) => toMinutes(a.opensAt) - toMinutes(b.opensAt));
    if (candidates[0]) return { weekday: day, opensAt: candidates[0].opensAt };
  }
  return null;
}

export function getStoreAvailability(input: StoreAvailabilityInput, now: Date = new Date()): StoreAvailability {
  const { weekday, minutes } = localTime(now, input.timeZone);
  const paused = input.isPaused && (!input.pausedUntil || input.pausedUntil.getTime() > now.getTime());
  if (input.hours.length === 0) return { isOpen: false, reason: 'no_hours', nextOpening: null, closesAt: null };
  if (paused) {
    return { isOpen: false, reason: 'paused', nextOpening: findNextOpening(input.hours, weekday, minutes), closesAt: null };
  }
  const current = activeInterval(input.hours, weekday, minutes);
  if (current) return { isOpen: true, reason: 'open', nextOpening: null, closesAt: current.closesAt };
  return { isOpen: false, reason: 'outside_hours', nextOpening: findNextOpening(input.hours, weekday, minutes), closesAt: null };
}

export function describeAvailability(a: StoreAvailability, todayWeekday?: number): string {
  if (a.isOpen) return a.closesAt ? `Aberto · fecha às ${a.closesAt}` : 'Aberto';
  if (a.reason === 'no_hours') return 'Fechado';
  if (a.reason === 'paused' && !a.nextOpening) return 'Fechado temporariamente';
  if (!a.nextOpening) return 'Fechado';
  const sameDay = todayWeekday !== undefined && a.nextOpening.weekday === todayWeekday;
  const tomorrow = todayWeekday !== undefined && a.nextOpening.weekday === (todayWeekday + 1) % 7;
  const when = sameDay ? 'hoje' : tomorrow ? 'amanhã' : WEEKDAYS[a.nextOpening.weekday]!.toLowerCase();
  const prefix = a.reason === 'paused' ? 'Fechado temporariamente' : 'Fechado';
  return `${prefix} · abre ${when} às ${a.nextOpening.opensAt}`;
}

export function validateIntervals(hours: OpeningInterval[]): string | null {
  for (const h of hours) {
    if (!Number.isInteger(h.weekday) || h.weekday < 0 || h.weekday > 6) return 'Dia da semana inválido.';
    if (!TIME_RE.test(h.opensAt) || !TIME_RE.test(h.closesAt)) return 'Use horários no formato HH:MM.';
    if (h.opensAt === h.closesAt) return `Abertura e fechamento iguais em ${WEEKDAYS[h.weekday]}.`;
  }
  // Sobreposição no mesmo dia (considerando apenas intervalos que não atravessam a meia-noite).
  for (let d = 0; d < 7; d++) {
    const day = hours
      .filter((h) => h.weekday === d)
      .map((h) => {
        const s = toMinutes(h.opensAt);
        let e = toMinutes(h.closesAt);
        if (e <= s) e += 24 * 60;
        return [s, e] as const;
      })
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < day.length; i++) {
      if (day[i]![0] < day[i - 1]![1]) return `Há horários sobrepostos em ${WEEKDAYS[d]}.`;
    }
  }
  return null;
}
