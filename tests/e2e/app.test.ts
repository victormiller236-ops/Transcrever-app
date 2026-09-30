// Fluxo completo no Chromium real, emulando um Android: login, gravação por microfone (simulado),
// Gemini falso, instalação (PWA), avisos, offline. Nada aqui usa mock do código do app.
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDaysToKey, nowParts } from "@/lib/format";
import { decryptPush, makeSubscription } from "../helpers/push-decrypt";
import { startStack, type Stack } from "../helpers/stack";

process.env.DATABASE_URL ??=
  "postgresql://postgres@localhost:5433/tarefas?host=/tmp";
const prisma = new PrismaClient();
const TZ = "America/Sao_Paulo";
const SHOTS =
  process.env.SHOTS_DIR ??
  "/tmp/claude-0/-home-user-Transcrever-app/790c9d2d-8429-5bc5-bd9a-a0cebfff96be/scratchpad/shots";
mkdirSync(SHOTS, { recursive: true });

let stack: Stack;
let browser: Browser;
const dir = join(tmpdir(), "pauta-e2e");
mkdirSync(dir, { recursive: true });

function wavBytes(seconds: number, amp = 0.5): Buffer {
  const rate = 16000;
  const n = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(
      Math.round(
        Math.sin((i / rate) * 2 * Math.PI * 300) *
          32767 *
          amp *
          (0.6 + 0.4 * Math.sin(i / 2000)),
      ),
      44 + i * 2,
    );
  return b;
}
const micFile = join(dir, "mic.wav");
writeFileSync(micFile, wavBytes(6));
const fileShort = join(dir, "audio-curto.wav");
writeFileSync(fileShort, wavBytes(3));
const fileLong = join(dir, "audio-longo.wav");
writeFileSync(fileLong, wavBytes(125, 0.3));

const PIXEL = {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  locale: "pt-BR",
  timezoneId: TZ,
};

const errors: string[] = [];
type SWScope = {
  registration: { getNotifications: () => Promise<Notification[]> };
};

async function newContext(
  opts: {
    permissions?: string[];
    colorScheme?: "light" | "dark";
    viewport?: { width: number; height: number };
  } = {},
) {
  const ctx = await browser.newContext({
    ...PIXEL,
    ...(opts.viewport ? { viewport: opts.viewport } : {}),
    colorScheme: opts.colorScheme ?? "light",
    permissions: opts.permissions ?? ["microphone", "notifications"],
    baseURL: stack.baseUrl,
  });
  return ctx;
}

function track(page: Page) {
  const who = () => expect.getState().currentTestName ?? "?";
  page.on("pageerror", (e) =>
    errors.push(`[${who()}] pageerror: ${e.message}`),
  );
  page.on("console", (m) => {
    // "Failed to fetch" do next-auth só acontece com a rede cortada de propósito (teste offline).
    if (
      m.type() === "error" &&
      !/Failed to load resource|favicon|authjs\.dev#autherror/.test(m.text())
    ) {
      errors.push(`[${who()}] console: ${m.text()}`);
    }
  });
}

async function loginUi(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Senha").fill(stack.env.APP_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.getByTestId("record-fab").waitFor();
}

async function openApp(ctx: BrowserContext) {
  const page = await ctx.newPage();
  track(page);
  await loginUi(page);
  return page;
}

/** Instante UTC do dia local `key` às `hour`:00 em Brasília (UTC-3). */
const at = (key: string, hour: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + (hour + 3) * 3600_000);
const tomorrow = () => addDaysToKey(nowParts(TZ).key, 1);
const today = () => nowParts(TZ).key;
const shot = async (page: Page, name: string) =>
  (await page.waitForTimeout(500), page).screenshot({
    path: join(SHOTS, `${name}.png`),
  });
const toast = (page: Page) => page.locator('[role="status"]');
const row = (page: Page, title: string) =>
  page.locator(`[data-testid="task-row"][data-task-title="${title}"]:visible`);

beforeAll(async () => {
  stack = await startStack({ appPort: 3102 });
  browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${micFile}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await stack?.stop();
  await prisma.$disconnect();
  if (errors.length) console.log("ERROS NO NAVEGADOR:\n" + errors.join("\n"));
  if (errors.length)
    throw new Error("O navegador registrou erros (veja acima).");
});

beforeEach(async () => {
  await prisma.task.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.transcription.deleteMany();
  stack.gemini.reset();
  stack.push.reset();
});

describe("entrada e instalação (PWA)", () => {
  it("login: senha errada avisa, senha certa entra", async () => {
    const ctx = await newContext();
    const page = await ctx.newPage();
    track(page);
    await page.goto("/");
    await page.waitForURL(/\/login/);
    await shot(page, "01-login");
    await page.getByLabel("Senha").fill("errada");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByText("Senha incorreta.").waitFor();
    await page.getByLabel("Senha").fill(stack.env.APP_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.getByTestId("record-fab").waitFor();
    await ctx.close();
  });

  it("o Chrome considera o app instalável: zero erros de instalabilidade e manifest válido", async () => {
    // O Chrome não instala PWA em janela anônima: aqui vai um perfil de verdade (persistente).
    const profile = join(dir, `perfil-${Date.now()}`);
    const ctx = await chromium.launchPersistentContext(profile, {
      executablePath: "/opt/pw-browsers/chromium",
      ...PIXEL,
      permissions: ["microphone", "notifications"],
      baseURL: stack.baseUrl,
    });
    const page = await ctx.newPage();
    track(page);
    await loginUi(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.getByTestId("record-fab").waitFor();
    const cdp: CDPSession = await ctx.newCDPSession(page);
    await cdp.send("Page.enable");
    // dá tempo ao Chrome de reavaliar depois do SW ativar
    let installErrors: unknown[] = [{ errorId: "pendente" }];
    for (let i = 0; i < 20 && installErrors.length; i++) {
      installErrors = (
        (await cdp.send("Page.getInstallabilityErrors")) as {
          installabilityErrors: unknown[];
        }
      ).installabilityErrors;
      if (installErrors.length) await new Promise((r) => setTimeout(r, 250));
    }
    expect(installErrors).toEqual([]);

    const m = (await cdp.send("Page.getAppManifest")) as {
      url: string;
      errors: unknown[];
      data?: string;
    };
    expect(m.url).toContain("/manifest.webmanifest");
    expect(m.errors).toEqual([]);
    const manifest = JSON.parse(m.data!);
    expect(manifest.name).toBe("MyDay · tarefas por voz");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return {
        scope: reg.scope,
        active: reg.active?.state,
        controlled: !!navigator.serviceWorker.controller,
      };
    });
    expect(sw.active).toBe("activated");
    expect(sw.scope).toBe(stack.baseUrl + "/");
    await ctx.close();
  });

  it("sem internet, o app mostra a tela 'Sem conexão' em vez de um erro do navegador", async () => {
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // agora a página já nasce controlada pelo SW
    await page.getByTestId("record-fab").waitFor();
    await ctx.setOffline(true);
    await page.goto("/").catch(() => {});
    await page
      .getByRole("heading", { name: "Sem conexão" })
      .waitFor({ timeout: 10_000 });
    await shot(page, "02-offline");
    await ctx.setOffline(false);
    await page.goto("/");
    await page.getByTestId("record-fab").waitFor();
    await ctx.close();
  });
});

