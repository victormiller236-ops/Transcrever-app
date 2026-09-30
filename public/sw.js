/* Service worker do MyDay.
 *
 * Faz três coisas: recebe push (avisos das tarefas), trata os botões
 * "Concluir"/"Adiar" da notificação e mostra uma tela amigável sem internet.
 * NÃO guarda telas nem dados em cache: as tarefas são pessoais, ficam atrás
 * de senha e precisam estar sempre atuais. */

const VERSION = "pauta-v1";
const OFFLINE_URL = "/offline.html";
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // Um a um: se um arquivo falhar, a instalação não cai inteira.
      for (const url of [OFFLINE_URL, ICON, "/icons/logo.svg"]) {
        try {
          await cache.add(new Request(url, { cache: "reload" }));
        } catch (_) {}
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("pauta-") && key !== VERSION) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return; // o resto segue direto para a rede
  event.respondWith(
    fetch(req).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached || new Response("Sem conexão", { status: 503, headers: { "content-type": "text/plain" } });
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function parsePayload(event) {
  if (!event.data) return { title: "MyDay", body: "", url: "/", tag: "pauta" };
  try {
    return event.data.json();
  } catch (_) {
    return { title: "MyDay", body: event.data.text(), url: "/", tag: "pauta" };
  }
}

self.addEventListener("push", (event) => {
  const p = parsePayload(event);
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = clients.find((c) => c.visibilityState === "visible");
      if (visible) {
        // App aberto na frente: o aviso aparece dentro dele, sem notificação duplicada.
        visible.postMessage({ type: "push", payload: p });
        return;
      }
      const options = {
        body: p.body || "",
        icon: ICON,
        badge: BADGE,
        tag: p.tag || "pauta",
        renotify: true,
        requireInteraction: Boolean(p.taskId),
        vibrate: [220, 110, 220],
        timestamp: Date.now(),
        data: { url: p.url || "/", taskId: p.taskId || null },
      };
      if (p.actions && p.taskId) {
        options.actions = [
          { action: "done", title: "Concluir" },
          { action: "snooze", title: "Adiar 10 min" },
        ];
      }
      await self.registration.showNotification(p.title || "MyDay", options);
    })(),
  );
});

function tz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (_) {
    return "America/Sao_Paulo";
  }
}

async function callApi(path, method, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-tz": tz() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const { url, taskId } = n.data || {};
  n.close();

  event.waitUntil(
    (async () => {
      if (taskId && (event.action === "done" || event.action === "snooze")) {
        try {
          if (event.action === "done") await callApi("/api/tasks/" + taskId, "PATCH", { done: true });
          else await callApi("/api/tasks/" + taskId + "/snooze", "POST", { minutes: 10 });
          await self.registration.showNotification(event.action === "done" ? "Concluída ✓" : "Adiada 10 min", {
            body: n.title,
            icon: ICON,
            badge: BADGE,
            tag: "pauta-ack",
          });
          // some sozinha
          setTimeout(async () => {
            for (const x of await self.registration.getNotifications({ tag: "pauta-ack" })) x.close();
          }, 2500);
          return;
        } catch (_) {
          // sessão expirada ou sem rede: abre o app para a pessoa resolver lá
        }
      }

      const target = new URL(url || "/", self.location.origin).href;
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) {
            try {
              await c.navigate(target);
            } catch (_) {}
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// O navegador pode trocar a inscrição de push sem aviso; renova e reenvia ao servidor.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldKey = event.oldSubscription && event.oldSubscription.options.applicationServerKey;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: oldKey,
        });
        await callApi("/api/push/subscribe", "POST", { subscription: sub.toJSON() });
      } catch (_) {}
    })(),
  );
});
