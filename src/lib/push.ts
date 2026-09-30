import webpush from "web-push";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  taskId?: string;
  /** Mostra os botões "Concluir" / "Adiar" na notificação. */
  actions?: boolean;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<void>;

/** Erro de envio com o status HTTP devolvido pelo serviço de push (404/410 = inscrição morta). */
export class PushSendError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
  }
}

let configured = false;

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function ensureConfigured() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new PushSendError("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configuradas.");
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export const sendPush: PushSender = async (target, payload) => {
  ensureConfigured();
  try {
    await webpush.sendNotification(target, JSON.stringify(payload), {
      TTL: 60 * 60, // se o aparelho estiver sem rede, o serviço tenta entregar por 1 hora
      urgency: "high",
    });
  } catch (error) {
    const e = error as { statusCode?: number; message?: string };
    throw new PushSendError(e.message ?? "falha ao enviar push", e.statusCode);
  }
};

const DEFAULT_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

/**
 * O servidor faz um POST para o endpoint guardado, então ele só pode apontar
 * para serviços de push conhecidos (evita usar o servidor para atingir redes internas).
 */
export function isAllowedEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const extra = (process.env.PUSH_ENDPOINT_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_HOSTS, ...extra].some((h) => url.hostname === h || url.hostname.endsWith("." + h));
}