describe("tarefas pela tela", () => {
  it("adição rápida entende 'amanhã às 15h … urgente', mostra o que entendeu e salva no horário certo", async () => {
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page
      .getByTestId("quick-input")
      .fill("amanhã às 15h ligar pro João urgente");
    const preview = page.getByTestId("quick-preview");
    await preview.waitFor();
    expect(await preview.innerText()).toMatch(/Amanhã · 15:00/);
    expect(await preview.innerText()).toMatch(/Importante/);
    await shot(page, "03-quickadd-preview");
    await page.getByTestId("quick-submit").click();
    await toast(page).filter({ hasText: "Tarefa salva" }).waitFor();
    await row(page, "Ligar pro João").waitFor();
    expect(await row(page, "Ligar pro João").innerText()).toMatch(/15:00/);

    const t = await prisma.task.findFirstOrThrow();
    expect(t).toMatchObject({
      title: "Ligar pro João",
      priority: 1,
      hasTime: true,
      source: "manual",
    });
    expect(t.dueAt!.toISOString()).toBe(`${tomorrow()}T18:00:00.000Z`); // 15h em Brasília = 18h UTC
    await ctx.close();
  });

  it("gravar pelo microfone: ondas, cronômetro, Gemini estrutura, conferir/editar e salvar", async () => {
    stack.gemini.reply(
      JSON.stringify({
        transcript: "amanhã às nove reunião com a Ana e sexta pagar o aluguel",
        tasks: [
          {
            title: "Reunião com a Ana",
            date: tomorrow(),
            time: "09:00",
            priority: 0,
            repeat: "none",
            remindMinutesBefore: 15,
          },
          {
            title: "Pagar o aluguel",
            date: addDaysToKey(today(), 3),
            time: null,
            priority: 1,
            repeat: "monthly",
            remindMinutesBefore: 0,
          },
        ],
      }),
    );
    const ctx = await newContext();
    const page = await openApp(ctx);
    await shot(page, "04-home-vazia");

    await page.getByTestId("record-fab").click();
    const timer = page.getByTestId("timer");
    await timer.waitFor();
    await page.waitForTimeout(2600);
    const t = await timer.innerText();
    expect(t).toMatch(/^0:0[2-9]$/); // o cronômetro anda
    await shot(page, "05-gravando");
    await page.getByTestId("stop-recording").click();
    await page.getByTestId("review-panel").waitFor({ timeout: 20_000 });

    // O áudio enviado ao Gemini é um WAV real de ~2,6 s (16 kHz, mono, 16 bits)
    const call = stack.gemini.calls.at(-1)!;
    const inline = (
      call.body.contents![0].parts as {
        inlineData?: { mimeType: string; data: string };
      }[]
    ).find((p) => p.inlineData)!.inlineData!;
    expect(inline.mimeType).toBe("audio/wav");
    const wav = Buffer.from(inline.data, "base64");
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.length).toBeGreaterThan(44 + 16000 * 2 * 1.8);
    expect(wav.length).toBeLessThan(44 + 16000 * 2 * 5);
    const prompt = (call.body.contents![0].parts as { text?: string }[]).find(
      (p) => p.text,
    )!.text!;
    expect(prompt).toContain(`fuso ${TZ}`);

    expect(await page.getByTestId("draft-card").count()).toBe(2);
    await shot(page, "06-revisao");
    await page.getByText("Ver o que eu ouvi").click();
    expect(await page.getByTestId("transcript").innerText()).toContain(
      "reunião com a Ana",
    );

    // edita o título da primeira (abre o editor da carta)
    await page
      .getByRole("button", { name: "Editar: Reunião com a Ana" })
      .click();
    await page.getByLabel("O que fazer").fill("Reunião com a Ana (sala 3)");
    await shot(page, "07-revisao-editando");
    await page.getByTestId("save-drafts").click();
    await toast(page).filter({ hasText: "2 tarefas salvas" }).waitFor();

    const rows = await prisma.task.findMany({ orderBy: { title: "asc" } });
    expect(rows.map((r) => r.title)).toEqual([
      "Pagar o aluguel",
      "Reunião com a Ana (sala 3)",
    ]);
    expect(rows[1]).toMatchObject({
      source: "voice",
      remindMinutesBefore: 15,
      hasTime: true,
    });
    expect(rows[1].dueAt!.toISOString()).toBe(`${tomorrow()}T12:00:00.000Z`);
    expect(rows[1].transcript).toContain("reunião com a Ana");
    expect(rows[0]).toMatchObject({
      repeat: "monthly",
      priority: 1,
      hasTime: false,
    });
    await ctx.close();
  });

  it("microfone negado: explica como liberar e oferece arquivo de áudio como saída", async () => {
    const ctx = await newContext();
    await ctx.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(
          Object.assign(new Error("denied"), { name: "NotAllowedError" }),
        );
    });
    const page = await openApp(ctx);
    await page.getByTestId("record-fab").click();
    const err = page.getByTestId("recorder-error");
    await err.waitFor();
    expect(await err.innerText()).toMatch(/bloqueado[\s\S]*Permitir/);
    await shot(page, "08-microfone-negado");

    // saída: usar um arquivo de áudio
    stack.gemini.reply(
      JSON.stringify({
        transcript: "comprar café",
        tasks: [{ title: "Comprar café", date: null, time: null }],
      }),
    );
    await page.getByTestId("audio-file").setInputFiles(fileShort);
    await page.getByTestId("review-panel").waitFor({ timeout: 20_000 });
    const parts = stack.gemini.calls.at(-1)!.body.contents![0].parts as {
      inlineData?: { mimeType: string };
    }[];
    expect(parts.find((p) => p.inlineData)!.inlineData!.mimeType).toBe(
      "audio/wav",
    );
    await ctx.close();
  });

  it("áudio longo demais é recusado com orientação, sem chamar o Gemini", async () => {
    const ctx = await newContext();
    await ctx.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(
          Object.assign(new Error("x"), { name: "NotFoundError" }),
        );
    });
    const page = await openApp(ctx);
    await page.getByTestId("record-fab").click();
    await page.getByTestId("recorder-error").waitFor();
    await page.getByTestId("audio-file").setInputFiles(fileLong);
    await page.getByText(/aba Transcrever/).waitFor({ timeout: 20_000 });
    expect(stack.gemini.calls).toHaveLength(0);
    await ctx.close();
  });

  it("Gemini fora do ar: mostra o erro e permite reenviar a mesma gravação sem regravar", async () => {
    stack.gemini.failWith(500);
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page.getByTestId("record-fab").click();
    await page.getByTestId("timer").waitFor();
    await page.waitForTimeout(1500);
    await page.getByTestId("stop-recording").click();
    await page.getByTestId("recorder-error").waitFor({ timeout: 20_000 });
    expect(await page.getByTestId("recorder-error").innerText()).toMatch(
      /Gemini/,
    );
    // volta o serviço e reenvia
    stack.gemini.reply(
      JSON.stringify({ transcript: "ok", tasks: [{ title: "Reenviada" }] }),
    );
    await page.getByRole("button", { name: "Enviar de novo" }).click();
    await page.getByTestId("review-panel").waitFor({ timeout: 20_000 });
    expect(stack.gemini.calls.length).toBe(2);
    const audios = stack.gemini.calls.map(
      (c) =>
        (c.body.contents![0].parts as { inlineData?: { data: string } }[]).find(
          (p) => p.inlineData,
        )!.inlineData!.data,
    );
    expect(audios[0]).toBe(audios[1]); // mesma gravação, nada se perdeu
    await ctx.close();
  });

  it("concluir, desfazer e excluir com desfazer", async () => {
    await prisma.task.createMany({
      data: [
        {
          title: "Tarefa A",
          dueAt: new Date(`${today()}T23:00:00Z`),
          hasTime: false,
        },
        { title: "Tarefa B" },
      ],
    });
    const ctx = await newContext();
    const page = await openApp(ctx);
    await row(page, "Tarefa A").waitFor();
    await shot(page, "09-lista");

    await row(page, "Tarefa A").getByRole("checkbox").click();
    await toast(page).filter({ hasText: "Tarefa concluída" }).waitFor();
    await row(page, "Tarefa A").waitFor({ state: "detached" });
    expect(
      (await prisma.task.findFirstOrThrow({ where: { title: "Tarefa A" } }))
        .done,
    ).toBe(true);
    await toast(page).getByRole("button", { name: "Desfazer" }).click();
    await row(page, "Tarefa A").waitFor();
    await expect
      .poll(
        async () =>
          (await prisma.task.findFirstOrThrow({ where: { title: "Tarefa A" } }))
            .done,
      )
      .toBe(false);

    await row(page, "Tarefa B")
      .getByRole("button", { name: /^Editar/ })
      .click();
    await page.getByTestId("delete-task").click();
    await toast(page).filter({ hasText: "Tarefa excluída" }).waitFor();
    await row(page, "Tarefa B").waitFor({ state: "detached" });
    expect(await prisma.task.count({ where: { title: "Tarefa B" } })).toBe(0);
    await toast(page).getByRole("button", { name: "Desfazer" }).click();
    await row(page, "Tarefa B").waitFor();
    expect(await prisma.task.count({ where: { title: "Tarefa B" } })).toBe(1);
    await ctx.close();
  });

  it("tarefa repetida: concluir avisa a próxima data e mantém a tarefa na lista", async () => {
    await prisma.task.create({
      data: {
        title: "Remédio",
        dueAt: new Date(Date.now() - 3600_000),
        hasTime: true,
        repeat: "daily",
      },
    });
    const ctx = await newContext();
    const page = await openApp(ctx);
    await row(page, "Remédio").waitFor();
    await row(page, "Remédio").getByRole("checkbox").click();
    await toast(page)
      .filter({ hasText: /Feito! Próxima: / })
      .waitFor();
    const t = await prisma.task.findFirstOrThrow();
    expect(t.done).toBe(false);
    expect(t.dueAt!.getTime()).toBeGreaterThan(Date.now());
    await ctx.close();
  });

  it("editar pelo formulário: muda dia, horário, aviso e repetição", async () => {
    await prisma.task.create({
      data: {
        title: "Dentista",
        dueAt: new Date(Date.now() + 5 * 3600_000),
        hasTime: true,
      },
    });
    const ctx = await newContext();
    const page = await openApp(ctx);
    await row(page, "Dentista")
      .getByRole("button", { name: /^Editar/ })
      .click();
    await page.getByTestId("task-form").waitFor();
    await shot(page, "10-editar");
    await page.getByRole("button", { name: "Amanhã", exact: true }).click();
    await page.getByLabel("Horário").fill("14:30");
    await page.getByLabel("Avisar").selectOption("30");
    await page.getByLabel("Repetir").selectOption("weekly");
    await page.getByTestId("save-task").click();
    await toast(page).filter({ hasText: "Alterações salvas" }).waitFor();
    const t = await prisma.task.findFirstOrThrow();
    expect(t).toMatchObject({
      remindMinutesBefore: 30,
      repeat: "weekly",
      hasTime: true,
    });
    expect(t.dueAt!.toISOString()).toBe(`${tomorrow()}T17:30:00.000Z`);
    await ctx.close();
  });

  it("agenda agrupa por dia (com atrasadas) e a aba Concluídas lista o que foi feito", async () => {
    const d = (days: number, h = 15) => at(addDaysToKey(today(), days), h);
    await prisma.task.createMany({
      data: [
        { title: "Atrasada velha", dueAt: d(-2), hasTime: true },
        { title: "Amanhã 1", dueAt: d(1), hasTime: true },
        { title: "Em uma semana", dueAt: d(7), hasTime: true },
        { title: "Sem data" },
        {
          title: "Já fiz",
          done: true,
          doneAt: new Date(),
          dueAt: d(0),
          hasTime: true,
        },
      ],
    });
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page.getByTestId("nav-agenda").click();
    const agenda = page.getByTestId("agenda-list");
    await agenda.waitFor();
    const txt = await agenda.innerText();
    expect(txt).toMatch(/atrasadas/i);
    expect(txt.indexOf("Atrasada velha")).toBeLessThan(txt.indexOf("Amanhã 1"));
    expect(txt.indexOf("Amanhã 1")).toBeLessThan(txt.indexOf("Em uma semana"));
    expect(txt.indexOf("Em uma semana")).toBeLessThan(txt.indexOf("Sem data"));
    expect(txt).not.toContain("Já fiz");
    await shot(page, "11-agenda");
    await page.getByRole("tab", { name: "Concluídas" }).click();
    await row(page, "Já fiz").waitFor();
    await ctx.close();
  });

  it("a aba Transcrever continua funcionando e permite criar tarefas a partir de um texto transcrito", async () => {
    await prisma.transcription.create({
      data: {
        filename: "reuniao.m4a",
        mimeType: "audio/mp4",
        status: "completed",
        text: "Amanhã preciso enviar o relatório e na sexta ligar para o cliente.",
      },
    });
    stack.gemini.reply(
      JSON.stringify({
        transcript: "texto",
        tasks: [
          { title: "Enviar o relatório", date: tomorrow(), time: null },
          { title: "Ligar para o cliente", date: addDaysToKey(today(), 2) },
        ],
      }),
    );
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page.getByTestId("nav-transcrever").click();
    await page.getByText("reuniao.m4a").waitFor();
    await shot(page, "12-transcrever");
    await page.getByRole("button", { name: "✨ Criar tarefas" }).click();
    await page.getByTestId("review-panel").waitFor();
    expect(await page.getByTestId("draft-card").count()).toBe(2);
    await page.getByTestId("save-drafts").click();
    await toast(page).filter({ hasText: "2 tarefas salvas" }).waitFor();
    expect(await prisma.task.count()).toBe(2);
    await ctx.close();
  });
});

