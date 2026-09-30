"use client";

import { useState } from "react";
import type { TaskDraft, TaskDTO } from "@/lib/types";
import { DraftEditor, emptyDraft } from "./DraftEditor";
import { Icon, Sheet } from "./ui";

export function toDraft(t: TaskDTO): TaskDraft {
  return {
    title: t.title,
    notes: t.notes,
    date: t.date,
    time: t.time,
    priority: t.priority,
    repeat: t.repeat,
    remindMinutesBefore: t.remindMinutesBefore,
  };
}

export function TaskSheet({
  task,
  initial,
  todayKey,
  busy,
  onSave,
  onDelete,
  onToggle,
  onClose,
}: {
  task?: TaskDTO;
  initial?: Partial<TaskDraft>;
  todayKey: string;
  busy: boolean;
  onSave: (draft: TaskDraft) => void;
  onDelete?: () => void;
  onToggle?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => (task ? toDraft(task) : emptyDraft(initial)));
  const canSave = draft.title.trim().length > 0 && !busy;

  return (
    <Sheet onClose={onClose} label={task ? "Editar tarefa" : "Nova tarefa"}>
      <form
        className="flex flex-col gap-5 px-5 pb-2 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSave({ ...draft, title: draft.title.trim() });
        }}
        data-testid="task-form"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-bold tracking-tight">{task ? "Editar tarefa" : "Nova tarefa"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)]"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <DraftEditor value={draft} onChange={setDraft} todayKey={todayKey} autoFocus={!task} />

        <div className="flex flex-col gap-2.5">
          <button
            type="submit"
            disabled={!canSave}
            data-testid="save-task"
            className="h-14 rounded-2xl bg-[var(--color-primary)] text-[17px] font-bold text-[var(--on-primary)] shadow-lg disabled:opacity-50"
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
          {task && (
            <div className="flex gap-2.5">
              {onToggle && (
                <button
                  type="button"
                  onClick={onToggle}
                  className="h-12 flex-1 rounded-2xl border border-[var(--line)] text-[15px] font-semibold"
                >
                  <Icon name="check" size={16} className="mr-1.5 inline -translate-y-px" />
                  {task.done ? "Reabrir" : task.repeat !== "none" ? "Concluir esta vez" : "Concluir"}
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  data-testid="delete-task"
                  className="h-12 flex-1 rounded-2xl border border-[var(--line)] text-[15px] font-semibold text-[var(--color-danger)]"
                >
                  <Icon name="trash" size={16} className="mr-1.5 inline -translate-y-px" />
                  Excluir
                </button>
              )}
            </div>
          )}
        </div>
      </form>
    </Sheet>
  );
}
