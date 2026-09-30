"use client";

import { useEffect, useRef } from "react";
import { addDaysToKey, dayNumber, weekdayShort } from "@/lib/format";

export function WeekStrip({
  todayKey,
  selected,
  onSelect,
  counts,
  days = 21,
}: {
  todayKey: string;
  selected: string;
  onSelect: (key: string) => void;
  /** tarefas abertas por dia (mostra um pontinho) */
  counts: Record<string, number>;
  days?: number;
}) {
  const list = Array.from({ length: days }, (_, i) => addDaysToKey(todayKey, i));
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selected]);

  return (
    <div
      className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-1"
      role="tablist"
      aria-label="Escolher o dia"
    >
      {list.map((key) => {
        const active = key === selected;
        const isToday = key === todayKey;
        return (
          <button
            key={key}
            ref={active ? selectedRef : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${isToday ? "Hoje, " : ""}${weekdayShort(key)} ${dayNumber(key)}`}
            onClick={() => onSelect(key)}
            className={`flex h-[74px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border transition-all ${
              active
                ? "scale-[1.04] border-transparent bg-[var(--color-primary)] text-[var(--on-primary)] shadow-lg"
                : "border-[var(--line)] bg-[var(--surface)]"
            }`}
          >
            <span className={`text-[11px] font-bold uppercase tracking-wide ${active ? "opacity-80" : "text-[var(--muted)]"}`}>
              {weekdayShort(key)}
            </span>
            <span className="text-[20px] font-bold leading-none">{dayNumber(key)}</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                counts[key] ? (active ? "bg-[var(--color-accent)]" : "bg-[var(--color-teal)]") : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
