import { prisma } from "@/lib/prisma";
import { DEFAULT_TIMEZONE } from "@/lib/datetime";
import { taskToDTO } from "@/lib/tasks-shape";
import { PautaApp } from "./PautaApp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [tasks, transcriptions] = await Promise.all([
    prisma.task.findMany({
      orderBy: [{ done: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.transcription.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <PautaApp
      initialTasks={tasks.map((t) => taskToDTO(t, DEFAULT_TIMEZONE))}
      serverTz={DEFAULT_TIMEZONE}
      initialNow={new Date().toISOString()}
      initialTranscriptions={transcriptions.map((t) => ({
        id: t.id,
        filename: t.filename,
        mimeType: t.mimeType,
        status: t.status,
        text: t.text,
        errorMessage: t.errorMessage,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
