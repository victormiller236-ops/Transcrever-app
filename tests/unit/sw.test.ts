// Executa o public/sw.js de verdade num sandbox com `self`, `caches`, `fetch` e `clients` simulados.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type Handler = (event: Record<string, unknown>) => void;

function load() {
  const handlers: Record<string, Handler> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const cacheStore = new Map<string, unknown>();
  const calls: { fetch: { url: string; init?: RequestInit }[]; opened: string[]; focused: number; navigated: string[] } = {
    fetch: [],
    opened: [],
    focused: 0,
    navigated: [],
  };

  const state = {
    windowClients: [] as Record<string, unknown>[],
    fetchImpl: (async () => new Response("{}", { status: 200 })) as (url: string, init?: RequestInit) => Promise<Response>,
    cacheAddFails: false,
    existingNotifications: [] as { tag: string; close: () => void }[],
  };

  const self = {
    location: { origin: "https://pauta.test" },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: vi.fn(async () => {}),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: async () => state.windowClients,
      openWindow: async (u: string) => {
        calls.opened.push(u);
      },
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
      getNotifications: async () => state.existingNotifications,
      pushManager: { subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } }) })) },
    },
  };

  const sandbox: Record<string, unknown> = {
    self,
    URL,
    // No navegador, URLs relativas resolvem contra a origem do service worker; o Node exige URL absoluta.
    Request: class extends Request {
      constructor(input: string | Request, init?: RequestInit) {
        super(typeof input === "string" ? new URL(input, "https://pauta.test").href : input, init);
      }
    },
    Response,
    Intl,
    JSON,
    Promise,
    setTimeout: (fn: () => void) => void fn,
    caches: {
      open: async () => ({
        add: async (req: Request) => {
          if (state.cacheAddFails) throw new Error("falha");
          cacheStore.set(new URL(req.url, "https://pauta.test").pathname, new Response("offline!"));
        },
      }),
      keys: async () => ["pauta-v0", "pauta-v1", "outro-app"],
      delete: vi.fn(async () => true),
      match: async (u: string) => cacheStore.get(u),
    },
    fetch: (url: string, init?: RequestInit) => {
      calls.fetch.push({ url, init });
      return state.fetchImpl(url, init);
    },
  };
  vm.runInNewContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), sandbox);

  async function fire(type: string, extra: Record<string, unknown> = {}) {
    const pending: Promise<unknown>[] = [];
    const event = { waitUntil: (p: Promise<unknown>) => pending.push(p), ...extra };
    handlers[type](event);
    await Promise.all(pending);
    return event;
  }
  const push = (payload: unknown) =>
    fire("push", { data: { json: () => payload, text: () => String(payload) } });

  return { self, handlers, shown, calls, state, fire, push, cacheStore, sandbox };
}

const payload = { title: "Ligar para o banco", body: "Agora · 15:00", url: "/?task=t1", tag: "task-t1", taskId: "t1", actions: true };

describe("service worker: push", () => {
  it("app fechado: mostra a notificação com botões Concluir/Adiar, tag e link", async () => {
    const sw = load();
    await sw.push(payload);
    expect(sw.shown).toHaveLength(1);
    const { title, options } = sw.shown[0];
    expect(title).toBe("Ligar para o banco");
    expect(options).toMatchObject({
      body: "Agora · 15:00",
      tag: "task-t1",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      requireInteraction: true,
      data: { url: "/?task=t1", taskId: "t1" },
    });
    expect((options.actions as { action: string }[]).map((a) => a.action)).toEqual(["done", "snooze"]);
  });

  it("app aberto na frente: repassa para a página e NÃO duplica com notificação do sistema", async () => {
    const sw = load();
    const postMessage = vi.fn();
    sw.state.windowClients = [{ visibilityState: "hidden", postMessage: vi.fn() }, { visibilityState: "visible", postMessage }];
    await sw.push(payload);
    expect(sw.shown).toHaveLength(0);
    expect(postMessage).toHaveBeenCalledWith({ type: "push", payload });
  });

  it("app aberto mas escondido: notifica normalmente", async () => {
    const sw = load();
    sw.state.windowClients = [{ visibilityState: "hidden", postMessage: vi.fn() }];
    await sw.push(payload);
    expect(sw.shown).toHaveLength(1);
  });

  it("aviso sem tarefa (teste) não ganha botões; payload ruim não derruba", async () => {
    const sw = load();
    await sw.push({ title: "Pauta", body: "teste", tag: "pauta-teste" });
    expect(sw.shown[0].options.actions).toBeUndefined();
    expect(sw.shown[0].options.requireInteraction).toBe(false);

    const broken = load();
    await broken.fire("push", {
      data: {
        json: () => {
          throw new Error("json inválido");
        },
        text: () => "texto solto",
      },
    });
    expect(broken.shown[0]).toMatchObject({ title: "Pauta", options: { body: "texto solto" } });

    const empty = load();
    await empty.fire("push", { data: null });
    expect(empty.shown[0].title).toBe("Pauta");
  });
});

