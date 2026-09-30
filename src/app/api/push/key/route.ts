import { fail, json, requireSession } from "@/lib/api";
import { vapidPublicKey } from "@/lib/push";

export async function GET() {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const publicKey = vapidPublicKey();
  if (!publicKey) return fail("Avisos não configurados no servidor (faltam as chaves VAPID).", 503);
  return json({ publicKey });
}
