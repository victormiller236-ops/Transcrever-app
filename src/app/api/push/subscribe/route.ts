import { prisma } from "@/lib/prisma";
import { fail, json, readJson, requireSession } from "@/lib/api";
import { isAllowedEndpoint } from "@/lib/push";

export async function POST(req: Request) {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const body = await readJson(req);
  const sub = body?.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const p256dh = sub?.keys?.p256dh;
  const authKey = sub?.keys?.auth;

  if (!isAllowedEndpoint(sub?.endpoint)) return fail("Endpoint de push não reconhecido.");
  if (typeof p256dh !== "string" || typeof authKey !== "string" || p256dh.length > 200 || authKey.length > 100) {
    return fail("Chaves da inscrição inválidas.");
  }

  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;
  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint: sub!.endpoint as string },
    create: { endpoint: sub!.endpoint as string, p256dh, auth: authKey, userAgent },
    update: { p256dh, auth: authKey, userAgent, failures: 0 },
  });
  return json({ ok: true, id: saved.id });
}

export async function DELETE(req: Request) {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const body = await readJson(req);
  if (typeof body?.endpoint !== "string") return fail("Informe o endpoint.");
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint } });
  return json({ ok: true });
}
