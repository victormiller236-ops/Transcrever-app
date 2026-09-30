import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fail, json, readJson, requireSession, tzFrom } from "@/lib/api";
import { taskToDTO } from "@/lib/tasks-shape";

// Adia o aviso: o vencimento passa a ser "agora + N minutos".
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const { id } = await params;
  const body = (await readJson(req)) ?? {};
  const minutes = Math.min(Math.max(Math.round(Number(body.minutes) || 10), 1), 24 * 60);

  try {
    const task = await prisma.task.update({
      where: { id },
      data: {
        dueAt: new Date(Date.now() + minutes * 60_000),
        hasTime: true,
        remindMinutesBefore: 0,
        remindedAt: null,
        done: false,
        doneAt: null,
      },
    });
    return json({ task: taskToDTO(task, tzFrom(req)) });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return fail("Tarefa não encontrada.", 404);
    }
    throw e;
  }
}
