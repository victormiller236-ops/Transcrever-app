// Validação e conversão entre o que chega de fora (Gemini, formulários) e
// o que o banco guarda. Tudo que vem de fora é tratado como não confiável.

import { Task } from "@prisma/client";
import { REPEATS, buildDue, dateKeyInTz, pad2, utcToLocalParts, type Repeat } from "./datetime";
import type { TaskDTO, TaskDraft } from "./types";

export const MAX_TITLE = 200;
export const MAX_NOTES = 2000;
export const MAX_REMIND_MINUTES = 7 * 24 * 60;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

export function normalizeDraft(raw: unknown): TaskDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title, MAX_TITLE);
  if (!title) return null;

  const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  // Sem data, hora não significa nada.
  const time = date && typeof r.time === "string" && /^\d{1,2}:\d{2}$/.test(r.time) ? r.time : null;

  const repeat = REPEATS.includes(r.repeat as Repeat) ? (r.repeat as Repeat) : "none";
  const remind = Number(r.remindMinutesBefore);
  const notes =
    typeof r.notes === "string" && r.notes.trim() ? r.notes.trim().slice(0, MAX_NOTES) : null;

  return {
    title,
    notes,
    date,
    time: time ? time.padStart(5, "0") : null,
    priority: Number(r.priority) === 1 ? 1 : 0,
    repeat,
    remindMinutesBefore: Number.isFinite(remind)
      ? Math.min(Math.max(Math.round(remind), 0), MAX_REMIND_MINUTES)
      : 0,
  };
}

export function taskToDTO(t: Task, tz: string): TaskDTO {
  let date: string | null = null;
  let time: string | null = null;
  if (t.dueAt) {
    const p = utcToLocalParts(t.dueAt, tz);
    date = dateKeyInTz(t.dueAt, tz);
    time = t.hasTime ? `${pad2(p.hour)}:${pad2(p.minute)}` : null;
  }
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    date,
    time,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    priority: t.priority === 1 ? 1 : 0,
    repeat: (REPEATS.includes(t.repeat as Repeat) ? t.repeat : "none") as Repeat,
    remindMinutesBefore: t.remindMinutesBefore,
    done: t.done,
    doneAt: t.doneAt ? t.doneAt.toISOString() : null,
    source: t.source,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Campos do banco a partir de um rascunho validado. */
export function draftToData(d: TaskDraft, tz: string) {
  const { dueAt, hasTime } = buildDue(d.date, d.time, tz);
  return {
    title: d.title,
    notes: d.notes,
    dueAt,
    hasTime,
    priority: d.priority,
    repeat: dueAt ? d.repeat : "none",
    // Sem vencimento não existe "antes de quê".
    remindMinutesBefore: dueAt ? d.remindMinutesBefore : 0,
  };
}
