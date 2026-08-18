import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";

const MODEL = "gemini-3.5-flash";

const PROMPT =
  "Transcreva integralmente a fala contida neste arquivo de áudio ou vídeo, " +
  "em português (ou no idioma original, se não for português). Devolva apenas " +
  "o texto transcrito, sem comentários, sem marcações e sem timestamps.";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não configurada.");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Uploads a media file to Gemini's Files API and asks the model to
 * transcribe the speech it contains. Works for both audio and video since
 * Gemini accepts both directly (no separate audio extraction needed).
 */
export async function transcribeMedia(blob: Blob, mimeType: string): Promise<string> {
  const ai = getClient();

  let uploaded = await ai.files.upload({
    file: blob,
    config: { mimeType },
  });

  if (!uploaded.uri || !uploaded.mimeType || !uploaded.name) {
    throw new Error("Falha ao enviar o arquivo para o Gemini.");
  }
  const fileName = uploaded.name;

  // Leaves headroom under a função's 300s ceiling for generateContent
  // itself e o upload/download em volta.
  const maxWaitMs = 240_000;
  const start = Date.now();
  while (uploaded.state === "PROCESSING") {
    if (Date.now() - start > maxWaitMs) {
      throw new Error("O arquivo demorou demais para processar. Tente um arquivo menor ou mais curto.");
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    uploaded = await ai.files.get({ name: fileName });
  }

  if (uploaded.state === "FAILED") {
    throw new Error("O Gemini não conseguiu processar o arquivo enviado.");
  }
  if (!uploaded.uri || !uploaded.mimeType) {
    throw new Error("Falha ao processar o arquivo no Gemini.");
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: createUserContent([
      PROMPT,
      createPartFromUri(uploaded.uri, uploaded.mimeType),
    ]),
  });

  const text = response.text;
  if (!text) {
    throw new Error("O Gemini não retornou nenhum texto.");
  }
  return text.trim();
}