describe("avisos", () => {
  async function pushStub(
    ctx: BrowserContext,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    // O Chromium de teste não alcança o serviço real de push do Google; o resto do caminho é real.
    await ctx.addInitScript((s) => {
      let current: unknown = null;
      const make = () => ({
        endpoint: s.endpoint,
        toJSON: () => ({ endpoint: s.endpoint, keys: s.keys }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      });
      PushManager.prototype.subscribe = async () =>
        (current = make()) as unknown as PushSubscription;
      PushManager.prototype.getSubscription = async () =>
        current as PushSubscription | null;
    }, sub);
  }

  it("ligar avisos → inscrição salva; aviso de teste chega cifrado; desligar remove", async () => {
    const sub = makeSubscription(`${stack.push.origin}/ok/device`);
    const ctx = await newContext();
    await pushStub(ctx, sub);
    const page = await openApp(ctx);
    await page.getByTestId("nav-ajustes").click();
    await page.getByTestId("settings").waitFor();
    await shot(page, "13-ajustes");
    await page.getByTestId("toggle-push").click();
    await page.getByText(/Ligados neste aparelho/).waitFor();
    expect(await prisma.pushSubscription.count()).toBe(1);

    await page.getByTestId("test-push").click();
    await toast(page).filter({ hasText: "Aviso de teste enviado" }).waitFor();
    expect(stack.push.calls).toHaveLength(1);
    expect(decryptPush(sub, stack.push.calls[0].body)).toMatchObject({
      title: "MyDay",
    });

    await page.getByTestId("toggle-push").click();
    await toast(page).filter({ hasText: "Avisos desligados" }).waitFor();
    expect(await prisma.pushSubscription.count()).toBe(0);
    await ctx.close();
  });

  it("depois de salvar a primeira tarefa, sugere ligar os avisos (uma vez só)", async () => {
    const ctx = await newContext();
    await pushStub(ctx, makeSubscription(`${stack.push.origin}/ok/x`));
    const page = await openApp(ctx);
    await page.getByTestId("quick-input").fill("comprar pão");
    await page.getByTestId("quick-submit").click();
    await toast(page).filter({ hasText: "Quer ser avisado" }).waitFor();
    await toast(page).getByRole("button", { name: "Ligar avisos" }).click();
    await page.getByTestId("settings").waitFor();
    await ctx.close();
  });

  it("tarefa que venceu aparece como alerta dentro do app; adiar e concluir funcionam", async () => {
    const t1 = await prisma.task.create({
      data: {
        title: "Hora da reunião",
        dueAt: new Date(Date.now() - 30_000),
        hasTime: true,
      },
    });
    const ctx = await newContext();
    const page = await openApp(ctx);
    const alert = page.getByTestId("alert");
    await alert.waitFor({ timeout: 10_000 });
    expect(await alert.innerText()).toContain("Hora da reunião");
    await shot(page, "14-alerta");
    await alert.getByRole("button", { name: "Adiar 10 min" }).click();
    await alert.waitFor({ state: "detached" });
    await expect
      .poll(
        async () =>
          (
            await prisma.task.findUniqueOrThrow({ where: { id: t1.id } })
          ).dueAt!.getTime() - Date.now(),
      )
      .toBeGreaterThan(9 * 60_000);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: t1.id } });
    expect(t.dueAt!.getTime()).toBeLessThan(Date.now() + 11 * 60_000);

    // não repete o alerta ao recarregar
    await page.reload();
    await page.getByTestId("record-fab").waitFor();
    await page.waitForTimeout(800);
    expect(await page.getByTestId("alert").count()).toBe(0);

    await prisma.task.update({
      where: { id: t1.id },
      data: { dueAt: new Date(Date.now() - 20_000), remindedAt: null },
    });
    await page.reload();
    await page.getByTestId("alert").waitFor({ timeout: 10_000 });
    await page
      .getByTestId("alert")
      .getByRole("button", { name: "Concluir" })
      .click();
    await expect
      .poll(
        async () =>
          (await prisma.task.findUniqueOrThrow({ where: { id: t1.id } })).done,
      )
      .toBe(true);
    await ctx.close();
  });

  it("push recebido com o app aberto vira alerta na tela; com o app fechado vira notificação do sistema", async () => {
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const task = await prisma.task.create({
      data: {
        title: "Buscar encomenda",
        dueAt: new Date(Date.now() + 3600_000),
        hasTime: true,
      },
    });

    const cdp = await ctx.newCDPSession(page);
    const regs: { registrationId: string; scopeURL: string }[] = [];
    cdp.on(
      "ServiceWorker.workerRegistrationUpdated",
      (e: { registrations: { registrationId: string; scopeURL: string }[] }) =>
        regs.push(...e.registrations),
    );
    await cdp.send("ServiceWorker.enable");
    await expect.poll(() => regs.length).toBeGreaterThan(0);
    const registrationId = regs.at(-1)!.registrationId;
    const payload = {
      title: "Buscar encomenda",
      body: "Agora · 10:00",
      url: `/?task=${task.id}`,
      tag: `task-${task.id}`,
      taskId: task.id,
      actions: true,
    };

    // 1) app aberto → alerta dentro do app
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin: stack.baseUrl,
      registrationId,
      data: JSON.stringify(payload),
    });
    await page
      .getByTestId("alert")
      .filter({ hasText: "Buscar encomenda" })
      .waitFor({ timeout: 10_000 });

    // 2) app fechado → notificação do sistema com botões
    await page.close();
    const other = await ctx.newPage();
    await other.goto("about:blank");
    const cdp2 = await ctx.newCDPSession(other);
    await cdp2.send("ServiceWorker.enable");
    await cdp2.send("ServiceWorker.deliverPushMessage", {
      origin: stack.baseUrl,
      registrationId,
      data: JSON.stringify(payload),
    });
    const sw = ctx.serviceWorkers()[0];
    await expect
      .poll(
        async () =>
          (await sw.evaluate(
            async () =>
              (
                await (
                  self as unknown as SWScope
                ).registration.getNotifications()
              ).length,
          )) as number,
        { timeout: 10_000 },
      )
      .toBe(1);
    const n = (await sw.evaluate(async () => {
      const [x] = await (
        self as unknown as SWScope
      ).registration.getNotifications();
      return {
        title: x.title,
        body: x.body,
        tag: x.tag,
        actions: (
          x as Notification & { actions: { action: string }[] }
        ).actions.map((a) => a.action),
        data: x.data,
      };
    })) as {
      title: string;
      body: string;
      tag: string;
      actions: string[];
      data: { url: string; taskId: string };
    };
    expect(n).toMatchObject({
      title: "Buscar encomenda",
      body: "Agora · 10:00",
      tag: `task-${task.id}`,
      actions: ["done", "snooze"],
    });
    expect(n.data).toEqual({ url: `/?task=${task.id}`, taskId: task.id });
    await ctx.close();
  });

  it("abrir pelo link da notificação (?task=ID) já abre a tarefa", async () => {
    const t = await prisma.task.create({
      data: {
        title: "Abrir direto",
        dueAt: new Date(Date.now() + 3600_000),
        hasTime: true,
      },
    });
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page.goto(`/?task=${t.id}`);
    await page.getByTestId("task-form").waitFor();
    expect(await page.getByLabel("O que fazer").inputValue()).toBe(
      "Abrir direto",
    );
    expect(new URL(page.url()).search).toBe(""); // URL limpa
    await ctx.close();
  });

  it("atalhos do ícone (?action=record / ?action=new) abrem o gravador e o formulário", async () => {
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page.goto("/?action=new");
    await page.getByTestId("task-form").waitFor();
    await page.goto("/?action=record");
    await page.getByTestId("timer").waitFor();
    await ctx.close();
  });
});

