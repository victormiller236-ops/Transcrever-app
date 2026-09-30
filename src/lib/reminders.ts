import { prisma } from "./prisma";
import { DEFAULT_TIMEZONE, pad2, utcToLocalParts } from "./datetime";
import { PushSendError, sendPush, type PushPayload, type PushSender } from "./push";

/** Avisos com mais que isso de atraso são descartados em silêncio (não adianta acordar ninguém por algo de ontem). */
const STALE_MS = 24 * 60 * 60 * 1000;
const BATCH = 50;

export interface DispatchSummary {
  due: number;
  sent: number;
  failed: number;
  released: number;
  removedSubscriptions: number;
  reason?: string;
}

function humanMinutes(m: number): string {
  if (m % 1440 === 0) return m === 1440 ? "1 dia" : `${m / 1440} dias`;
  if (m % 60 === 0) return m === 60 ? "1 hora" : `${m / 60} horas`;
  return `${m} min`;
}

export function buildPayload(
  task: { id: string; title: string; dueAt: Date; hasTime: boolean; remindMinutesBefore: number },
  now: Date,
  tz: string,
): PushPayload {
  const p = utcToLocalParts(task.dueAt, tz);
  const hhmm = `${pad2(p.hour)}:${pad2(p.minute)}`;
  let body: string;
  if (!task.hasTime) {
    body = "Para hoje";
  } else if (task.remindMinutesBefore > 0 && task.dueAt.getTime() > now.getTime()) {
    body = `Daqui a ${humanMinutes(task.remindMinutesBefore)} · ${hhmm}`;
  } else if (now.getTime() - task.dueAt.getTime() > 10 * 60_000) {
    body = `Atrasada · era às ${hhmm}`;
  } else {
    body = `Agora · ${hhmm}`;
  }
  return {
    title: task.title,
    body,
    url: `/?task=${task.id}`,
    tag: `task-${task.id}`,
    taskId: task.id,
    actions: true,
  };
}

/**
 * Dispara os avisos que já venceram. Seguro para rodar em paralelo: cada tarefa
 * é "reivindicada" com um UPDATE condicional, então só uma execução a envia.
 */
export async function dispatchDueReminders(
  now: Date = new Date(),
  send: PushSender = sendPush,
  tz: string = DEFAULT_TIMEZONE,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { due: 0, sent: 0, failed: 0, released: 0, removedSubscriptions: 0 };

  await prisma.$executeRaw`
    UPDATE "Task" SET "remindedAt" = ${now}
    WHERE "done" = false AND "remindedAt" IS NULL AND "dueAt" IS NOT NULL
      AND "dueAt" < ${new Date(now.getTime() - STALE_MS)}`;

  const subs = await prisma.pushSubscription.findMany();
  if (subs.length === 0) return { ...summary, reason: "sem-inscricoes" };

  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Task"
    WHERE "done" = false AND "remindedAt" IS NULL AND "dueAt" IS NOT NULL
      AND "dueAt" - ("remindMinutesBefore" * interval '1 minute') <= ${now}
    ORDER BY "dueAt" ASC
    LIMIT ${BATCH}`;
  summary.due = due.length;

  const dead = new Set<string>();

  for (const { id } of due) {
    const claimed = await prisma.task.updateMany({
      where: { id, remindedAt: null, done: false },
      data: { remindedAt: now },
    });
    if (claimed.count !== 1) continue; // outra execução pegou

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task || !task.dueAt) continue;
    const payload = buildPayload({ ...task, dueAt: task.dueAt }, now, tz);

    const results = await Promise.allSettled(
      subs.map((s) => send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)),
    );

    let delivered = 0;
    let transientFailure = false;
    results.forEach((r, i) => {
      const sub = subs[i];
      if (r.status === "fulfilled") {
        delivered++;
        return;
      }
      const code = r.reason instanceof PushSendError ? r.reason.statusCode : undefined;
      if (code === 404 || code === 410) dead.add(sub.id);
      else transientFailure = true;
    });

    if (delivered > 0) {
      summary.sent++;
      await prisma.pushSubscription.updateMany({
        where: { id: { in: subs.filter((_, i) => results[i].status === "fulfilled").map((s) => s.id) } },
        data: { lastSuccessAt: now, failures: 0 },
      });
    } else if (transientFailure) {
      // Nada chegou por falha passageira: devolve a tarefa à fila para a próxima rodada.
      summary.failed++;
      summary.released++;
      await prisma.task.updateMany({ where: { id }, data: { remindedAt: null } });
    } else {
      summary.failed++;
    }
  }

  if (dead.size > 0) {
    const r = await prisma.pushSubscription.deleteMany({ where: { id: { in: [...dead] } } });
    summary.removedSubscriptions = r.count;
  }
  return summary;
}
