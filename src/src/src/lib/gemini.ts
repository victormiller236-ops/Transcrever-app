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

export async function transcribeMedia(blob: Blob, mimeType: string): Promise<string> {
  const ai = getClient();

  const uploaded = await ai.files.upload({
    file: blob,
    config: { mimeType },
  });

  if (!uploaded.uri || !uploaded.mimeType) {
    throw new Error("Falha ao enviar o arquivo para o Gemini.");
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
