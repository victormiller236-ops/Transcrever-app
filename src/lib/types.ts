import type { Repeat } from "./datetime";

/** Tarefa ainda não salva: o que o usuário revisa antes de confirmar. */
export interface TaskDraft {
  title: string;
  notes: string | null;
  /** Data local AAAA-MM-DD */
  date: string | null;
  /** Hora local HH:mm (null = só a data importa) */
  time: string | null;
  priority: 0 | 1;
  repeat: Repeat;
  remindMinutesBefore: number;
}

export interface TaskDTO extends TaskDraft {
  id: string;
  dueAt: string | null;
  done: boolean;
  doneAt: string | null;
  source: string;
  createdAt: string;
}
