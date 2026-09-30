"use client";

import { useState } from "react";
import { dayLabel, remindLabel, repeatLabel } from "@/lib/format";
import type { TaskDraft } from "@/lib/types";
import { DraftEditor } from "./DraftEditor";
import { Icon } from "./ui";

/** Confere (e corrige) as tarefas que a IA entendeu antes de salvar. */
export function ReviewPanel({
  drafts,
  transcript,
  via,
  todayKey,
  saving,
  onSave,
  onRetry,
  onCancel,
}: {
  drafts: TaskDraft[];
  transcript: string;
  via: "gemini" | "local";
  todayKey: string;
  saving: boolean;
  onSave: (drafts: TaskDraft[]) => void;
  onRetry?: () => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState(() => drafts.map((d, i) => ({ key: i, draft: d })));
  const [open, setOpen] = useState<number | null>(drafts.length === 1 ? 0 : null);
  const [showTranscript, setShowTranscript] = useState(false);
  const valid = items.filter((i) => i.draft.title.trim());

  return (
    <div className="px-5 pb-2 pt-4" data-testid="review-panel">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--on-accent)]">
          <Icon name="sparkle" size={16} />
        </span>
        <h2 className="text-[20px] font-bold tracking-tight">
          {items.length === 1 ? "Entendi 1 tarefa" : `Entendi ${items.length} tarefas`}
        </h2>
      </div>
      <p className="mb-4 text-[14px] text-[var(--muted)]">
        Confira e ajuste o que precisar antes de salvar.
        {via === "local" && " (Interpretação simples: a IA não estruturou a fala.)"}
      </p>

      <ul className="flex flex-col gap-3">
        {items.map((it, idx) => {
          const d = it.draft;
          const isOpen = open === it.key;
          return (
            <li
              key={it.key}
              className="anim-rise rounded-2xl border border-[var(--line)] bg-[var(--background)] p-3.5"
              data-testid="draft-card"
            >
              {isOpen ? (
                <DraftEditor
                  value={d}
                  todayKey={todayKey}
                  onChange={(next) => setItems((list) => list.map((x) => (x.key === it.key ? { ...x, draft: next } : x)))}
                />
              ) : (
                <button
                  type="button"
                  className="flex w-full items-start gap-3 text-left"
                  onClick={() => setOpen(it.key)}
                  aria-label={`Editar: ${d.title || "tarefa sem título"}`}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[12px] font-bold">
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold leading-snug">{d.title || "Sem título"}</span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[var(--muted)]">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="calendar" size={13} />
                        {d.date ? dayLabel(d.date, todayKey) : "Sem data"}
                      </span>
                      {d.time && (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="clock" size={13} />
                          {d.time}
                        </span>
                      )}
                      {d.repeat !== "none" && (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="repeat" size={13} />
                          {repeatLabel(d.repeat)}
                        </span>
                      )}
                      {d.remindMinutesBefore > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="bell" size={13} />
                          {remindLabel(d.remindMinutesBefore)}
                        </span>
                      )}
                      {d.priority === 1 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent)]">
                          <Icon name="flag" size={13} />
                          Importante
                        </span>
                      )}
                    </span>
                  </span>
                  <Icon name="edit" size={16} className="mt-1 shrink-0 text-[var(--faint)]" />
                </button>
              )}
              {items.length > 1 && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="text-[13px] font-semibold text-[var(--color-danger)]"
                    onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
                  >
                    Descartar esta
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {transcript && (
        <div className="mt-4">
          <button
            type="button"
            className="text-[13px] font-semibold text-[var(--muted)] underline underline-offset-2"
            onClick={() => setShowTranscript((v) => !v)}
            aria-expanded={showTranscript}
          >
            {showTranscript ? "Esconder o que eu ouvi" : "Ver o que eu ouvi"}
          </button>
          {showTranscript && (
            <p className="anim-fade mt-2 rounded-xl bg-[var(--surface-2)] p-3 text-[14px] leading-relaxed text-[var(--muted)]" data-testid="transcript">
              “{transcript}”
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        <button
          type="button"
          disabled={saving || valid.length === 0}
          onClick={() => onSave(valid.map((i) => i.draft))}
          className="h-14 rounded-2xl bg-[var(--color-primary)] text-[17px] font-bold text-[var(--on-primary)] shadow-lg disabled:opacity-50"
          data-testid="save-drafts"
        >
          {saving ? "Salvando…" : valid.length === 1 ? "Salvar tarefa" : `Salvar ${valid.length} tarefas`}
        </button>
        <div className="flex gap-2.5">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={saving}
              className="h-12 flex-1 rounded-2xl border border-[var(--line)] text-[15px] font-semibold"
            >
              <Icon name="mic" size={16} className="mr-1.5 inline -translate-y-px" />
              Gravar de novo
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-12 flex-1 rounded-2xl border border-[var(--line)] text-[15px] font-semibold text-[var(--muted)]"
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
}
