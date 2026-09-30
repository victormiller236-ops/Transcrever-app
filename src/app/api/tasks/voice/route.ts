import { fail, json, readJson, requireSession, tzFrom } from "@/lib/api";
import { tasksFromAudio, tasksFromText, VoiceError } from "@/lib/voice";

// Gemini pode levar alguns segundos para ouvir e estruturar o áudio.
// (gravações longas do app Android levam mais tempo para o Gemini ouvir)
export const maxDuration = 120;

// O corpo de uma Vercel Function tem teto de 4,5 MB.
const MAX_AUDIO_BYTES = 4_200_000;
const MAX_TEXT = 8000;

const AUDIO_TYPES = /^audio\/(wav|x-wav|wave|mpeg|mp3|mp4|m4a|x-m4a|aac|ogg|webm|flac|aiff|x-aiff)$/;

export async function POST(req: Request) {
  if (!(await requireSession())) return fail("unauthorized", 401);
  const tz = tzFrom(req);
  const now = new Date();

  try {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await readJson(req);
      const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
      if (!text) return fail("Envie o texto.");
      return json(await tasksFromText(text, now, tz));
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof File) || file.size === 0) return fail("Nenhum áudio recebido.");
    if (file.size > MAX_AUDIO_BYTES) {
      return fail("O áudio é grande demais (máx. ~4 MB). Grave trechos mais curtos ou use a aba Transcrever.", 413);
    }
    const mime = (file.type || "audio/wav").split(";")[0].toLowerCase();
    if (!AUDIO_TYPES.test(mime)) return fail("Formato de áudio não suportado.", 415);

    const audio = Buffer.from(await file.arrayBuffer());
    return json(await tasksFromAudio(audio, mime, now, tz));
  } catch (error) {
    if (error instanceof VoiceError) return fail(error.message, error.status);
    console.error("voice error", error);
    return fail("Erro ao processar o áudio.", 500);
  }
}
