"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, ApiError, clientTz } from "@/lib/client-api";
import {
  dayLabel,
  doneToday,
  greeting,
  groupByDate,
  groupForDay,
  nowParts,
  shortDate,
  sortTasks,
} from "@/lib/format";
import { getPushState, pushSupported, syncPushSubscription } from "@/lib/pwa";
import type { TaskDraft, TaskDTO } from "@/lib/types";
import { AlertBanner, type AlertItem } from "./components/AlertBanner";
import { emptyDraft } from "./components/DraftEditor";
import { ProgressRing } from "./components/ProgressRing";
import { QuickAdd } from "./components/QuickAdd";
import { RecorderSheet } from "./components/RecorderSheet";
import { ReviewPanel } from "./components/ReviewPanel";
import { SettingsTab, type InstallPromptEvent } from "./components/SettingsTab";
import { TaskRow } from "./components/TaskRow";
import { TaskSheet, toDraft } from "./components/TaskSheet";
import { Icon, type IconName, Logo, Sheet, ToastProvider, useToast } from "./components/ui";
import { WeekStrip } from "./components/WeekStrip";
import { TranscreverClient, type TranscriptionDTO } from "./TranscreverClient";

type Tab = "tarefas" | "agenda" | "transcrever" | "ajustes";

type SheetState =
  | null
  | { kind: "record"; file?: File | null }
  | { kind: "edit"; id: string }
  | { kind: "new"; initial?: Partial<TaskDraft> }
  | { kind: "review"; drafts: TaskDraft[]; transcript: string; via: "gemini" | "local" };

const ALERTED_KEY = "pauta-alerted";
const NUDGED_KEY = "pauta-push-nudged";

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const subscribeNever = () => () => {};

let audioCtx: AudioContext | null = null;
function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audioCtx ??= new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {}
}
function beep() {
  try {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [880, 660, 880].forEach((f, i) => {
      const o = audioCtx!.createOscillator();
      const g = audioCtx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.18);
      o.connect(g).connect(audioCtx!.destination);
      o.start(t0 + i * 0.22);
      o.stop(t0 + i * 0.22 + 0.2);
    });
  } catch {}
}

export function PautaApp(props: {
  initialTasks: TaskDTO[];
  initialTranscriptions: TranscriptionDTO[];
  serverTz: string;
  initialNow: string;
}) {
  return (
    <ToastProvider>
      <Inner {...props} />
    </ToastProvider>
  );
}

