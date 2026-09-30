"use client";

import { useState } from "react";
import type { Repeat } from "@/lib/datetime";
import { REPEATS } from "@/lib/datetime";
import { REMIND_OPTIONS, addDaysToKey, dayLabel, remindLabel, repeatLabel } from "@/lib/format";
import type { TaskDraft } from "@/lib/types";
import { Chip, Field, Icon } from "./ui";

const TIME_PRESETS = [
  { label: "Manhã", value: "09:00" },
  { label: "Meio-dia", value: "12:00" },
  { label: "Tarde", value: "15:00" },
  { label: "Noite", value: "19:00" },
];

const inputCls =
  "h-12 w-full rounded-2xl border border-[var(--line)] bg-[var(--background)] px-4 text-[16px] focus:border-[var(--color-accent)] focus:outline-none";

export function DraftEditor({
  value,
  onChange,
  todayKey,
  autoFocus = false,
  compact = false,
}: {
  value: TaskDraft;
  onChange: (next: TaskDraft) => void;
  todayKey: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [showNotes, setShowNotes] = useState(Boolean(value.notes));
  const tomorrowKey = addDaysToKey(todayKey, 1);
  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });

  function setDate(date: string | null) {
    if (!date) set({ date: null, time: null, repeat: "none", remindMinutesBefore: 0 });
    else set({ date });
  }
  function setTime(time: string | null) {
    // Escolher uma hora sem ter escolhido o dia significa "hoje".
    set({ time, date: value.date ?? todayKey });
  }

  const customDate = value.date && value.date !== todayKey && value.date !== tomorrowKey;

  return (
    <div className="flex flex-col gap-4">
      <Field label="O que fazer">
        {(id) => (
          <input
            id={id}
            value={value.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Ex.: Ligar para o João"
            maxLength={200}
            autoFocus={autoFocus}
            enterKeyHint="done"
            className={`${inputCls} font-semibold`}
          />
        )}
      </Field>

      <Field label="Quando">
        {() => (
          <div className="flex flex-wrap gap-2">
            <Chip active={value.date === todayKey} onClick={() => setDate(todayKey)}>
              Hoje
            </Chip>
            <Chip active={value.date === tomorrowKey} onClick={() => setDate(tomorrowKey)}>
              Amanhã
            </Chip>
            <label
              className={`relative inline-flex h-10 cursor-pointer items-center gap-1.5 overflow-hidden rounded-full border px-3.5 text-[14px] font-semibold ${
                customDate
                  ? "border-transparent bg-[var(--color-primary)] text-[var(--on-primary)]"
                  : "border-[var(--line)] bg-[var(--surface)]"
              }`}
            >
              <Icon name="calendar" size={16} />
              {customDate ? dayLabel(value.date!, todayKey) : "Escolher dia"}
              <input
                type="date"
                aria-label="Escolher o dia"
                value={value.date ?? ""}
                min="2020-01-01"
                onChange={(e) => setDate(e.target.value || null)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <Chip active={!value.date} onClick={() => setDate(null)}>
              Sem data
            </Chip>
          </div>
        )}
      </Field>

      {value.date && (
        <Field label="Horário">
          {(id) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  type="time"
                  value={value.time ?? ""}
                  onChange={(e) => setTime(e.target.value || null)}
                  className={`${inputCls} flex-1`}
                />
                {value.time && (
                  <button
                    type="button"
                    onClick={() => set({ time: null, remindMinutesBefore: 0 })}
                    className="h-12 shrink-0 rounded-2xl border border-[var(--line)] px-4 text-[14px] font-semibold text-[var(--muted)]"
                  >
                    Sem hora
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {TIME_PRESETS.map((p) => (
                  <Chip key={p.value} active={value.time === p.value} onClick={() => setTime(p.value)}>
                    {p.label} · {p.value}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </Field>
      )}

      {value.date && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Avisar">
            {(id) => (
              <select
                id={id}
                value={value.remindMinutesBefore}
                onChange={(e) => set({ remindMinutesBefore: Number(e.target.value) })}
                className={inputCls}
              >
                {REMIND_OPTIONS.filter((m) => m === 0 || value.time || m >= 1440).map((m) => (
                  <option key={m} value={m}>
                    {remindLabel(m)}
                  </option>
                ))}
                {!REMIND_OPTIONS.includes(value.remindMinutesBefore) && (
                  <option value={value.remindMinutesBefore}>{remindLabel(value.remindMinutesBefore)}</option>
                )}
              </select>
            )}
          </Field>
          <Field label="Repetir">
            {(id) => (
              <select
                id={id}
                value={value.repeat}
                onChange={(e) => set({ repeat: e.target.value as Repeat })}
                className={inputCls}
              >
                {REPEATS.map((r) => (
                  <option key={r} value={r}>
                    {repeatLabel(r)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}

      {!compact && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Chip
              active={value.priority === 1}
              onClick={() => set({ priority: value.priority === 1 ? 0 : 1 })}
              aria-label="Marcar como importante"
            >
              <Icon name="flag" size={16} />
              Importante
            </Chip>
            {!showNotes && (
              <Chip onClick={() => setShowNotes(true)}>
                <Icon name="text" size={16} />
                Detalhes
              </Chip>
            )}
          </div>
          {showNotes && (
            <Field label="Detalhes">
              {(id) => (
                <textarea
                  id={id}
                  value={value.notes ?? ""}
                  onChange={(e) => set({ notes: e.target.value || null })}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--background)] px-4 py-3 text-[16px] focus:border-[var(--color-accent)] focus:outline-none"
                />
              )}
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

export function emptyDraft(over: Partial<TaskDraft> = {}): TaskDraft {
  return {
    title: "",
    notes: null,
    date: null,
    time: null,
    priority: 0,
    repeat: "none",
    remindMinutesBefore: 0,
    ...over,
  };
}