describe("service worker: clique na notificação", () => {
  const notification = (over: Record<string, unknown> = {}) => ({ title: "Ligar para o banco", close: vi.fn(), data: { url: "/?task=t1", taskId: "t1" }, ...over });

  it("Concluir: PATCH na API com o fuso, confirma e NÃO abre o app", async () => {
    const sw = load();
    const n = notification();
    await sw.fire("notificationclick", { notification: n, action: "done" });
    expect(n.close).toHaveBeenCalled();
    const call = sw.calls.fetch[0];
    expect(call.url).toBe("/api/tasks/t1");
    expect(call.init).toMatchObject({ method: "PATCH", credentials: "same-origin" });
    expect(JSON.parse(call.init!.body as string)).toEqual({ done: true });
    expect((call.init!.headers as Record<string, string>)["x-tz"]).toBeTruthy();
    expect(sw.shown.at(-1)).toMatchObject({ title: "Concluída ✓", options: { body: "Ligar para o banco", tag: "pauta-ack" } });
    expect(sw.calls.opened).toHaveLength(0);
  });

  it("Adiar: POST snooze de 10 minutos", async () => {
    const sw = load();
    await sw.fire("notificationclick", { notification: notification(), action: "snooze" });
    expect(sw.calls.fetch[0].url).toBe("/api/tasks/t1/snooze");
    expect(JSON.parse(sw.calls.fetch[0].init!.body as string)).toEqual({ minutes: 10 });
    expect(sw.shown.at(-1)!.title).toBe("Adiada 10 min");
  });

  it("Concluir com a API falhando (sessão expirada/sem rede): abre o app para resolver lá", async () => {
    const sw = load();
    sw.state.fetchImpl = async () => new Response("", { status: 401 });
    await sw.fire("notificationclick", { notification: notification(), action: "done" });
    expect(sw.shown).toHaveLength(0);
    expect(sw.calls.opened).toEqual(["https://pauta.test/?task=t1"]);
  });

  it("toque no corpo: foca a janela aberta e navega até a tarefa", async () => {
    const sw = load();
    const client = { focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) };
    sw.state.windowClients = [client];
    await sw.fire("notificationclick", { notification: notification(), action: "" });
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith("https://pauta.test/?task=t1");
    expect(sw.calls.opened).toHaveLength(0);
    expect(sw.calls.fetch).toHaveLength(0);
  });

  it("toque no corpo com o app fechado: abre uma janela nova", async () => {
    const sw = load();
    await sw.fire("notificationclick", { notification: notification({ data: { url: "/?task=zz", taskId: "zz" } }), action: "" });
    expect(sw.calls.opened).toEqual(["https://pauta.test/?task=zz"]);
  });

  it("ação sem id de tarefa cai no comportamento padrão", async () => {
    const sw = load();
    await sw.fire("notificationclick", { notification: notification({ data: { url: "/", taskId: null } }), action: "done" });
    expect(sw.calls.fetch).toHaveLength(0);
    expect(sw.calls.opened).toEqual(["https://pauta.test/"]);
  });
});

describe("service worker: ciclo de vida e offline", () => {
  it("instala mesmo se o cache falhar (nada de instalação presa) e assume o controle", async () => {
    const sw = load();
    sw.state.cacheAddFails = true;
    await expect(sw.fire("install")).resolves.toBeDefined();
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it("ao ativar apaga só caches antigos do próprio app", async () => {
    const sw = load();
    await sw.fire("activate");
    const del = (sw.sandbox.caches as { delete: ReturnType<typeof vi.fn> }).delete;
    expect(del).toHaveBeenCalledWith("pauta-v0");
    expect(del).not.toHaveBeenCalledWith("pauta-v1");
    expect(del).not.toHaveBeenCalledWith("outro-app");
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it("sem internet, navegação mostra a página offline; requisições de dados não são interceptadas", async () => {
    const sw = load();
    await sw.fire("install");
    const offlineFetch = async () => {
      throw new TypeError("rede caiu");
    };
    sw.state.fetchImpl = offlineFetch;

    let responded: Promise<Response> | undefined;
    sw.handlers.fetch({ request: { mode: "navigate", url: "https://pauta.test/" }, respondWith: (p: Promise<Response>) => (responded = p) });
    expect(await (await responded!).text()).toBe("offline!");

    let intercepted = false;
    sw.handlers.fetch({ request: { mode: "cors", url: "https://pauta.test/api/tasks" }, respondWith: () => (intercepted = true) });
    expect(intercepted).toBe(false); // a API sempre vai direto à rede: nada de dado de tarefa em cache
  });

  it("renova a inscrição de push quando o navegador a troca", async () => {
    const sw = load();
    await sw.fire("pushsubscriptionchange", { oldSubscription: { options: { applicationServerKey: new Uint8Array([1, 2]) } } });
    expect(sw.self.registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.anything() });
    expect(sw.calls.fetch[0].url).toBe("/api/push/subscribe");
  });
});
