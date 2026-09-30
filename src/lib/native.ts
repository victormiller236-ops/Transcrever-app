"use client";

// Ponte com o app Android nativo (Capacitor). No navegador comum nada disso existe e o app
// usa as versões web (MediaRecorder, Web Push). Dentro do app Android, a gravação roda num
// serviço em primeiro plano (funciona com a tela apagada) e os lembretes viram alarmes do
// aparelho que tocam e falam com o app fechado.

import { reminderText } from "./reminder-text";
import type { TaskDTO } from "./types";

interface CapacitorLike {
  isNativePlatform?: () => boolean;
  registerPlugin?: <T>(name: string) => T;
}

function capacitor(): CapacitorLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorLike }).Capacitor;
}

export function isNativeApp(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export interface NativeVoiceApi {
  start(): Promise<void>;
  level(): Promise<{ level: number; recording: boolean }>;
  stop(): Promise<{ base64: string; mimeType: string; seconds: number }>;
  cancel(): Promise<void>;
}

export interface NativeReminderItem {
  id: string;
  /** instante do aviso, em milissegundos desde 1970 */
  at: number;
  title: string;
  body: string;
  spoken: string;
}

export interface NativeStatus {
  notifications: boolean;
  exactAlarms: boolean;
  scheduled: number;
}

export interface NativeRemindersApi {
  schedule(o: { items: NativeReminderItem[] }): Promise<NativeStatus>;
  testNow(o: { seconds?: number; title?: string; spoken?: string }): Promise<NativeStatus>;
  status(): Promise<NativeStatus>;
  requestNotifications(): Promise<NativeStatus>;
}

const cache = new Map<string, unknown>();
function plugin<T>(name: string): T | null {
  if (!isNativeApp()) return null;
  if (!cache.has(name)) cache.set(name, capacitor()?.registerPlugin?.<T>(name) ?? null);
  return (cache.get(name) as T | null) ?? null;
}

export const nativeVoice = () => plugin<NativeVoiceApi>("NativeVoice");
export const nativeReminders = () => plugin<NativeRemindersApi>("NativeReminders");

/** Quanto o Android aguenta gravar de uma vez: AAC a 32 kbps ≈ 4 KB/s, dentro do teto de 4,2 MB do envio. */
export const MAX_NATIVE_SECONDS = 15 * 60;

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const HORIZON_MS = 30 * 24 * 3600_000;
const MAX_ITEMS = 150;

/** Lembretes futuros (próximos 30 dias) no formato que o Android agenda. */
export function buildNativeReminders(tasks: TaskDTO[], tz: string, now: number = Date.now()): NativeReminderItem[] {
  const items: NativeReminderItem[] = [];
  for (const t of tasks) {
    if (t.done || !t.dueAt) continue;
    const at = Date.parse(t.dueAt) - t.remindMinutesBefore * 60_000;
    if (!(at > now) || at > now + HORIZON_MS) continue;
    // O texto é montado como será no momento do aviso ("É agora", "Começa daqui a 15 minutos").
    const { body, spoken } = reminderText(
      { title: t.title, dueAt: new Date(t.dueAt), hasTime: t.time !== null, remindMinutesBefore: t.remindMinutesBefore },
      new Date(at),
      tz,
    );
    items.push({ id: t.id, at, title: t.title, body, spoken });
  }
  return items.sort((a, b) => a.at - b.at).slice(0, MAX_ITEMS);
}
