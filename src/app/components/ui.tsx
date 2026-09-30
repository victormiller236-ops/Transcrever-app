"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

/* ---------------- ícones ---------------- */

const PATHS: Record<string, React.ReactNode> = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  bellOff: (
    <>
      <path d="M8.5 4.6A6 6 0 0 1 18 9c0 2.4.4 4 .9 5M6 9c0 6-2.5 7.5-2.5 7.5H15" />
      <path d="M10 20a2 2 0 0 0 4 0M3 3l18 18" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  flag: <path d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  agenda: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M4 9h16M9 9v11" />
    </>
  ),
  text: <path d="M5 6h14M5 11h14M5 16h9" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </>
  ),
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 20h14" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />,
  download: <path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M5 20h14" />,
  logout: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />,
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
  volume: (
    <>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className = "", strokeWidth = 2 }: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

export function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/logo.svg"
      alt=""
      width={size}
      height={size}
      className={`rounded-[22%] shadow-sm ${className}`}
      draggable={false}
    />
  );
}

/* ---------------- bottom sheet ---------------- */

export function Sheet({
  children,
  onClose,
  label,
  tall = false,
  dismissable = true,
}: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
  tall?: boolean;
  dismissable?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const dismissRef = useRef(dismissable);
  useEffect(() => {
    closeRef.current = onClose;
    dismissRef.current = dismissable;
  });

  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey);

    // Botão Voltar do Android fecha a folha em vez de sair do app: a folha ocupa uma entrada do histórico.
    const marker = `pauta-sheet-${Math.random().toString(36).slice(2)}`;
    window.history.pushState({ pautaSheet: marker }, "");
    const onPop = () => {
      if (dismissRef.current) {
        closeRef.current();
      } else {
        // Processando: não dá para fechar agora; repõe a entrada para o próximo Voltar.
        window.history.pushState({ pautaSheet: marker }, "");
      }
    };
    window.addEventListener("popstate", onPop);

    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      // Fechou por botão/gesto (não pelo Voltar): tira a entrada que a folha criou.
      setTimeout(() => {
        if (window.history.state?.pautaSheet === marker) window.history.back();
      }, 0);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <div
        className="anim-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={dismissable ? onClose : undefined}
        data-testid="sheet-backdrop"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`anim-sheet relative w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[28px] bg-[var(--surface)] shadow-2xl ${
          tall ? "h-[92dvh]" : "max-h-[92dvh]"
        }`}
        style={{ paddingBottom: "calc(20px + var(--safe-bottom))" }}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[var(--line)]" />
        {children}
      </div>
    </div>
  );
}

/* ---------------- toasts ---------------- */

interface Toast {
  id: number;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "default" | "error" | "success";
}

interface ToastApi {
  show: (text: string, opts?: { actionLabel?: string; onAction?: () => void; tone?: Toast["tone"]; ms?: number }) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback<ToastApi["show"]>(
    (text, opts = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, text, actionLabel: opts.actionLabel, onAction: opts.onAction, tone: opts.tone }]);
      window.setTimeout(() => dismiss(id), opts.ms ?? (opts.actionLabel ? 6000 : 3500));
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: "calc(104px + var(--safe-bottom))" }}
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`anim-toast pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-[14px] font-medium shadow-xl ${
              t.tone === "error"
                ? "bg-[var(--color-danger)] text-white"
                : "bg-[var(--foreground)] text-[var(--background)]"
            }`}
          >
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.actionLabel && (
              <button
                type="button"
                className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-bold uppercase tracking-wide text-[var(--color-accent)]"
                onClick={() => {
                  t.onAction?.();
                  dismiss(t.id);
                }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------- pequenos blocos ---------------- */

export function Chip({
  active = false,
  onClick,
  children,
  tone,
  className = "",
  ...rest
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  tone?: "danger";
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className">) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-semibold transition-colors ${
        active
          ? "border-transparent bg-[var(--color-primary)] text-[var(--on-primary)]"
          : tone === "danger"
            ? "border-[var(--line)] bg-[var(--surface)] text-[var(--color-danger)]"
            : "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)]"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-bold uppercase tracking-wider text-[var(--muted)]">
        {label}
      </label>
      {children(id)}
    </div>
  );
}
