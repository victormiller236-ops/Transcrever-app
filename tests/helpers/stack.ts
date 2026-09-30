// Sobe tudo o que o app precisa para rodar de verdade, sem internet:
//  - um "Gemini" falso (HTTP) que responde o que o teste mandar;
//  - um serviço de push falso (HTTPS, cert autoassinado) que guarda o que recebe;
//  - o próprio app (`next start`) apontando para os dois e para o Postgres local.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer as createHttp, type IncomingMessage, type Server } from "node:http";
import { createServer as createHttps } from "node:https";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const webpush = require("web-push") as typeof import("web-push");

export interface GeminiCall {
  path: string;
  body: {
    contents?: { parts?: Record<string, unknown>[] }[];
    generationConfig?: Record<string, unknown>;
  };
}

export interface PushCall {
  path: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

export interface Stack {
  baseUrl: string;
  env: Record<string, string>;
  vapid: { publicKey: string; privateKey: string };
  gemini: {
    calls: GeminiCall[];
    /** Próxima(s) resposta(s). Se a fila esvaziar, repete a última. */
    reply: (text: string) => void;
    failWith: (status: number) => void;
    reset: () => void;
  };
  push: {
    port: number;
    calls: PushCall[];
    /** status por prefixo de caminho: /ok → 201, /gone → 410, /fail → 500 */
    origin: string;
    reset: () => void;
  };
  stop: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}

async function waitFor(url: string, ms = 60_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {}
    if (Date.now() - start > ms) throw new Error(`timeout esperando ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

export async function startStack(opts: { appPort: number; timezone?: string }): Promise<Stack> {
  // --- Gemini falso
  const geminiCalls: GeminiCall[] = [];
  let geminiQueue: string[] = [];
  let geminiLast = "{}";
  let geminiFail: number | null = null;
  const geminiServer = createHttp(async (req, res) => {
    const raw = await readBody(req);
    let body: GeminiCall["body"] = {};
    try {
      body = JSON.parse(raw.toString());
    } catch {}
    geminiCalls.push({ path: req.url ?? "", body });
    if (geminiFail) {
      res.writeHead(geminiFail, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: geminiFail, message: "falha simulada", status: "INTERNAL" } }));
      return;
    }
    const text = geminiQueue.length > 1 ? geminiQueue.shift()! : (geminiQueue[0] ?? geminiLast);
    geminiLast = text;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    );
  });
  const geminiPort = await listen(geminiServer);

  // --- certificado autoassinado para o push falso
  const dir = mkdtempSync(join(tmpdir(), "pauta-tls-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
    { stdio: "ignore" },
  );

  // --- serviço de push falso
  const pushCalls: PushCall[] = [];
  const pushServer = createHttps({ key: readFileSync(key), cert: readFileSync(cert) }, async (req, res) => {
    const body = await readBody(req);
    pushCalls.push({ path: req.url ?? "", headers: req.headers, body });
    const path = req.url ?? "";
    const status = path.startsWith("/gone") ? 410 : path.startsWith("/fail") ? 500 : 201;
    res.writeHead(status);
    res.end();
  });
  const pushPort = await listen(pushServer);

  const vapid = webpush.generateVAPIDKeys();
  const env: Record<string, string> = {
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5433/tarefas?host=/tmp",
    AUTH_SECRET: "segredo-de-teste-0123456789abcdef",
    APP_PASSWORD: "senha-de-teste",
    GEMINI_API_KEY: "chave-falsa",
    GEMINI_BASE_URL: `http://127.0.0.1:${geminiPort}`,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:teste@example.com",
    CRON_SECRET: "segredo-do-cron",
    PUSH_ENDPOINT_HOSTS: "localhost",
    NODE_EXTRA_CA_CERTS: cert,
    APP_TIMEZONE: opts.timezone ?? "America/Sao_Paulo",
    PORT: String(opts.appPort),
    NODE_ENV: "production",
  };

  // --- o app
  const app: ChildProcess = spawn(join(process.cwd(), "node_modules/.bin/next"), ["start", "-p", String(opts.appPort)], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let appLog = "";
  app.stdout?.on("data", (d) => (appLog += d));
  app.stderr?.on("data", (d) => (appLog += d));
  const baseUrl = `http://127.0.0.1:${opts.appPort}`;
  try {
    await waitFor(`${baseUrl}/login`);
  } catch (e) {
    app.kill();
    throw new Error(`${(e as Error).message}\n--- log do app ---\n${appLog}`);
  }

  return {
    baseUrl,
    env,
    vapid,
    gemini: {
      calls: geminiCalls,
      reply: (text) => {
        geminiFail = null;
        geminiQueue = [text];
      },
      failWith: (status) => {
        geminiFail = status;
      },
      reset: () => {
        geminiCalls.length = 0;
        geminiQueue = [];
        geminiFail = null;
      },
    },
    push: {
      port: pushPort,
      calls: pushCalls,
      origin: `https://localhost:${pushPort}`,
      reset: () => {
        pushCalls.length = 0;
      },
    },
    stop: async () => {
      app.kill();
      geminiServer.close();
      pushServer.close();
    },
  };
}
