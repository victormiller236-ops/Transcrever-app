import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { login, type Session } from "../helpers/client";
import { decryptPush, makeSubscription } from "../helpers/push-decrypt";
import { startStack, type Stack } from "../helpers/stack";

process.env.DATABASE_URL ??= "postgresql://postgres@localhost:5433/tarefas?host=/tmp";
const prisma = new PrismaClient();

let stack: Stack;
let s: Session;

function wav(seconds = 1): Buffer {
  const rate = 16000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2);
  return buf;
}

function audioForm(buf: Buffer, type = "audio/wav") {
  const f = new FormData();
  f.append("audio", new File([new Uint8Array(buf)], "fala.wav", { type }));
  return f;
}

const post = (path: string, body: unknown, tz?: string) =>
  s.json(path, { method: "POST", body: JSON.stringify(body), tz });
const patch = (path: string, body: unknown, tz?: string) =>
  s.json(path, { method: "PATCH", body: JSON.stringify(body), tz });

beforeAll(async () => {
  stack = await startStack({ appPort: 3101 });
  s = await login(stack.baseUrl, stack.env.APP_PASSWORD);
}, 120_000);

afterAll(async () => {
  await stack?.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.task.deleteMany();
  await prisma.pushSubscription.deleteMany();
  stack.gemini.reset();
  stack.push.reset();
});

describe("acesso e arquivos públicos do PWA", () => {
  it("a API recusa quem não tem sessão (JSON 401, não redirecionamento)", async () => {
    for (const [method, path] of [
      ["GET", "/api/tasks"],
      ["POST", "/api/tasks"],
      ["POST", "/api/tasks/voice"],
      ["POST", "/api/push/subscribe"],
      ["POST", "/api/push/test"],
      ["GET", "/api/push/key"],
    ] as const) {
      const r = await fetch(stack.baseUrl + path, { method, redirect: "manual", body: method === "POST" ? "{}" : undefined, headers: { "content-type": "application/json" } });
      expect(r.status, `${method} ${path}`).toBe(401);
      expect((await r.json()).error).toBe("unauthorized");
    }
  });

  it("a página inicial manda para o login sem sessão", async () => {
    const r = await fetch(stack.baseUrl + "/", { redirect: "manual" });
    expect([302, 307]).toContain(r.status);
    expect(r.headers.get("location")).toContain("/login");
  });

  it("manifest, service worker, ícones e offline abrem SEM login (exigência do Chrome para instalar)", async () => {
    const m = await fetch(stack.baseUrl + "/manifest.webmanifest", { redirect: "manual" });
    expect(m.status).toBe(200);
    const manifest = await m.json();
    expect(manifest).toMatchObject({ short_name: "Pauta", display: "standalone", start_url: "/?source=pwa", scope: "/", lang: "pt-BR" });
    const purposes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));

    const sw = await fetch(stack.baseUrl + "/sw.js", { redirect: "manual" });
    expect(sw.status).toBe(200);
    expect(sw.headers.get("content-type")).toContain("javascript");
    expect(sw.headers.get("cache-control")).toContain("no-cache");
    expect(sw.headers.get("service-worker-allowed")).toBe("/");

    for (const icon of manifest.icons) {
      const r = await fetch(stack.baseUrl + icon.src, { redirect: "manual" });
      expect(r.status, icon.src).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
    }
    for (const shot of manifest.screenshots) {
      const r = await fetch(stack.baseUrl + shot.src, { redirect: "manual" });
      expect(r.status, shot.src).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
    }
    for (const p of ["/icons/apple-touch-icon.png", "/icons/logo.svg", "/icons/badge-96.png", "/offline.html"]) {
      expect((await fetch(stack.baseUrl + p, { redirect: "manual" })).status, p).toBe(200);
    }
  });

  it("o cron exige o segredo certo", async () => {
    const none = await fetch(stack.baseUrl + "/api/cron/dispatch", { method: "POST" });
    expect(none.status).toBe(401);
    const wrong = await fetch(stack.baseUrl + "/api/cron/dispatch", { method: "POST", headers: { authorization: "Bearer errado" } });
    expect(wrong.status).toBe(401);
    const short = await fetch(stack.baseUrl + "/api/cron/dispatch", { method: "POST", headers: { authorization: "Bearer x" } });
    expect(short.status).toBe(401);
    const ok = await fetch(stack.baseUrl + "/api/cron/dispatch", { method: "POST", headers: { authorization: "Bearer segredo-do-cron" } });
    expect(ok.status).toBe(200);
  });
});

