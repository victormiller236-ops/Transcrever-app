// Datas e fusos. Todo instante é guardado em UTC; o fuso do usuário só entra
// para interpretar "amanhã às 9h" e para repetir tarefas mantendo o horário
// de parede (09:00 continua 09:00 mesmo se o fuso tiver horário de verão).

export const DEFAULT_TIMEZONE =
  (typeof process !== "undefined" && process.env?.APP_TIMEZONE) || "America/Sao_Paulo";

export type Repeat = "none" | "daily" | "weekly" | "monthly";
export const REPEATS: readonly Repeat[] = ["none", "daily", "weekly", "monthly"];

/** Horário padrão (local) de uma tarefa que só tem data. */
export const DEFAULT_HOUR = 9;

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo */
  weekday: number;
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(tz: unknown): string {
  return isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function utcToLocalParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Diferença (ms) entre o relógio de parede do fuso e o UTC, naquele instante. */
function offsetAt(utcMs: number, tz: string): number {
  const p = utcToLocalParts(new Date(utcMs), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(utcMs / 60000) * 60000;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Converte um horário de parede no fuso `tz` para o instante UTC correspondente. */
export function localToUtc(
  p: { year: number; month: number; day: number; hour: number; minute: number },
  tz: string,
): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  let utc = guess - offsetAt(guess, tz);
  // Reconfere: perto de uma mudança de horário de verão o primeiro palpite erra.
  const second = guess - offsetAt(utc, tz);
  if (second !== utc) utc = second;
  return new Date(utc);
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function dateKeyInTz(date: Date, tz: string): string {
  return toDateKey(utcToLocalParts(date, tz));
}

/** Soma dias a uma data de calendário (sem fuso envolvido). */
export function addDaysToDate(
  d: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function addMonthsToDate(
  d: { year: number; month: number; day: number },
  months: number,
  anchorDay: number,
): { year: number; month: number; day: number } {
  const total = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(anchorDay, daysInMonth(year, month)) };
}

/**
 * Próxima ocorrência de uma tarefa repetida: a primeira data da série que fica
 * estritamente depois de `now`, mantendo o horário de parede original.
 */
export function nextOccurrence(dueAt: Date, repeat: Repeat, tz: string, now: Date): Date | null {
  if (repeat === "none") return null;
  const base = utcToLocalParts(dueAt, tz);
  for (let n = 1; n <= 5000; n++) {
    let date: { year: number; month: number; day: number };
    if (repeat === "daily") date = addDaysToDate(base, n);
    else if (repeat === "weekly") date = addDaysToDate(base, 7 * n);
    else date = addMonthsToDate(base, n, base.day);
    const candidate = localToUtc({ ...date, hour: base.hour, minute: base.minute }, tz);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
}

/**
 * Monta o instante de vencimento a partir de data e hora locais.
 * Sem data → sem vencimento. Com data e sem hora → 09:00 locais, `hasTime = false`.
 */
export function buildDue(
  date: string | null,
  time: string | null,
  tz: string,
): { dueAt: Date | null; hasTime: boolean } {
  if (!date) return { dueAt: null, hasTime: false };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return { dueAt: null, hasTime: false };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { dueAt: null, hasTime: false };
  }
  let hour = DEFAULT_HOUR;
  let minute = 0;
  let hasTime = false;
  if (time) {
    const t = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (t && Number(t[1]) <= 23 && Number(t[2]) <= 59) {
      hour = Number(t[1]);
      minute = Number(t[2]);
      hasTime = true;
    }
  }
  return { dueAt: localToUtc({ year, month, day, hour, minute }, tz), hasTime };
}
