// Textos e agrupamentos da tela. Tudo puro (recebe "hoje" e o fuso de fora).

import { addDaysToDate, pad2, toDateKey, type Repeat } from "./datetime";
import type { TaskDTO } from "./types";

const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function parseKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

export function addDaysToKey(key: string, days: number): string {
  return toDateKey(addDaysToDate(parseKey(key), days));
}

export function weekdayOfKey(key: string): number {
  const { year, month, day } = parseKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Hoje";
  if (key === addDaysToKey(todayKey, 1)) return "Amanhã";
  if (key === addDaysToKey(todayKey, -1)) return "Ontem";
  const { month, day } = parseKey(key);
  return `${WEEKDAYS_SHORT[weekdayOfKey(key)]}, ${day} ${MONTHS_SHORT[month - 1]}`;
}

export function shortDate(key: string): string {
  const { month, day } = parseKey(key);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

export function weekdayShort(key: string): string {
  return WEEKDAYS_SHORT[weekdayOfKey(key)];
}

export function dayNumber(key: string): number {
  return parseKey(key).day;
}

export function greeting(hour: number): string {
  if (hour < 5) return "Boa madrugada";
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function remindLabel(minutes: number): string {
  if (minutes <= 0) return "Na hora";
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 dia antes" : `${minutes / 1440} dias antes`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hora antes" : `${minutes / 60} horas antes`;
  return `${minutes} min antes`;
}

export const REMIND_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440];

export function repeatLabel(r: Repeat): string {
  return { none: "Não repete", daily: "Todo dia", weekly: "Toda semana", monthly: "Todo mês" }[r];
}

export function nowParts(tz: string, now: Date = new Date()): { key: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    key: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export interface TaskGroups {
  overdue: TaskDTO[];
  day: TaskDTO[];
  undated: TaskDTO[];
}

function byDue(a: TaskDTO, b: TaskDTO): number {
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

/** Uma tarefa está atrasada se o dia já passou, ou se é hoje com hora que já foi. */
export function isOverdue(t: TaskDTO, todayKey: string, nowMinutes: number): boolean {
  if (t.done || !t.date) return false;
  if (t.date < todayKey) return true;
  if (t.date === todayKey && t.time) {
    const [h, m] = t.time.split(":").map(Number);
    return h * 60 + m < nowMinutes;
  }
  return false;
}

/** Visão "Dia": atrasadas e sem data só aparecem quando o dia escolhido é hoje. */
export function groupForDay(
  tasks: TaskDTO[],
  selectedKey: string,
  todayKey: string,
  nowMinutes: number,
): TaskGroups {
  const open = tasks.filter((t) => !t.done);
  const isToday = selectedKey === todayKey;
  const overdue = isToday ? open.filter((t) => isOverdue(t, todayKey, nowMinutes)).sort(byDue) : [];
  const overdueIds = new Set(overdue.map((t) => t.id));
  const day = open.filter((t) => t.date === selectedKey && !overdueIds.has(t.id)).sort(byDue);
  const undated = isToday ? open.filter((t) => !t.date).sort(byDue) : [];
  return { overdue, day, undated };
}

/** Visão "Próximas": agrupa por data. */
export function groupByDate(tasks: TaskDTO[]): { key: string | null; tasks: TaskDTO[] }[] {
  const open = tasks.filter((t) => !t.done).sort(byDue);
  const groups: { key: string | null; tasks: TaskDTO[] }[] = [];
  for (const t of open) {
    const last = groups[groups.length - 1];
    if (last && last.key === t.date) last.tasks.push(t);
    else groups.push({ key: t.date, tasks: [t] });
  }
  return groups;
}

export function doneToday(tasks: TaskDTO[], todayKey: string, tz: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (t.done && t.doneAt) {
      const k = nowParts(tz, new Date(t.doneAt)).key;
      if (k === todayKey) {
        done++;
        total++;
      }
    } else if (!t.done && t.date && t.date <= todayKey) {
      total++;
    }
  }
  return { done, total };
}

export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;
}

export function sortTasks(tasks: TaskDTO[]): TaskDTO[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return byDue(a, b);
  });
}