describe("tarefas: criar e listar", () => {
  it("converte data/hora do fuso do usuário para UTC e devolve no mesmo fuso", async () => {
    const r = await post("/api/tasks", { title: "  Ligar   para o João ", date: "2026-10-05", time: "15:30", remindMinutesBefore: 15, priority: 1 });
    expect(r.status).toBe(201);
    const t = r.data.tasks[0];
    expect(t).toMatchObject({ title: "Ligar para o João", date: "2026-10-05", time: "15:30", dueAt: "2026-10-05T18:30:00.000Z", remindMinutesBefore: 15, priority: 1, done: false, source: "manual" });

    // o mesmo horário visto de outro fuso
    const l = await s.json("/api/tasks", { tz: "Asia/Tokyo" });
    expect(l.data.tasks[0]).toMatchObject({ date: "2026-10-06", time: "03:30" });
  });

  it("só data vira 09:00 locais sem mostrar hora", async () => {
    const r = await post("/api/tasks", { title: "Pagar boleto", date: "2026-10-10" });
    expect(r.data.tasks[0]).toMatchObject({ date: "2026-10-10", time: null, dueAt: "2026-10-10T12:00:00.000Z" });
  });

  it("sem data ignora hora, repetição e antecedência", async () => {
    const r = await post("/api/tasks", { title: "Comprar pão", time: "10:00", repeat: "daily", remindMinutesBefore: 30 });
    expect(r.data.tasks[0]).toMatchObject({ date: null, time: null, dueAt: null, repeat: "none", remindMinutesBefore: 0 });
  });

  it("várias de uma vez, com origem voz e transcrição", async () => {
    const r = await post("/api/tasks", { source: "voice", transcript: "falei duas coisas", tasks: [{ title: "A" }, { title: "B", date: "2026-10-01" }] });
    expect(r.status).toBe(201);
    expect(r.data.tasks).toHaveLength(2);
    const row = await prisma.task.findFirst({ where: { title: "A" } });
    expect(row).toMatchObject({ source: "voice", transcript: "falei duas coisas" });
  });

  it("valida a entrada", async () => {
    expect((await post("/api/tasks", { title: "   " })).status).toBe(400);
    expect((await post("/api/tasks", { tasks: [] })).status).toBe(400);
    expect((await post("/api/tasks", { tasks: Array.from({ length: 21 }, () => ({ title: "x" })) })).status).toBe(400);
    expect((await s.json("/api/tasks", { method: "POST", body: "{nao json" })).status).toBe(400);
    // data impossível é descartada em vez de quebrar
    const r = await post("/api/tasks", { title: "x", date: "2026-02-30", time: "10:00" });
    expect(r.data.tasks[0]).toMatchObject({ date: null, dueAt: null });
    // título gigante é cortado
    const big = await post("/api/tasks", { title: "a".repeat(500) });
    expect(big.data.tasks[0].title).toHaveLength(200);
  });

  it("lista ordenada: abertas por vencimento, sem data depois, feitas por último", async () => {
    await post("/api/tasks", { tasks: [{ title: "sem data" }, { title: "tarde", date: "2026-10-05", time: "18:00" }, { title: "cedo", date: "2026-10-05", time: "08:00" }, { title: "feita", date: "2026-10-01" }] });
    const feita = (await prisma.task.findFirst({ where: { title: "feita" } }))!;
    await patch(`/api/tasks/${feita.id}`, { done: true });
    const l = await s.json("/api/tasks");
    expect(l.data.tasks.map((t: { title: string }) => t.title)).toEqual(["cedo", "tarde", "sem data", "feita"]);
    const open = await s.json("/api/tasks?scope=open");
    expect(open.data.tasks).toHaveLength(3);
    const done = await s.json("/api/tasks?scope=done");
    expect(done.data.tasks).toHaveLength(1);
  });
});