/** Troca a fala do navegador por uma que só anota o que "disse". */
async function fakeSpeech(
  ctx: BrowserContext,
  opts: { blocked?: boolean } = {},
) {
  await ctx.addInitScript((blocked) => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    class U {
      text: string;
      lang = "";
      voice: unknown = null;
      rate = 1;
      volume = 1;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      constructor(t: string) {
        this.text = t;
      }
    }
    (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = U;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{ lang: "pt-BR", name: "fake" }],
        cancel() {},
        addEventListener() {},
        removeEventListener() {},
        speak(u: U) {
          if (blocked)
            return void setTimeout(
              () => u.onerror?.({ error: "not-allowed" }),
              5,
            );
          spoken.push(u.text);
          setTimeout(() => u.onend?.(), 5);
        },
      },
    });
  }, opts.blocked ?? false);
}
const spokenList = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

describe("aviso falado", () => {
  it("tarefa que venceu é lida em voz alta, com o texto certo", async () => {
    await prisma.task.create({
      data: {
        title: "Hora da reunião",
        dueAt: new Date(Date.now() - 30_000),
        hasTime: true,
      },
    });
    const ctx = await newContext();
    await fakeSpeech(ctx);
    const page = await openApp(ctx);
    await page.getByTestId("alert").waitFor({ timeout: 10_000 });
    await expect
      .poll(() => spokenList(page), { timeout: 5000 })
      .toEqual(["Lembrete: Hora da reunião. É agora."]);
    await ctx.close();
  });

  it("com a leitura desligada nos Ajustes, o aviso aparece mas não fala; o botão Ouvir fala mesmo assim", async () => {
    const ctx = await newContext();
    await fakeSpeech(ctx);
    const page = await openApp(ctx);
    await page.getByTestId("nav-ajustes").click();
    await page.getByTestId("toggle-speak").click();
    expect(await page.getByTestId("toggle-speak").innerText()).toMatch(
      /desligado/,
    );
    await page.getByTestId("nav-tarefas").click();

    await prisma.task.create({
      data: {
        title: "Silenciosa",
        dueAt: new Date(Date.now() - 20_000),
        hasTime: true,
      },
    });
    await page.reload();
    await page.getByTestId("alert").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1600);
    expect(await spokenList(page)).toEqual([]);

    await page.getByTestId("alert-speak").click();
    await expect
      .poll(() => spokenList(page))
      .toEqual(["Lembrete: Silenciosa. É agora."]);
    await ctx.close();
  });

  it("tocar no aviso (?task=ID&speak=1) abre o alerta da tarefa e lê; a URL fica limpa", async () => {
    const t = await prisma.task.create({
      data: {
        title: "Buscar encomenda",
        dueAt: new Date(Date.now() + 45 * 60_000),
        hasTime: true,
        remindMinutesBefore: 30,
      },
    });
    const ctx = await newContext();
    await fakeSpeech(ctx);
    const page = await openApp(ctx);
    await page.goto(`/?task=${t.id}&speak=1`);
    await page.getByTestId("alert").waitFor({ timeout: 10_000 });
    expect(await page.getByTestId("alert").innerText()).toContain(
      "Buscar encomenda",
    );
    await expect
      .poll(() => spokenList(page))
      .toEqual(["Lembrete: Buscar encomenda. Começa daqui a 30 minutos."]);
    expect(new URL(page.url()).search).toBe("");
    // não abre o editor por cima
    expect(await page.getByTestId("task-form").count()).toBe(0);
    await ctx.close();
  });

  it("navegador bloqueando o som: o aviso continua na tela e o botão Ouvir está ali", async () => {
    await prisma.task.create({
      data: {
        title: "Bloqueada",
        dueAt: new Date(Date.now() - 20_000),
        hasTime: true,
      },
    });
    const ctx = await newContext();
    await fakeSpeech(ctx, { blocked: true });
    const page = await openApp(ctx);
    await page.getByTestId("alert").waitFor({ timeout: 10_000 });
    expect(await page.getByTestId("alert-speak").count()).toBe(1);
    await ctx.close();
  });

  it("Ajustes → Testar a voz", async () => {
    const ctx = await newContext();
    await fakeSpeech(ctx);
    const page = await openApp(ctx);
    await page.getByTestId("nav-ajustes").click();
    await page.getByTestId("test-speak").click();
    await expect
      .poll(() => spokenList(page))
      .toEqual(["Lembrete: ligar para o banco. É agora."]);
    await ctx.close();
  });

  it("push recebido com o app aberto lê o texto falado que veio do servidor", async () => {
    const ctx = await newContext();
    await fakeSpeech(ctx);
    const page = await openApp(ctx);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const task = await prisma.task.create({
      data: {
        title: "Pagar boleto",
        dueAt: new Date(Date.now() + 3600_000),
        hasTime: false,
      },
    });
    const cdp = await ctx.newCDPSession(page);
    const regs: { registrationId: string }[] = [];
    cdp.on(
      "ServiceWorker.workerRegistrationUpdated",
      (e: { registrations: { registrationId: string }[] }) =>
        regs.push(...e.registrations),
    );
    await cdp.send("ServiceWorker.enable");
    await expect.poll(() => regs.length).toBeGreaterThan(0);
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin: stack.baseUrl,
      registrationId: regs.at(-1)!.registrationId,
      data: JSON.stringify({
        title: "Pagar boleto",
        body: "Para hoje",
        spoken: "Lembrete: Pagar boleto. É para hoje.",
        url: `/?task=${task.id}&speak=1`,
        tag: `task-${task.id}`,
        taskId: task.id,
        actions: true,
      }),
    });
    await page
      .getByTestId("alert")
      .filter({ hasText: "Pagar boleto" })
      .waitFor({ timeout: 10_000 });
    await expect
      .poll(() => spokenList(page))
      .toContain("Lembrete: Pagar boleto. É para hoje.");
    await ctx.close();
  });
});

