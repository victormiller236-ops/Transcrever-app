import { prisma } from "@/lib/prisma";
import { fail, json, readJson, requireSession, tzFrom } from "@/lib/api";
import { draftToData, normalizeDraft, taskToDTO } from "@/lib/tasks-shape";

export async function GET(req: Request) {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const tz = tzFrom(req);
  const scope = new URL(req.url).searchParams.get("scope");

  const tasks = await prisma.task.findMany({
    where: scope === "open" ? { done: false } : scope === "done" ? { done: true } : undefined,
    orderBy: [{ done: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 500,
  });
  return json({ tasks: tasks.map((t) => taskToDTO(t, tz)) });
}

export async function POST(req: Request) {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const tz = tzFrom(req);
  const body = await readJson(req);
  if (!body) return fail("JSON inválido.");

  const list = Array.isArray(body.tasks) ? body.tasks : [body];
  if (list.length === 0 || list.length > 20) return fail("Envie de 1 a 20 tarefas.");

  const source = body.source === "voice" ? "voice" : "manual";
  const transcript =
    typeof body.transcript === "string" && body.transcript.trim() ? body.transcript.trim().slice(0, 8000) : null;

  const drafts = list.map((raw) => normalizeDraft(raw));
  if (drafts.some((d) => d === null)) return fail("Toda tarefa precisa de um título.");

  const created = await prisma.$transaction(
    drafts.map((d) =>
      prisma.task.create({
        data: { ...draftToData(d!, tz), source, transcript: source === "voice" ? transcript : null },
      }),
    ),
  );
  return json({ tasks: created.map((t) => taskToDTO(t, tz)) }, 201);
}
