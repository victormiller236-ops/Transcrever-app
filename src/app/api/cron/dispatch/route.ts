import { timingSafeEqual } from "node:crypto";
import { fail, json } from "@/lib/api";
import { pushConfigured } from "@/lib/push";
import { dispatchDueReminders } from "@/lib/reminders";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) return fail("CRON_SECRET não configurada no servidor.", 503);
  if (!authorized(req)) return fail("unauthorized", 401);
  if (!pushConfigured()) return fail("Chaves VAPID não configuradas.", 503);
  return json(await dispatchDueReminders());
}

// GET: cron da Vercel. POST: GitHub Actions / cron-job.org.
export const GET = handle;
export const POST = handle;