describe("app Android nativo (ponte Capacitor simulada)", () => {
  const FAKE_BYTES = Buffer.from(
    Array.from({ length: 3000 }, (_, i) => (i * 7) & 255),
  );

  /** Finge ser o WebView do app: window.Capacitor com os dois plugins nativos. */
  async function fakeNative(
    ctx: BrowserContext,
    opts: { denyMic?: boolean; notifications?: boolean } = {},
  ) {
    await ctx.addInitScript((o) => {
      type Item = {
        id: string;
        at: number;
        title: string;
        body: string;
        spoken: string;
      };
      const w = window as unknown as {
        Capacitor: unknown;
        __native: { calls: string[]; reminders: Item[][]; testNow: unknown[] };
      };
      w.__native = { calls: [], reminders: [], testNow: [] };
      let bin = "";
      for (let i = 0; i < 3000; i++) bin += String.fromCharCode((i * 7) & 255);
      const b64 = btoa(bin);
      const status = () => ({
        notifications: o.notifications ?? true,
        exactAlarms: true,
        scheduled: w.__native.reminders.at(-1)?.length ?? 0,
      });
      const plugins: Record<
        string,
        Record<string, (x?: never) => Promise<unknown>>
      > = {
        NativeVoice: {
          start: async () => {
            w.__native.calls.push("start");
            if (o.denyMic) throw new Error("PERMISSION_DENIED");
          },
          level: async () => ({
            level: 0.3 + Math.random() * 0.5,
            recording: true,
          }),
          stop: async () => {
            w.__native.calls.push("stop");
            return { base64: b64, mimeType: "audio/aac", seconds: 3.2 };
          },
          cancel: async () => {
            w.__native.calls.push("cancel");
          },
        },
        NativeReminders: {
          schedule: async (x?: never) => {
            w.__native.reminders.push(
              (x as unknown as { items: Item[] }).items,
            );
            return status();
          },
          testNow: async (x?: never) => {
            w.__native.testNow.push(x);
            return status();
          },
          status: async () => status(),
          requestNotifications: async () => {
            w.__native.calls.push("requestNotifications");
            return status();
          },
        },
      };
      w.Capacitor = {
        isNativePlatform: () => true,
        registerPlugin: (name: string) => plugins[name],
      };
      // Prova de que o caminho nativo não usa o microfone do navegador.
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(
          new Error("getUserMedia não deve ser usado no app nativo"),
        );
    }, opts);
  }
  const nativeState = (page: Page) =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __native: {
              calls: string[];
              reminders: {
                id: string;
                at: number;
                spoken: string;
                body: string;
              }[][];
              testNow: unknown[];
            };
          }
        ).__native,
    );

  it("gravar pelo serviço nativo: manda o áudio AAC inteiro ao Gemini, sem usar o microfone do navegador", async () => {
    stack.gemini.reply(
      JSON.stringify({
        transcript: "comprar café",
        tasks: [{ title: "Comprar café" }],
      }),
    );
    const ctx = await newContext();
    await fakeNative(ctx);
    const page = await openApp(ctx);
    await page.getByTestId("record-fab").click();
    await page.getByTestId("timer").waitFor();
    // O app avisa que pode apagar a tela e o limite é o do modo nativo
    expect(await page.getByTestId("screen-off-hint").innerText()).toMatch(
      /apagar a tela/,
    );
    expect(await page.getByText("Até 15:00").count()).toBe(1);
    await page.waitForTimeout(1200);
    await shot(page, "16-nativo-gravando");
    await page.getByTestId("stop-recording").click();
    await page.getByTestId("review-panel").waitFor({ timeout: 20_000 });

    const calls = (await nativeState(page)).calls;
    expect(calls).toContain("start");
    expect(calls).toContain("stop");
    const parts = stack.gemini.calls.at(-1)!.body.contents![0].parts as {
      inlineData?: { mimeType: string; data: string };
    }[];
    const inline = parts.find((p) => p.inlineData)!.inlineData!;
    expect(inline.mimeType).toBe("audio/aac");
    expect(Buffer.from(inline.data, "base64").equals(FAKE_BYTES)).toBe(true);
    await page.getByTestId("save-drafts").click();
    await toast(page).filter({ hasText: "Tarefa salva" }).waitFor();
    expect(
      await prisma.task.count({
        where: { title: "Comprar café", source: "voice" },
      }),
    ).toBe(1);
    await ctx.close();
  });

  it("fechar o gravador cancela a gravação nativa (o serviço não fica ligado)", async () => {
    const ctx = await newContext();
    await fakeNative(ctx);
    const page = await openApp(ctx);
    await page.getByTestId("record-fab").click();
    await page.getByTestId("timer").waitFor();
    await page.getByRole("button", { name: "Fechar" }).click();
    await expect
      .poll(async () => (await nativeState(page)).calls)
      .toContain("cancel");
    await ctx.close();
  });

  it("sem permissão de microfone: explica o caminho nas configurações do Android", async () => {
    const ctx = await newContext();
    await fakeNative(ctx, { denyMic: true });
    const page = await openApp(ctx);
    await page.getByTestId("record-fab").click();
    const err = page.getByTestId("recorder-error");
    await err.waitFor();
    expect(await err.innerText()).toMatch(
      /Configurações do Android[\s\S]*Microfone/,
    );
    await ctx.close();
  });

  it("as tarefas viram alarmes do aparelho: só as futuras, no horário do aviso, com o texto falado", async () => {
    const inMin = (m: number) => new Date(Date.now() + m * 60_000);
    const a = await prisma.task.create({
      data: { title: "Ligar para o banco", dueAt: inMin(120), hasTime: true },
    });
    const b = await prisma.task.create({
      data: {
        title: "Reunião",
        dueAt: inMin(180),
        hasTime: true,
        remindMinutesBefore: 30,
      },
    });
    await prisma.task.create({
      data: { title: "Já feita", dueAt: inMin(60), hasTime: true, done: true },
    });
    await prisma.task.create({
      data: { title: "Passada", dueAt: inMin(-60), hasTime: true },
    });
    await prisma.task.create({ data: { title: "Sem data" } });
    const ctx = await newContext();
    await fakeNative(ctx);
    const page = await openApp(ctx);
    await expect
      .poll(async () => (await nativeState(page)).reminders.length, {
        timeout: 8000,
      })
      .toBeGreaterThan(0);
    let last = (await nativeState(page)).reminders.at(-1)!;
    expect(last.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(last[0].spoken).toBe("Lembrete: Ligar para o banco. É agora.");
    expect(Math.abs(last[0].at - a.dueAt!.getTime())).toBeLessThan(1000);
    expect(last[1].spoken).toBe(
      "Lembrete: Reunião. Começa daqui a 30 minutos.",
    );
    expect(
      Math.abs(last[1].at - (b.dueAt!.getTime() - 30 * 60_000)),
    ).toBeLessThan(1000);

    // concluir uma tarefa tira o alarme dela
    await row(page, "Ligar para o banco").getByRole("checkbox").click();
    await expect
      .poll(
        async () =>
          (await nativeState(page)).reminders.at(-1)!.map((i) => i.id),
        { timeout: 8000 },
      )
      .toEqual([b.id]);
    // criar uma nova agenda o alarme
    await page.getByTestId("quick-input").fill("daqui a 2 horas tomar remédio");
    await page.getByTestId("quick-submit").click();
    await expect
      .poll(async () => (await nativeState(page)).reminders.at(-1)!.length, {
        timeout: 8000,
      })
      .toBe(2);
    last = (await nativeState(page)).reminders.at(-1)!;
    expect(
      last.some((i) => i.spoken.startsWith("Lembrete: Tomar remédio")),
    ).toBe(true);
    await ctx.close();
  });

  it("pede a permissão de notificação uma única vez", async () => {
    const ctx = await newContext();
    await fakeNative(ctx);
    const page = await openApp(ctx);
    await expect
      .poll(
        async () =>
          (await nativeState(page)).calls.filter(
            (c) => c === "requestNotifications",
          ).length,
      )
      .toBe(1);
    await page.reload();
    await page.getByTestId("record-fab").waitFor();
    await page.waitForTimeout(600);
    expect(
      (await nativeState(page)).calls.filter(
        (c) => c === "requestNotifications",
      ).length,
    ).toBe(0);
    await ctx.close();
  });

  it("Ajustes no app Android: mostra os alarmes, testa o alarme e esconde o que é só do navegador", async () => {
    await prisma.task.create({
      data: {
        title: "Um lembrete",
        dueAt: new Date(Date.now() + 3600_000),
        hasTime: true,
      },
    });
    const ctx = await newContext();
    await fakeNative(ctx);
    const page = await openApp(ctx);
    await page.getByTestId("nav-ajustes").click();
    await page.getByTestId("native-status").waitFor();
    await expect
      .poll(() => page.getByTestId("native-status").innerText(), {
        timeout: 8000,
      })
      .toMatch(/1 lembrete agendado/);
    await shot(page, "17-nativo-ajustes");
    expect(await page.getByTestId("toggle-push").count()).toBe(0);
    expect(await page.getByTestId("toggle-speak").count()).toBe(0);
    expect(await page.getByTestId("install-app").count()).toBe(0);
    await page.getByTestId("native-test").click();
    await expect
      .poll(async () => (await nativeState(page)).testNow)
      .toEqual([{ seconds: 5 }]);
    await ctx.close();
  });

  it("notificações bloqueadas: avisa e oferece permitir", async () => {
    const ctx = await newContext();
    await fakeNative(ctx, { notifications: false });
    const page = await openApp(ctx);
    await page.getByTestId("nav-ajustes").click();
    await page.getByText("As notificações estão bloqueadas").waitFor();
    await page.getByTestId("native-allow").waitFor();
    await ctx.close();
  });

  it("no app nativo o cartão de alerta aparece, mas quem fala é o alarme do aparelho (o navegador fica quieto)", async () => {
    await prisma.task.create({
      data: {
        title: "Hora do remédio",
        dueAt: new Date(Date.now() - 20_000),
        hasTime: true,
      },
    });
    const ctx = await newContext();
    await fakeNative(ctx);
    await fakeSpeech(ctx);
    const page = await openApp(ctx);
    await page.getByTestId("alert").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1800);
    expect(await spokenList(page)).toEqual([]);
    await ctx.close();
  });
});