function Inner({ initialTasks, initialTranscriptions, serverTz, initialNow }: {
  initialTasks: TaskDTO[];
  initialTranscriptions: TranscriptionDTO[];
  serverTz: string;
  initialNow: string;
}) {
  const toast = useToast();
  // O fuso do aparelho só existe no navegador; no servidor vale o padrão.
  const tz = useSyncExternalStore(subscribeNever, clientTz, () => serverTz);
  const [clock, setClock] = useState(() => nowParts(serverTz, new Date(initialNow)));
  const [tasks, setTasks] = useState<TaskDTO[]>(initialTasks);
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const [tab, setTab] = useState<Tab>("tarefas");
  const [selected, setSelected] = useState(clock.key);
  const [agendaMode, setAgendaMode] = useState<"open" | "done">("open");
  const [showDoneToday, setShowDoneToday] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const alerted = useRef<Set<string>>(new Set());
  const todayKey = clock.key;

  /* ---------- relógio e fuso ---------- */
  useEffect(() => {
    const tick = () => {
      const n = nowParts(tz);
      setClock((prev) => (prev.key === n.key && prev.minutes === n.minutes ? prev : n));
    };
    tick();
    const i = window.setInterval(tick, 20_000);
    return () => window.clearInterval(i);
  }, [tz]);

  // Quando vira o dia, a seleção acompanha o "hoje" se estava nele.
  const lastToday = useRef(todayKey);
  useEffect(() => {
    if (lastToday.current !== todayKey) {
      setSelected((s) => (s === lastToday.current ? todayKey : s));
      lastToday.current = todayKey;
    }
  }, [todayKey]);

  /* ---------- dados ---------- */
  const refresh = useCallback(async () => {
    try {
      const res = await api<{ tasks: TaskDTO[] }>("/api/tasks");
      setTasks(res.tasks);
    } catch {
      /* sem rede: mantém o que está na tela */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Busca inicial dos dados (e renova a inscrição de push) ao abrir o app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    void syncPushSubscription();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    const i = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.clearInterval(i);
    };
  }, [refresh, tz]);

  /* ---------- instalação ---------- */
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      toast.show("Pauta instalado!", { tone: "success" });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [toast]);

  /* ---------- ações de URL (atalhos do ícone e toque na notificação) ---------- */
  const pendingOpenId = useRef<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const action = url.searchParams.get("action");
    const taskId = url.searchParams.get("task");
    /* eslint-disable react-hooks/set-state-in-effect */
    if (action === "record") setSheet({ kind: "record" });
    else if (action === "new") setSheet({ kind: "new" });
    /* eslint-enable react-hooks/set-state-in-effect */
    if (taskId) pendingOpenId.current = taskId;
    if (action || taskId || url.searchParams.get("source")) {
      url.searchParams.delete("action");
      url.searchParams.delete("task");
      url.searchParams.delete("source");
      window.history.replaceState(null, "", url.pathname + (url.search || ""));
    }
  }, []);
  useEffect(() => {
    const id = pendingOpenId.current;
    if (id && tasks.some((t) => t.id === id)) {
      pendingOpenId.current = null;
      setTab("tarefas");
      setSheet({ kind: "edit", id });
    }
  }, [tasks]);

  /* ---------- avisos dentro do app ---------- */
  useEffect(() => {
    try {
      const saved = JSON.parse(lsGet(ALERTED_KEY) || "[]");
      if (Array.isArray(saved)) alerted.current = new Set(saved.slice(-300));
    } catch {}
  }, []);

  const pushAlert = useCallback((item: AlertItem) => {
    setAlerts((list) => (list.some((a) => a.key === item.key) ? list : [...list, item]));
    beep();
    try {
      // O Chrome bloqueia vibração antes do primeiro toque na página.
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([200, 100, 200]);
    } catch {}
  }, []);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const t of tasksRef.current) {
        if (t.done || !t.dueAt) continue;
        const at = Date.parse(t.dueAt) - t.remindMinutesBefore * 60_000;
        // Só avisa aquilo que venceu há pouco; o resto já aparece como atrasado na lista.
        if (at > now || now - at > 10 * 60_000) continue;
        const key = `${t.id}:${t.dueAt}:${t.remindMinutesBefore}`;
        if (alerted.current.has(key)) continue;
        alerted.current.add(key);
        lsSet(ALERTED_KEY, JSON.stringify([...alerted.current].slice(-300)));
        pushAlert({
          key,
          taskId: t.id,
          title: t.title,
          body: t.time ? (t.remindMinutesBefore > 0 ? `Já vai começar · ${t.time}` : `Agora · ${t.time}`) : "Para hoje",
        });
      }
    };
    check();
    const i = window.setInterval(check, 15_000);
    return () => window.clearInterval(i);
  }, [pushAlert, tasks]);

  // Push que chega com o app aberto: o service worker repassa para cá em vez de notificar.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "push") return;
      const p = e.data.payload as { title?: string; body?: string; taskId?: string; tag?: string };
      if (p.taskId) {
        void refresh();
        pushAlert({ key: `push:${p.tag ?? p.taskId}:${Date.now() - (Date.now() % 60_000)}`, taskId: p.taskId, title: p.title ?? "Tarefa", body: p.body ?? "" });
      } else if (p.body) {
        toast.show(p.body);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [pushAlert, refresh, toast]);

  // Navegadores só liberam som depois de um toque.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  /* ---------- operações ---------- */
  const replaceTask = useCallback((updated: TaskDTO) => {
    setTasks((p) => sortTasks(p.map((x) => (x.id === updated.id ? updated : x))));
  }, []);

  async function maybeNudgePush() {
    if (lsGet(NUDGED_KEY) || !pushSupported()) return;
    if ((await getPushState()) !== "off") return;
    lsSet(NUDGED_KEY, "1");
    toast.show("Quer ser avisado no horário das tarefas?", {
      actionLabel: "Ligar avisos",
      onAction: () => setTab("ajustes"),
      ms: 8000,
    });
  }

  async function createTasks(drafts: TaskDraft[], source: "manual" | "voice", transcript?: string) {
    setSaving(true);
    try {
      const res = await api<{ tasks: TaskDTO[] }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ tasks: drafts, source, transcript }),
      });
      setTasks((p) => sortTasks([...res.tasks, ...p]));
      setSheet(null);
      const n = res.tasks.length;
      const first = res.tasks[0];
      toast.show(n === 1 ? "Tarefa salva" : `${n} tarefas salvas`, { tone: "success" });
      if (n === 1 && first.date) {
        setSelected(first.date);
        setTab("tarefas");
      }
      void maybeNudgePush();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Não consegui salvar.", { tone: "error", ms: 5000 });
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string, d: TaskDraft) {
    setSaving(true);
    try {
      const res = await api<{ task: TaskDTO }>(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(d),
      });
      replaceTask(res.task);
      setSheet(null);
      toast.show("Alterações salvas");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Não consegui salvar.", { tone: "error", ms: 5000 });
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(t: TaskDTO) {
    const nextDone = !t.done;
    setTasks((p) =>
      sortTasks(p.map((x) => (x.id === t.id ? { ...x, done: nextDone, doneAt: nextDone ? new Date().toISOString() : null } : x))),
    );
    try {
      const res = await api<{ task: TaskDTO; advanced: boolean }>(`/api/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: nextDone }),
      });
      replaceTask(res.task);
      if (nextDone) {
        toast.show(
          res.advanced && res.task.date
            ? `Feito! Próxima: ${dayLabel(res.task.date, todayKey)}${res.task.time ? ` · ${res.task.time}` : ""}`
            : "Tarefa concluída",
          {
            actionLabel: "Desfazer",
            onAction: async () => {
              try {
                const back = await api<{ task: TaskDTO }>(`/api/tasks/${t.id}`, {
                  method: "PATCH",
                  body: JSON.stringify(res.advanced ? { date: t.date, time: t.time } : { done: false }),
                });
                replaceTask(back.task);
              } catch {
                void refresh();
              }
            },
          },
        );
      }
    } catch (e) {
      replaceTask(t);
      toast.show(e instanceof ApiError ? e.message : "Não consegui atualizar.", { tone: "error" });
    }
  }

  async function deleteTask(t: TaskDTO) {
    setSheet(null);
    setTasks((p) => p.filter((x) => x.id !== t.id));
    try {
      await api(`/api/tasks/${t.id}`, { method: "DELETE" });
      toast.show("Tarefa excluída", {
        actionLabel: "Desfazer",
        onAction: async () => {
          try {
            const res = await api<{ tasks: TaskDTO[] }>("/api/tasks", {
              method: "POST",
              body: JSON.stringify({ ...toDraft(t), source: t.source }),
            });
            setTasks((p) => sortTasks([...res.tasks, ...p]));
          } catch {
            toast.show("Não consegui restaurar.", { tone: "error" });
          }
        },
      });
    } catch (e) {
      setTasks((p) => sortTasks([...p, t]));
      toast.show(e instanceof ApiError ? e.message : "Não consegui excluir.", { tone: "error" });
    }
  }

  async function alertDone(a: AlertItem) {
    setAlerts((l) => l.filter((x) => x.key !== a.key));
    const t = tasksRef.current.find((x) => x.id === a.taskId);
    if (t) await toggleTask(t);
  }
  async function alertSnooze(a: AlertItem) {
    setAlerts((l) => l.filter((x) => x.key !== a.key));
    if (!a.taskId) return;
    try {
      const res = await api<{ task: TaskDTO }>(`/api/tasks/${a.taskId}/snooze`, {
        method: "POST",
        body: JSON.stringify({ minutes: 10 }),
      });
      replaceTask(res.task);
      toast.show("Adiada por 10 minutos");
    } catch {
      toast.show("Não consegui adiar.", { tone: "error" });
    }
  }

  async function extractFromText(text: string) {
    try {
      const res = await api<{ transcript: string; drafts: TaskDraft[]; via: "gemini" | "local" }>("/api/tasks/voice", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setSheet({ kind: "review", drafts: res.drafts, transcript: res.transcript, via: res.via });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Não consegui criar tarefas a partir do texto.", { tone: "error", ms: 5000 });
    }
  }

  /* ---------- derivados ---------- */
  const groups = useMemo(() => groupForDay(tasks, selected, todayKey, clock.minutes), [tasks, selected, todayKey, clock.minutes]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tasks) if (!t.done && t.date) c[t.date] = (c[t.date] ?? 0) + 1;
    return c;
  }, [tasks]);
  const progress = useMemo(() => doneToday(tasks, todayKey, tz), [tasks, todayKey, tz]);
  const doneTodayList = useMemo(
    () => tasks.filter((t) => t.done && t.doneAt && nowParts(tz, new Date(t.doneAt)).key === todayKey),
    [tasks, tz, todayKey],
  );
  const agendaGroups = useMemo(() => groupByDate(tasks), [tasks]);
  const doneList = useMemo(
    () => tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, 100),
    [tasks],
  );

  const dateLabel = useMemo(() => {
    const [y, m, d] = todayKey.split("-").map(Number);
    const text = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
    return text.charAt(0).toUpperCase() + text.slice(1);
  }, [todayKey]);

  const editing = sheet?.kind === "edit" ? tasks.find((t) => t.id === sheet.id) : undefined;
  const openCount = tasks.filter((t) => !t.done).length;

  const rowProps = {
    todayKey,
    nowMinutes: clock.minutes,
    onToggle: toggleTask,
    onOpen: (t: TaskDTO) => setSheet({ kind: "edit", id: t.id }),
  };

  const dayEmpty = groups.overdue.length + groups.day.length + groups.undated.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5" style={{ paddingBottom: "calc(120px + var(--safe-bottom))" }}>
      <AlertBanner
        alerts={alerts}
        onDone={alertDone}
        onSnooze={alertSnooze}
        onDismiss={(a) => setAlerts((l) => l.filter((x) => x.key !== a.key))}
        onOpen={(a) => {
          setAlerts((l) => l.filter((x) => x.key !== a.key));
          if (a.taskId) setSheet({ kind: "edit", id: a.taskId });
        }}
      />

      {/* ---------------- TAREFAS ---------------- */}
      <div hidden={tab !== "tarefas"} className="flex flex-col gap-5">
        <header className="flex items-center gap-3.5 pt-[max(20px,calc(var(--safe-top)+8px))]">
          <Logo size={48} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[var(--muted)]">{dateLabel}</p>
            <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight">{greeting(Math.floor(clock.minutes / 60))}!</h1>
          </div>
          <ProgressRing done={progress.done} total={progress.total} />
        </header>

        <QuickAdd
          tz={tz}
          todayKey={todayKey}
          busy={saving}
          onSubmit={(d) => void createTasks([d], "manual")}
          onMore={(d) => setSheet({ kind: "new", initial: d })}
          onMic={() => setSheet({ kind: "record" })}
        />

        <WeekStrip todayKey={todayKey} selected={selected} onSelect={setSelected} counts={counts} />

        <div className="flex flex-col gap-6" data-testid="task-list">
          {!loaded && tasks.length === 0 && (
            <div className="space-y-2.5">
              <div className="skeleton h-16 rounded-2xl" />
              <div className="skeleton h-16 rounded-2xl" />
            </div>
          )}

          {groups.overdue.length > 0 && (
            <Section title="Atrasadas" count={groups.overdue.length} tone="danger">
              {groups.overdue.map((t, i) => (
                <TaskRow key={t.id} task={t} index={i} showDate {...rowProps} />
              ))}
            </Section>
          )}

          {groups.day.length > 0 && (
            <Section title={`${dayLabel(selected, todayKey)} · ${shortDate(selected)}`} count={groups.day.length}>
              {groups.day.map((t, i) => (
                <TaskRow key={t.id} task={t} index={i} {...rowProps} />
              ))}
            </Section>
          )}

          {groups.undated.length > 0 && (
            <Section title="Quando puder" count={groups.undated.length}>
              {groups.undated.map((t, i) => (
                <TaskRow key={t.id} task={t} index={i} {...rowProps} />
              ))}
            </Section>
          )}

          {loaded && dayEmpty && (
            <div className="anim-rise flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[var(--line)] px-6 py-10 text-center" data-testid="empty-day">
              <Logo size={72} />
              <p className="text-[18px] font-bold">
                {selected === todayKey ? "Nada pendente por hoje" : `Nada marcado para ${dayLabel(selected, todayKey).toLowerCase()}`}
              </p>
              <p className="max-w-[26ch] text-[14px] leading-relaxed text-[var(--muted)]">
                Toque no microfone e diga o que precisa fazer, com dia e hora.
              </p>
            </div>
          )}

          {selected === todayKey && doneTodayList.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setShowDoneToday((v) => !v)}
                aria-expanded={showDoneToday}
                className="flex items-center gap-2 px-1 text-left text-[12px] font-bold uppercase tracking-wider text-[var(--muted)]"
              >
                Concluídas hoje
                <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px]">{doneTodayList.length}</span>
                <span className="ml-auto">{showDoneToday ? "Esconder" : "Mostrar"}</span>
              </button>
              {showDoneToday && (
                <ul className="flex flex-col gap-2.5">
                  {doneTodayList.map((t, i) => (
                    <TaskRow key={t.id} task={t} index={i} {...rowProps} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>

      {/* ---------------- AGENDA ---------------- */}
      <div hidden={tab !== "agenda"} className="flex flex-col gap-5">
        <header className="pt-[max(20px,calc(var(--safe-top)+8px))]">
          <h1 className="text-[28px] font-bold tracking-tight">Agenda</h1>
          <p className="text-[14px] text-[var(--muted)]">
            {openCount === 0 ? "Tudo em dia." : openCount === 1 ? "1 tarefa em aberto." : `${openCount} tarefas em aberto.`}
          </p>
        </header>

        <div className="flex gap-1 rounded-2xl bg-[var(--surface-2)] p-1" role="tablist" aria-label="Filtro">
          {(
            [
              ["open", "Próximas"],
              ["done", "Concluídas"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={agendaMode === k}
              onClick={() => setAgendaMode(k)}
              className={`h-11 flex-1 rounded-xl text-[15px] font-bold transition-colors ${
                agendaMode === k ? "bg-[var(--surface)] shadow-sm" : "text-[var(--muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {agendaMode === "open" ? (
          agendaGroups.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-[var(--line)] px-6 py-10 text-center text-[14px] text-[var(--muted)]">
              Nenhuma tarefa em aberto.
            </p>
          ) : (
            <div className="flex flex-col gap-6" data-testid="agenda-list">
              {agendaGroups.map((g) => {
                const late = g.key !== null && g.key < todayKey;
                return (
                  <Section
                    key={g.key ?? "none"}
                    title={g.key === null ? "Sem data" : late ? `Atrasadas · ${shortDate(g.key)}` : `${dayLabel(g.key, todayKey)} · ${shortDate(g.key)}`}
                    tone={late ? "danger" : undefined}
                  >
                    {g.tasks.map((t, i) => (
                      <TaskRow key={t.id} task={t} index={i} {...rowProps} />
                    ))}
                  </Section>
                );
              })}
            </div>
          )
        ) : doneList.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-[var(--line)] px-6 py-10 text-center text-[14px] text-[var(--muted)]">
            Você ainda não concluiu nenhuma tarefa.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {doneList.map((t, i) => (
              <TaskRow key={t.id} task={t} index={i} showDate {...rowProps} />
            ))}
          </ul>
        )}
      </div>

      {/* ---------------- TRANSCREVER ---------------- */}
      <div hidden={tab !== "transcrever"} className="flex flex-1 flex-col">
        <TranscreverClient initialTranscriptions={initialTranscriptions} onExtract={extractFromText} />
      </div>

      {/* ---------------- AJUSTES ---------------- */}
      <div hidden={tab !== "ajustes"} className="pt-[max(20px,calc(var(--safe-top)+8px))]">
        {tab === "ajustes" && (
          <SettingsTab tz={tz} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} />
        )}
      </div>

      {/* ---------------- NAVEGAÇÃO ---------------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-blur-xl"
        style={{ paddingBottom: "var(--safe-bottom)" }}
        aria-label="Navegação"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2">
          <NavButton id="tarefas" current={tab} icon="list" label="Tarefas" onSelect={setTab} />
          <NavButton id="agenda" current={tab} icon="agenda" label="Agenda" onSelect={setTab} />
          <div className="relative flex h-16 justify-center">
            <button
              type="button"
              onClick={() => setSheet({ kind: "record" })}
              aria-label="Gravar tarefa por voz"
              data-testid="record-fab"
              className="mic-pulse absolute -top-7 z-0 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--on-accent)] shadow-[0_10px_28px_rgba(240,160,32,0.45)] transition-transform active:scale-90"
            >
              <Icon name="mic" size={30} strokeWidth={2.3} />
            </button>
          </div>
          <NavButton id="transcrever" current={tab} icon="text" label="Transcrever" onSelect={setTab} />
          <NavButton id="ajustes" current={tab} icon="settings" label="Ajustes" onSelect={setTab} />
        </div>
      </nav>

      {/* ---------------- SHEETS ---------------- */}
      {sheet?.kind === "record" && (
        <RecorderSheet
          todayKey={todayKey}
          initialFile={sheet.file}
          saving={saving}
          onClose={() => setSheet(null)}
          onSave={(drafts, transcript) => void createTasks(drafts, "voice", transcript)}
        />
      )}
      {sheet?.kind === "new" && (
        <TaskSheet
          todayKey={todayKey}
          initial={sheet.initial ?? emptyDraft()}
          busy={saving}
          onClose={() => setSheet(null)}
          onSave={(d) => void createTasks([d], "manual")}
        />
      )}
      {editing && (
        <TaskSheet
          key={editing.id}
          task={editing}
          todayKey={todayKey}
          busy={saving}
          onClose={() => setSheet(null)}
          onSave={(d) => void saveEdit(editing.id, d)}
          onDelete={() => void deleteTask(editing)}
          onToggle={() => {
            setSheet(null);
            void toggleTask(editing);
          }}
        />
      )}
      {sheet?.kind === "review" && (
        <Sheet onClose={() => setSheet(null)} label="Tarefas encontradas no texto">
          <ReviewPanel
            drafts={sheet.drafts}
            transcript={sheet.transcript}
            via={sheet.via}
            todayKey={todayKey}
            saving={saving}
            onSave={(drafts) => void createTasks(drafts, "voice", sheet.transcript)}
            onCancel={() => setSheet(null)}
          />
        </Sheet>
      )}
    </div>
  );
}

function Section({ title, count, tone, children }: { title: string; count?: number; tone?: "danger"; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2
        className={`flex items-center gap-2 px-1 text-[12px] font-bold uppercase tracking-wider ${
          tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--muted)]"
        }`}
      >
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--muted)]">{count}</span>
        )}
      </h2>
      <ul className="flex flex-col gap-2.5">{children}</ul>
    </section>
  );
}

function NavButton({
  id,
  current,
  icon,
  label,
  onSelect,
}: {
  id: Tab;
  current: Tab;
  icon: IconName;
  label: string;
  onSelect: (t: Tab) => void;
}) {
  const active = current === id;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-current={active ? "page" : undefined}
      data-testid={`nav-${id}`}
      className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors ${
        active ? "text-[var(--color-primary)]" : "text-[var(--faint)]"
      }`}
    >
      <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-[var(--surface-2)]" : ""}`}>
        <Icon name={icon} size={21} strokeWidth={active ? 2.4 : 2} />
      </span>
      {label}
    </button>
  );
}
