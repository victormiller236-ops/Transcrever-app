"use client";

import { useState } from "react";
import { dayLabel, isOverdue, remindLabel, repeatLabel } from "@/lib/format";
import type { TaskDTO } from "@/lib/types";
import { Icon } from "./ui";

export function TaskRow({
  task,
  todayKey,
  nowMinutes,
  showDate = false,
  onToggle,
  onOpen,
  index = 0,
}: {
  task: TaskDTO;
  todayKey: string;
  nowMinutes: number;
  showDate?: boolean;
  onToggle: (t: TaskDTO) => void;
  onOpen: (t: TaskDTO) => void;
  index?: number;
}) {
  const [popping, setPopping] = useState(false);
  const overdue = isOverdue(task, todayKey, nowMinutes);

  return (
    <li
      className="anim-rise flex items-stretch gap-1 rounded-2xl bg-[var(--surface)] shadow-[var(--shadow)]"
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
      data-testid="task-row"
      data-task-title={task.title}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Reabrir: ${task.title}` : `Concluir: ${task.title}`}
        onClick={() => {
          setPopping(true);
          onToggle(task);
        }}
        className="flex w-14 shrink-0 items-center justify-center"
      >
        <span
          onAnimationEnd={() => setPopping(false)}
          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors ${
            popping ? "anim-check" : ""
          } ${
            task.done
              ? "border-[var(--color-teal)] bg-[var(--color-teal)] text-white"
              : task.priority === 1
                ? "border-[var(--color-accent)]"
                : "border-[var(--faint)]"
          }`}
        >
          {task.done && <Icon name="check" size={16} strokeWidth={3} />}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onOpen(task)}
        className="min-w-0 flex-1 py-3.5 pr-4 text-left"
        aria-label={`Editar: ${task.title}`}
      >
        <span
          className={`block text-[16px] font-semibold leading-snug break-words ${
            task.done ? "text-[var(--faint)] line-through" : ""
          }`}
        >
          {task.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--muted)]">
          {(showDate || overdue) && task.date && (
            <span className={overdue ? "font-bold text-[var(--color-danger)]" : ""}>
              {dayLabel(task.date, todayKey)}
            </span>
          )}
          {task.time && (
            <span className={`inline-flex items-center gap-1 ${overdue ? "font-bold text-[var(--color-danger)]" : ""}`}>
              <Icon name="clock" size={13} />
              {task.time}
            </span>
          )}
          {task.repeat !== "none" && (
            <span className="inline-flex items-center gap-1" title={repeatLabel(task.repeat)}>
              <Icon name="repeat" size={13} />
              {repeatLabel(task.repeat)}
            </span>
          )}
          {task.remindMinutesBefore > 0 && task.date && (
            <span className="inline-flex items-center gap-1">
              <Icon name="bell" size={13} />
              {remindLabel(task.remindMinutesBefore)}
            </span>
          )}
          {task.priority === 1 && (
            <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent)]">
              <Icon name="flag" size={13} />
              Importante
            </span>
          )}
          {task.source === "voice" && (
            <span className="inline-flex items-center gap-1 text-[var(--faint)]" title="Criada por voz">
              <Icon name="mic" size={13} />
            </span>
          )}
        </span>
        {task.notes && <span className="mt-1 block truncate text-[13px] text-[var(--faint)]">{task.notes}</span>}
      </button>
    </li>
  );
}
