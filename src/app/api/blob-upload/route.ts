import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { transcribeMedia } from "@/lib/gemini";

export const maxDuration = 60;

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const transcriptions = await prisma.transcription.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ transcriptions });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const blobUrl = typeof body?.blobUrl === "string" ? body.blobUrl : "";
  const filename = typeof body?.filename === "string" ? body.filename : "arquivo";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";

  if (!blobUrl || !mimeType) {
    return NextResponse.json({ error: "blobUrl and mimeType required" }, { status: 400 });
  }

  try {
    const fileResponse = await fetch(blobUrl);
    if (!fileResponse.ok) {
      throw new Error("Não foi possível baixar o arquivo enviado.");
    }
    const blob = await fileResponse.blob();

    const text = await transcribeMedia(blob, mimeType);

    const transcription = await prisma.transcription.create({
      data: { filename, mimeType, status: "completed", text },
    });
    return NextResponse.json({ transcription }, { status: 201 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido.";
    const transcription = await prisma.transcription.create({
      data: { filename, mimeType, status: "error", errorMessage },
    });
    return NextResponse.json({ transcription }, { status: 200 });
  } finally {
    // The original media file isn't needed once Gemini has processed it —
    // delete it from Blob storage so uploads don't accumulate over time.
    await del(blobUrl).catch(() => {
      /* best-effort cleanup */
    });
  }
}
