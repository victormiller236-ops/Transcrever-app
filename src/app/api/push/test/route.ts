import { prisma } from "@/lib/prisma";
import { fail, json, requireSession } from "@/lib/api";
import { PushSendError, pushConfigured, sendPush } from "@/lib/push";

export async function POST() {
  if (!(await requireSession())) return fail("unauthorized", 401);
  if (!pushConfigured()) return fail("Avisos não configurados no servidor (faltam as chaves VAPID).", 503);

  const subs = await prisma.pushSubscription.findMany();
  if (subs.length === 0) return fail("Nenhum aparelho com avisos ligados.", 409);

  const payload = {
    title: "MyDay",
    body: "Tudo certo: os avisos estão funcionando neste aparelho.",
    url: "/",
    tag: "pauta-teste",
  };
  let sent = 0;
  const gone: string[] = [];
  for (const s of subs) {
    try {
      await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      if (e instanceof PushSendError && (e.statusCode === 404 || e.statusCode === 410)) gone.push(s.id);
    }
  }
  if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  if (sent === 0) return fail("Não consegui entregar. Desligue e ligue os avisos de novo neste aparelho.", 502);
  return json({ sent, removed: gone.length });
}
