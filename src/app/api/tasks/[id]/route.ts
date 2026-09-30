import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fail, json, readJson, requireSession, tzFrom } from "@/lib/api";
import { buildDue, nextOccurrence, REPEATS, type Repeat } from "@/lib/datetime";
import { MAX_NOTES, MAX_REMIND_MINUTES, MAX_TITLE, taskToDTO } from "@/lib/tasks-shape";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const tz = tzFrom(req);
  const { id } = await params;
  const body = await readJson(req);
  if (!body) return fail("JSON inválido.");

  const current = await prisma.task.findUnique({ where: { id } });
  if (!current) return fail("Tarefa não encontrada.", 404);

  const data: Prisma.TaskUpdateInput = {};
  let advanced = false;
  const now = new Date();

  if ("title" in body) {
    const t = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
    if (!t) return fail("O título não pode ficar vazio.");
    data.title = t.slice(0, MAX_TITLE);
  }
  if ("notes" in body) {
    data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, MAX_NOTES) : null;
  }
  if ("priority" in body) data.priority = Number(body.priority) === 1 ? 1 : 0;

  let repeat = current.repeat as Repeat;
  if ("repeat" in body) {
    if (!REPEATS.includes(body.repeat as Repeat)) return fail("Repetição inválida.");
    repeat = body.repeat as Repeat;
  }
  let remind = current.remindMinutesBefore;
  if ("remindMinutesBefore" in body) {
    const n = Number(body.remindMinutesBefore);
    if (!Number.isFinite(n)) return fail("Antecedência inválida.");
    remind = Math.min(Math.max(Math.round(n), 0), MAX_REMIND_MINUTES);
  }

  let dueAt = current.dueAt;
  let hasTime = current.hasTime;
  let dueChanged = false;
  if ("date" in body || "time" in body) {
    const date = "date" in body ? (typeof body.date === "string" ? body.date : null) : null;
    const time = "time" in body ? (typeof body.time === "string" ? body.time : null) : null;
    if ("date" in body && date && !buildDue(date, null, tz).dueAt) return fail("Data inválida.");
    if (!("date" in body)) return fail("Para mudar o horário, envie também a data.");
    const due = buildDue(date, time, tz);
    dueAt = due.dueAt;
    hasTime = due.hasTime;
    dueChanged = true;
  }
  if (!dueAt) {
    repeat = "none";
    remind = 0;
  }
  data.dueAt = dueAt;
  data.hasTime = hasTime;
  data.repeat = repeat;
  data.remindMinutesBefore = remind;
  if (dueChanged || remind !== current.remindMinutesBefore) data.remindedAt = null;

  if ("done" in body) {
    if (body.done === true) {
      const next = dueAt && repeat !== "none" ? nextOccurrence(dueAt, repeat, tz, now) : null;
      if (next) {
        // Tarefa repetida: "concluir" leva para a próxima ocorrência em vez de encerrar.
        data.dueAt = next;
        data.remindedAt = null;
        data.done = false;
        data.doneAt = now;
        advanced = true;
      } else {
        data.done = true;
        data.doneAt = now;
      }
    } else {
      data.done = false;
      data.doneAt = null;
      // Reabrir uma tarefa antiga não deve disparar aviso do passado.
      if (current.done) data.remindedAt = current.remindedAt ?? now;
    }
  }

  const updated = await prisma.task.update({ where: { id }, data });
  return json({ task: taskToDTO(updated, tz), advanced });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const { id } = await params;
  try {
    await prisma.task.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return fail("Tarefa não encontrada.", 404);
    }
    throw e;
  }
  return json({ ok: true });
}