describe("tarefas: editar, concluir, repetir, excluir", () => {
  async function make(body: Record<string, unknown>) {
    const r = await post("/api/tasks", body);
    return r.data.tasks[0] as { id: string; dueAt: string | null };
  }

  it("edita campos e zera o aviso quando o horário muda", async () => {
    const t = await make({ title: "Reunião", date: "2026-10-05", time: "10:00" });
    await prisma.task.update({ where: { id: t.id }, data: { remindedAt: new Date() } });
    const r = await patch(`/api/tasks/${t.id}`, { title: "Reunião com a Ana", date: "2026-10-06", time: "11:15", notes: "sala 3", remindMinutesBefore: 30 });
    expect(r.status).toBe(200);
    expect(r.data.task).toMatchObject({ title: "Reunião com a Ana", date: "2026-10-06", time: "11:15", notes: "sala 3", remindMinutesBefore: 30 });
    expect((await prisma.task.findUnique({ where: { id: t.id } }))!.remindedAt).toBeNull();
  });

  it("tirar a data limpa repetição e antecedência", async () => {
    const t = await make({ title: "x", date: "2026-10-05", time: "10:00", repeat: "weekly", remindMinutesBefore: 10 });
    const r = await patch(`/api/tasks/${t.id}`, { date: null, time: null });
    expect(r.data.task).toMatchObject({ date: null, dueAt: null, repeat: "none", remindMinutesBefore: 0 });
  });

  it("concluir e reabrir", async () => {
    const t = await make({ title: "x", date: "2026-10-05" });
    const done = await patch(`/api/tasks/${t.id}`, { done: true });
    expect(done.data).toMatchObject({ advanced: false, task: { done: true } });
    expect(done.data.task.doneAt).toBeTruthy();
    const back = await patch(`/api/tasks/${t.id}`, { done: false });
    expect(back.data.task).toMatchObject({ done: false, doneAt: null });
    // reabrir não pode disparar um aviso do passado
    expect((await prisma.task.findUnique({ where: { id: t.id } }))!.remindedAt).not.toBeNull();
  });

  it("concluir tarefa repetida leva para a próxima ocorrência (sempre no futuro)", async () => {
    const t = await make({ title: "Remédio", date: "2020-01-01", time: "08:00", repeat: "daily" });
    const r = await patch(`/api/tasks/${t.id}`, { done: true });
    expect(r.data.advanced).toBe(true);
    expect(r.data.task.done).toBe(false);
    expect(r.data.task.time).toBe("08:00");
    expect(Date.parse(r.data.task.dueAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(r.data.task.dueAt)).toBeLessThan(Date.now() + 25 * 3600_000);
  });

  it("rejeita valores inválidos e tarefas inexistentes", async () => {
    const t = await make({ title: "x" });
    expect((await patch(`/api/tasks/${t.id}`, { title: "  " })).status).toBe(400);
    expect((await patch(`/api/tasks/${t.id}`, { repeat: "sempre" })).status).toBe(400);
    expect((await patch(`/api/tasks/${t.id}`, { date: "31/12" })).status).toBe(400);
    expect((await patch(`/api/tasks/${t.id}`, { time: "10:00" })).status).toBe(400);
    expect((await patch(`/api/tasks/nao-existe`, { title: "y" })).status).toBe(404);
    expect((await s.json("/api/tasks/nao-existe", { method: "DELETE" })).status).toBe(404);
  });

  it("exclui", async () => {
    const t = await make({ title: "x" });
    expect((await s.json(`/api/tasks/${t.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await prisma.task.count()).toBe(0);
  });

  it("adiar: vencimento vira agora + N minutos e o aviso rearma", async () => {
    const t = await make({ title: "x", date: "2026-10-05", time: "10:00", remindMinutesBefore: 30 });
    await prisma.task.update({ where: { id: t.id }, data: { remindedAt: new Date() } });
    const before = Date.now();
    const r = await post(`/api/tasks/${t.id}/snooze`, { minutes: 10 });
    expect(r.status).toBe(200);
    const due = Date.parse(r.data.task.dueAt);
    expect(due).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
    expect(due).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
    expect(r.data.task).toMatchObject({ remindMinutesBefore: 0, done: false });
    expect((await prisma.task.findUnique({ where: { id: t.id } }))!.remindedAt).toBeNull();
    expect((await post(`/api/tasks/nao-existe/snooze`, {})).status).toBe(404);
  });
});

describe("voz: áudio → tarefas (Gemini falso)", () => {
  const canned = JSON.stringify({
    transcript: "amanhã às nove reunião com a Ana e sexta pagar o aluguel",
    tasks: [
      { title: "Reunião com a Ana", notes: null, date: "2026-10-01", time: "09:00", priority: 0, repeat: "none", remindMinutesBefore: 0 },
      { title: "Pagar o aluguel", date: "2026-10-02", time: null, priority: 1, repeat: "monthly", remindMinutesBefore: 0 },
    ],
  });

  async function voice(buf: Buffer, type?: string) {
    const r = await s.get("/api/tasks/voice", { method: "POST", body: audioForm(buf, type), headers: { "x-tz": "America/Sao_Paulo" } });
    return { status: r.status, data: await r.json() };
  }

  it("envia o áudio ao Gemini com o contexto certo e devolve rascunhos validados", async () => {
    stack.gemini.reply(canned);
    const audio = wav(2);
    const r = await voice(audio);
    expect(r.status).toBe(200);
    expect(r.data.via).toBe("gemini");
    expect(r.data.transcript).toContain("reunião com a Ana");
    expect(r.data.drafts).toHaveLength(2);
    expect(r.data.drafts[0]).toMatchObject({ title: "Reunião com a Ana", date: "2026-10-01", time: "09:00", repeat: "none" });
    expect(r.data.drafts[1]).toMatchObject({ title: "Pagar o aluguel", date: "2026-10-02", time: null, priority: 1, repeat: "monthly" });

    expect(stack.gemini.calls).toHaveLength(1);
    const call = stack.gemini.calls[0];
    expect(call.path).toContain(":generateContent");
    const parts = call.body.contents![0].parts as { text?: string; inlineData?: { mimeType: string; data: string } }[];
    const prompt = parts.find((p) => p.text)!.text!;
    expect(prompt).toContain("fuso America/Sao_Paulo");
    expect(prompt).toMatch(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/);
    const inline = parts.find((p) => p.inlineData)!.inlineData!;
    expect(inline.mimeType).toBe("audio/wav");
    expect(Buffer.from(inline.data, "base64").equals(audio)).toBe(true); // o áudio chega inteiro
    expect(call.body.generationConfig).toMatchObject({ responseMimeType: "application/json" });
  });

  it("descarta lixo do modelo: título vazio, repetição inválida, data impossível, antecedência absurda", async () => {
    stack.gemini.reply(
      JSON.stringify({
        transcript: "x",
        tasks: [
          { title: "", date: "2026-10-01" },
          { title: "Boa", date: "2026-13-45", time: "99:99", repeat: "sempre", priority: 7, remindMinutesBefore: 99999999 },
          "não sou objeto",
          null,
        ],
      }),
    );
    const r = await voice(wav());
    expect(r.status).toBe(200);
    expect(r.data.drafts).toHaveLength(1);
    expect(r.data.drafts[0]).toMatchObject({ title: "Boa", repeat: "none", priority: 0, remindMinutesBefore: 10080 });
  });

  it("aceita JSON com texto em volta", async () => {
    stack.gemini.reply("Claro! Aqui está:\n```json\n" + canned + "\n```");
    const r = await voice(wav());
    expect(r.data.drafts).toHaveLength(2);
  });

  it("plano B: sem tarefas estruturadas, interpreta a transcrição localmente", async () => {
    stack.gemini.reply(JSON.stringify({ transcript: "amanhã às 15h ligar pro João", tasks: [] }));
    const r = await voice(wav());
    expect(r.status).toBe(200);
    expect(r.data.via).toBe("local");
    expect(r.data.drafts[0]).toMatchObject({ title: "Ligar pro João", time: "15:00" });
    expect(r.data.drafts[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("áudio sem fala reconhecível → 422 com mensagem clara", async () => {
    stack.gemini.reply(JSON.stringify({ transcript: "", tasks: [] }));
    const r = await voice(wav());
    expect(r.status).toBe(422);
    expect(r.data.error).toMatch(/entender/);
  });

  it("falha do Gemini → 502 sem vazar detalhes internos demais", async () => {
    stack.gemini.failWith(500);
    const r = await voice(wav());
    expect(r.status).toBe(502);
    expect(r.data.error).toMatch(/Gemini/);
  });

  it("limites: tamanho, formato e ausência de arquivo", async () => {
    expect((await voice(Buffer.alloc(4_300_000, 1))).status).toBe(413);
    expect((await voice(wav(), "application/pdf")).status).toBe(415);
    const empty = await s.get("/api/tasks/voice", { method: "POST", body: new FormData() });
    expect(empty.status).toBe(400);
    expect(stack.gemini.calls).toHaveLength(0);
  });

  it("texto (aba Transcrever → criar tarefas)", async () => {
    stack.gemini.reply(canned);
    const r = await post("/api/tasks/voice", { text: "amanhã às nove reunião com a Ana e sexta pagar o aluguel" });
    expect(r.status).toBe(200);
    expect(r.data.drafts).toHaveLength(2);
    const prompt = (stack.gemini.calls[0].body.contents![0].parts as { text?: string }[]).map((p) => p.text).join("\n");
    expect(prompt).toContain("Texto:\namanhã às nove reunião");
    expect((await post("/api/tasks/voice", { text: "  " })).status).toBe(400);
  });

  it("texto com o Gemini fora do ar ainda funciona pelo interpretador local", async () => {
    stack.gemini.failWith(503);
    const r = await post("/api/tasks/voice", { text: "hoje às 23h59 tomar remédio" });
    expect(r.status).toBe(200);
    expect(r.data.via).toBe("local");
    expect(r.data.drafts[0]).toMatchObject({ title: "Tomar remédio", time: "23:59" });
  });
});

describe("push: inscrição e envio (serviço de push falso, cifra real)", () => {
  it("entrega a chave pública VAPID", async () => {
    const r = await s.json("/api/push/key");
    expect(r.data.publicKey).toBe(stack.vapid.publicKey);
  });

  it("só aceita endpoints de serviços de push conhecidos (nada de HTTP nem rede interna)", async () => {
    const sub = makeSubscription("x");
    for (const endpoint of ["http://localhost/ok", "https://169.254.169.254/latest/meta-data", "https://evil.example.com/push", "https://fcm.googleapis.com.evil.com/x", "not a url", ""]) {
      const r = await post("/api/push/subscribe", { subscription: { endpoint, keys: sub.keys } });
      expect(r.status, endpoint).toBe(400);
    }
    expect(await prisma.pushSubscription.count()).toBe(0);
    const good = await post("/api/push/subscribe", { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: sub.keys } });
    expect(good.status).toBe(200);
    expect((await post("/api/push/subscribe", { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: 1, auth: 2 } } })).status).toBe(400);
  });

  it("inscrever duas vezes o mesmo aparelho não duplica; cancelar remove", async () => {
    const sub = makeSubscription(`${stack.push.origin}/ok/a`);
    await post("/api/push/subscribe", { subscription: sub });
    await post("/api/push/subscribe", { subscription: sub });
    expect(await prisma.pushSubscription.count()).toBe(1);
    await s.json("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("aviso de teste chega cifrado, assinado com VAPID e decifra no 'aparelho'", async () => {
    const sub = makeSubscription(`${stack.push.origin}/ok/test`);
    await post("/api/push/subscribe", { subscription: sub });
    const r = await post("/api/push/test", {});
    expect(r.data.sent).toBe(1);

    expect(stack.push.calls).toHaveLength(1);
    const c = stack.push.calls[0];
    expect(c.path).toBe("/ok/test");
    expect(c.headers["content-encoding"]).toBe("aes128gcm");
    expect(c.headers["ttl"]).toBe("3600");
    expect(c.headers["urgency"]).toBe("high");
    expect(c.headers["authorization"]).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(c.headers["authorization"]).toContain(`k=${stack.vapid.publicKey}`);
    expect(decryptPush(sub, c.body)).toMatchObject({ title: "Pauta", tag: "pauta-teste" });
  });

  it("teste sem nenhum aparelho → 409; inscrição morta (410) é removida", async () => {
    expect((await post("/api/push/test", {})).status).toBe(409);
    await post("/api/push/subscribe", { subscription: makeSubscription(`${stack.push.origin}/gone/x`) });
    const r = await post("/api/push/test", {});
    expect(r.status).toBe(502);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});

describe("lembretes: o que o cron dispara", () => {
  const inMin = (m: number) => new Date(Date.now() + m * 60_000);
  async function subscribe(path = "ok/1") {
    const sub = makeSubscription(`${stack.push.origin}/${path}`);
    await prisma.pushSubscription.create({ data: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    return sub;
  }
  const dispatch = async () => {
    const r = await fetch(stack.baseUrl + "/api/cron/dispatch", { method: "POST", headers: { authorization: "Bearer segredo-do-cron" } });
    return { status: r.status, data: await r.json() };
  };
  const task = (title: string, dueAt: Date | null, extra: Record<string, unknown> = {}) =>
    prisma.task.create({ data: { title, dueAt, ...extra } });

  it("sem aparelhos inscritos não gasta nem marca nada", async () => {
    await task("x", inMin(-1));
    const r = await dispatch();
    expect(r.data.reason).toBe("sem-inscricoes");
    expect((await prisma.task.findFirst())!.remindedAt).toBeNull();
  });

  it("dispara só o que venceu, uma única vez, e o conteúdo chega certo", async () => {
    const sub = await subscribe();
    const venceu = await task("Ligar para o banco", inMin(-2), { hasTime: true });
    await task("Futura", inMin(90));
    await task("Sem data", null);
    await task("Já feita", inMin(-3), { done: true });

    const r = await dispatch();
    expect(r.data).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(stack.push.calls).toHaveLength(1);
    const payload = decryptPush(sub, stack.push.calls[0].body) as Record<string, unknown>;
    expect(payload).toMatchObject({ title: "Ligar para o banco", tag: `task-${venceu.id}`, taskId: venceu.id, url: `/?task=${venceu.id}`, actions: true });
    expect(payload.body).toMatch(/^Agora · \d{2}:\d{2}$/);

    // segunda rodada: nada de aviso repetido
    stack.push.reset();
    const again = await dispatch();
    expect(again.data.sent).toBe(0);
    expect(stack.push.calls).toHaveLength(0);
  });

  it("respeita a antecedência: 'avisar 15 min antes' dispara 15 min antes do horário", async () => {
    const sub = await subscribe();
    await task("Reunião", inMin(10), { remindMinutesBefore: 15 });
    await task("Mais tarde", inMin(40), { remindMinutesBefore: 15 });
    const r = await dispatch();
    expect(r.data.sent).toBe(1);
    const payload = decryptPush(sub, stack.push.calls[0].body) as { title: string; body: string };
    expect(payload.title).toBe("Reunião");
    expect(payload.body).toMatch(/^Daqui a 15 min · /);
  });

  it("tarefa só com data avisa 'Para hoje'", async () => {
    const sub = await subscribe();
    await task("Pagar boleto", inMin(-1), { hasTime: false });
    await dispatch();
    expect((decryptPush(sub, stack.push.calls[0].body) as { body: string }).body).toBe("Para hoje");
  });

  it("atraso grande é marcado como 'Atrasada'; mais de 24 h é descartado sem acordar ninguém", async () => {
    const sub = await subscribe();
    await task("Atrasada de 3h", inMin(-180));
    await task("De anteontem", inMin(-60 * 48));
    await dispatch();
    expect(stack.push.calls).toHaveLength(1);
    const p = decryptPush(sub, stack.push.calls[0].body) as { title: string; body: string };
    expect(p.title).toBe("Atrasada de 3h");
    expect(p.body).toMatch(/^Atrasada · era às /);
    expect((await prisma.task.findFirst({ where: { title: "De anteontem" } }))!.remindedAt).not.toBeNull();
  });

  it("execuções simultâneas não duplicam avisos (8 cron ao mesmo tempo, 25 tarefas)", async () => {
    await subscribe();
    for (let i = 0; i < 25; i++) await task(`Tarefa ${i}`, inMin(-1));
    const runs = await Promise.all(Array.from({ length: 8 }, () => dispatch()));
    // Cada tarefa é enviada exatamente uma vez, não importa quantas execuções a disputaram.
    const titles = stack.push.calls.length;
    expect(runs.reduce((n, r) => n + r.data.sent, 0)).toBe(25);
    expect(titles).toBe(25);
    expect(await prisma.task.count({ where: { remindedAt: { not: null } } })).toBe(25);
  });

  it("manda para todos os aparelhos; um morto (410) é removido e o resto recebe", async () => {
    await subscribe("ok/1");
    await subscribe("ok/2");
    await subscribe("gone/3");
    await task("Para todos", inMin(-1));
    const r = await dispatch();
    expect(r.data).toMatchObject({ sent: 1, removedSubscriptions: 1 });
    expect(stack.push.calls.map((c) => c.path).sort()).toEqual(["/gone/3", "/ok/1", "/ok/2"]);
    expect(await prisma.pushSubscription.count()).toBe(2);
  });

  it("falha passageira (500): devolve a tarefa à fila e tenta de novo na próxima rodada", async () => {
    const sub = await subscribe("fail/1");
    await task("Insistir", inMin(-1));
    const first = await dispatch();
    expect(first.data).toMatchObject({ sent: 0, failed: 1, released: 1 });
    expect((await prisma.task.findFirst())!.remindedAt).toBeNull();
    expect(await prisma.pushSubscription.count()).toBe(1); // 500 não apaga a inscrição

    // o serviço "volta": troca o endpoint para um que responde 201
    await prisma.pushSubscription.updateMany({ data: { endpoint: `${stack.push.origin}/ok/1` } });
    const second = await dispatch();
    expect(second.data.sent).toBe(1);
    void sub;
  });

  it("GET também funciona (formato do cron da Vercel)", async () => {
    await subscribe();
    await task("x", inMin(-1));
    const r = await fetch(stack.baseUrl + "/api/cron/dispatch", { headers: { authorization: "Bearer segredo-do-cron" } });
    expect(r.status).toBe(200);
    expect((await r.json()).sent).toBe(1);
  });

  it("tarefa repetida concluída volta a avisar na próxima ocorrência (ciclo completo)", async () => {
    const sub = await subscribe();
    const t = await task("Remédio", inMin(-1), { repeat: "daily", hasTime: true });
    await dispatch();
    expect(stack.push.calls).toHaveLength(1);
    const done = await patch(`/api/tasks/${t.id}`, { done: true });
    expect(done.data.advanced).toBe(true);
    // a próxima é amanhã: ainda não dispara
    stack.push.reset();
    expect((await dispatch()).data.sent).toBe(0);
    // simula a chegada do horário da próxima ocorrência
    await prisma.task.update({ where: { id: t.id }, data: { dueAt: inMin(-1) } });
    expect((await dispatch()).data.sent).toBe(1);
    void sub;
  });
});
