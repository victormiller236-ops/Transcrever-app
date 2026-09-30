"use client";

import { Icon } from "./ui";

export interface AlertItem {
  key: string;
  taskId: string | null;
  title: string;
  body: string;
}

export function AlertBanner({
  alerts,
  onDone,
  onSnooze,
  onDismiss,
  onOpen,
}: {
  alerts: AlertItem[];
  onDone: (a: AlertItem) => void;
  onSnooze: (a: AlertItem) => void;
  onDismiss: (a: AlertItem) => void;
  onOpen: (a: AlertItem) => void;
}) {
  if (alerts.length === 0) return null;
  return (
    <div className="sticky top-0 z-40 -mx-5 flex flex-col gap-2 px-5 pb-2 pt-[max(8px,var(--safe-top))]" data-testid="alerts">
      {alerts.map((a) => (
        <div
          key={a.key}
          role="alert"
          className="anim-toast rounded-2xl bg-[var(--color-accent)] p-4 text-[var(--on-accent)] shadow-2xl"
          data-testid="alert"
        >
          <div className="flex items-start gap-3">
            <Icon name="bell" size={24} className="anim-bell mt-0.5 shrink-0" />
            <button type="button" onClick={() => onOpen(a)} className="min-w-0 flex-1 text-left">
              <span className="block text-[17px] font-bold leading-snug">{a.title}</span>
              <span className="block text-[13px] font-semibold opacity-80">{a.body}</span>
            </button>
            <button
              type="button"
              onClick={() => onDismiss(a)}
              aria-label="Fechar aviso"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
          {a.taskId && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onDone(a)}
                className="h-11 flex-1 rounded-xl bg-[var(--on-accent)] text-[15px] font-bold text-[var(--color-accent)]"
              >
                Concluir
              </button>
              <button
                type="button"
                onClick={() => onSnooze(a)}
                className="h-11 flex-1 rounded-xl bg-black/10 text-[15px] font-bold"
              >
                Adiar 10 min
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
