import { prisma } from "@/lib/prisma";
import { TranscreverClient } from "./TranscreverClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const transcriptions = await prisma.transcription.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <main className="max-w-lg mx-auto w-full px-5 pb-10 flex-1 flex flex-col">
      <TranscreverClient
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
    </main>
  );
}