describe("botão Voltar do Android", () => {
  it("Voltar fecha a folha aberta em vez de sair do app; fechar pelo X não deixa lixo no histórico", async () => {
    await prisma.task.create({ data: { title: "Tarefa para abrir" } });
    const ctx = await newContext();
    const page = await openApp(ctx);
    const sameDoc = await page.evaluate(
      () => ((window as unknown as { __marca?: number }).__marca = 42),
    );
    expect(sameDoc).toBe(42);

    // formulário de edição
    await row(page, "Tarefa para abrir")
      .getByRole("button", { name: /^Editar/ })
      .click();
    await page.getByTestId("task-form").waitFor();
    await page.goBack();
    await page.getByTestId("task-form").waitFor({ state: "detached" });
    // continua no app, sem recarregar a página
    expect(
      await page.evaluate(
        () => (window as unknown as { __marca?: number }).__marca,
      ),
    ).toBe(42);
    expect(new URL(page.url()).pathname).toBe("/");

    // gravador
    await page.getByTestId("record-fab").click();
    await page.getByTestId("timer").waitFor();
    await page.goBack();
    await page.getByTestId("timer").waitFor({ state: "detached" });
    expect(
      await page.evaluate(
        () => (window as unknown as { __marca?: number }).__marca,
      ),
    ).toBe(42);

    // fechar pelo botão X remove a entrada extra: o histórico volta ao que era
    const before = await page.evaluate(() => history.length);
    await row(page, "Tarefa para abrir")
      .getByRole("button", { name: /^Editar/ })
      .click();
    await page.getByTestId("task-form").waitFor();
    await page.getByRole("button", { name: "Fechar" }).click();
    await page.getByTestId("task-form").waitFor({ state: "detached" });
    await expect
      .poll(() => page.evaluate(() => history.state?.pautaSheet ?? null))
      .toBeNull();
    expect(
      await page.evaluate(
        () => (window as unknown as { __marca?: number }).__marca,
      ),
    ).toBe(42);
    void before;
    await ctx.close();
  });

  it("durante o processamento o Voltar não fecha a tela (o áudio já foi enviado)", async () => {
    // Gemini lento: a folha fica em 'processando' por um tempo
    stack.gemini.reply(
      JSON.stringify({ transcript: "ok", tasks: [{ title: "Lenta" }] }),
    );
    const ctx = await newContext();
    const page = await openApp(ctx);
    await page.route("**/api/tasks/voice", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.getByTestId("record-fab").click();
    await page.getByTestId("timer").waitFor();
    await page.waitForTimeout(1200);
    await page.getByTestId("stop-recording").click();
    await page.getByTestId("processing").waitFor();
    await page.goBack();
    expect(await page.getByTestId("processing").count()).toBe(1);
    await page.getByTestId("review-panel").waitFor({ timeout: 20_000 });
    await ctx.close();
  });
});

describe("aparência", () => {
  for (const [name, scheme, viewport] of [
    ["claro-412", "light", { width: 412, height: 915 }],
    ["escuro-412", "dark", { width: 412, height: 915 }],
    ["claro-360", "light", { width: 360, height: 640 }],
  ] as const) {
    it(`tela principal sem rolagem horizontal e com alvos de toque grandes (${name})`, async () => {
      const d = (days: number, h = 15) => at(addDaysToKey(today(), days), h);
      await prisma.task.createMany({
        data: [
          {
            title: "Reunião com a equipe de vendas sobre o trimestre",
            dueAt: d(0, 23),
            hasTime: true,
            priority: 1,
            remindMinutesBefore: 15,
          },
          {
            title: "Tomar remédio",
            dueAt: d(0, 23),
            hasTime: true,
            repeat: "daily",
            source: "voice",
          },
          { title: "Atrasada", dueAt: d(-1), hasTime: true },
          { title: "Comprar pão" },
        ],
      });
      const ctx = await newContext({ colorScheme: scheme, viewport });
      const page = await openApp(ctx);
      await row(page, "Tomar remédio").waitFor();
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            "button, [role=checkbox], [role=tab], input, select",
          ),
        ]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              label: (
                el.getAttribute("aria-label") ||
                el.textContent ||
                el.tagName
              )
                .trim()
                .slice(0, 30),
              w: r.width,
              h: r.height,
            };
          })
          .filter(
            (b) =>
              b.w > 0 &&
              b.h > 0 &&
              (b.h < 40 || b.w < 40) &&
              !/^(Hoje|Amanhã)$/.test(b.label),
          ),
      );
      // Alvos pequenos só são aceitáveis se a área clicável efetiva for grande (ex.: linha inteira).
      expect(small.filter((b) => b.h < 32 || b.w < 32)).toEqual([]);
      await shot(page, `15-principal-${name}`);
      await ctx.close();
    });
  }
});
