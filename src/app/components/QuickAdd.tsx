"use client";

import { useMemo, useState } from "react";
import { parseQuickText } from "@/lib/quickparse";
import { dayLabel, remindLabel, repeatLabel } from "@/lib/format";
import type { TaskDraft } from "@/lib/types";
import { Icon } from "./ui";

export function QuickAdd({
  tz,
  todayKey,
  busy,
  onSubmit,
  onMore,
  onMic,
}: {
  tz: string;
  todayKey: string;
  busy: boolean;
  onSubmit: (draft: TaskDraft) => void;
  onMore: (draft: TaskDraft) => void;
  onMic: () => void;
}) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseQuickText(text, new Date(), tz) : null), [text, tz]);

  function toDraft(): TaskDraft | null {
    if (!parsed) return null;
    const title = parsed.title || text.trim();
    if (!title) return null;
    return {
      title,
      notes: null,
      date: parsed.date,
      time: parsed.time,
      priority: parsed.priority,
      repeat: parsed.repeat,
      remindMinutesBefore: parsed.remindMinutesBefore,
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const d = toDraft();
    if (!d || busy) return;
    onSubmit(d);
    setText("");
  }

  const hasChips = parsed && (parsed.date || parsed.time || parsed.priority || parsed.repeat !== "none");

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="quick-add">
      <div className="flex items-center gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface)] py-1 pl-4 pr-1 shadow-[var(--shadow)] focus-within:border-[var(--color-accent)]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nova tarefa… ex.: amanhã 15h ligar pro João"
          aria-label="Nova tarefa"
          enterKeyHint="send"
          maxLength={300}
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--faint)]"
          data-testid="quick-input"
        />
        {text.trim() ? (
          <>
            <button
              type="button"
              onClick={() => {
                const d = toDraft();
                if (d) {
                  onMore(d);
                  setText("");
                }
              }}
              aria-label="Mais opções"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--muted)]"
            >
              <Icon name="edit" size={18} />
            </button>
            <button
              type="submit"
              disabled={busy}
              aria-label="Adicionar tarefa"
              data-testid="quick-submit"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary)] text-[var(--on-primary)] disabled:opacity-50"
            >
              <Icon name="plus" size={20} strokeWidth={2.6} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onMic}
            aria-label="Falar uma tarefa"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--color-accent)]"
          >
            <Icon name="mic" size={20} />
          </button>
        )}
      </div>

      {hasChips && parsed && (
        <div className="anim-fade flex flex-wrap gap-1.5 px-1 text-[12.5px] font-semibold" data-testid="quick-preview">
          {parsed.date && (
            <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1">
              {dayLabel(parsed.date, todayKey)}
              {parsed.time ? ` · ${parsed.time}` : ""}
            </span>
          )}
          {!parsed.date && parsed.time && <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1">{parsed.time}</span>}
          {parsed.repeat !== "none" && (
            <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1">{repeatLabel(parsed.repeat)}</span>
          )}
          {parsed.remindMinutesBefore > 0 && (
            <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1">{remindLabel(parsed.remindMinutesBefore)}</span>
          )}
          {parsed.priority === 1 && (
            <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[var(--color-accent)]">Importante</span>
          )}
        </div>
      )}
    </form>
  );
}
