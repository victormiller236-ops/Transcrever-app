// Áudio (ou texto) → tarefas. O Gemini transcreve e já devolve a estrutura;
// se a estrutura vier vazia, cai no interpretador local sobre a transcrição.

import { Type } from "@google/genai";
import { GEMINI_MODEL, getClient } from "./gemini";
import { parseQuickText } from "./quickparse";
import { normalizeDraft } from "./tasks-shape";
import { pad2, utcToLocalParts } from "./datetime";
import type { TaskDraft } from "./types";

export class VoiceError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const WEEKDAYS_PT = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

function nowContext(now: Date, tz: string): string {
  const p = utcToLocalParts(now, tz);
  return `${WEEKDAYS_PT[p.weekday]}, ${pad2(p.day)}/${pad2(p.month)}/${p.year}, ${pad2(p.hour)}:${pad2(p.minute)} (fuso ${tz})`;
}

function buildPrompt(now: Date, tz: string, source: "audio" | "texto"): string {
  return [
    source === "audio"
      ? "Você recebe um áudio em que a pessoa dita uma ou mais tarefas ou compromissos."
      : "Você recebe um texto em que a pessoa descreve uma ou mais tarefas ou compromissos.",
    `Agora é ${nowContext(now, tz)}. Resolva datas relativas ("amanhã", "sexta", "daqui a 2 horas") a partir deste momento.`,
    "Devolva JSON com:",
    source === "audio"
      ? '- "transcript": a fala transcrita fielmente, em português.'
      : '- "transcript": o próprio texto recebido.',
    '- "tasks": uma entrada por tarefa distinta. Cada uma com:',
    '  - "title": ação curta e clara, começando por verbo no infinitivo quando possível ("Ligar para o João"), sem data nem hora no título.',
    '  - "notes": detalhes extras ditos pela pessoa, ou null.',
    '  - "date": data local AAAA-MM-DD, ou null se nenhuma data foi dita.',
    '  - "time": hora local HH:mm (24h), ou null se nenhum horário foi dito. Nunca invente horário.',
    '  - "priority": 1 só se a pessoa disse que é urgente/importante, senão 0.',
    '  - "repeat": "daily", "weekly", "monthly" se a pessoa pediu repetição ("todo dia", "toda segunda"), senão "none".',
    '  - "remindMinutesBefore": minutos de antecedência do aviso se a pessoa pediu ("me avise 10 minutos antes"), senão 0.',
    "Se não houver nenhuma tarefa reconhecível, devolva tasks vazio. Não invente tarefas.",
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING },
    tasks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          notes: { type: Type.STRING, nullable: true },
          date: { type: Type.STRING, nullable: true },
          time: { type: Type.STRING, nullable: true },
          priority: { type: Type.INTEGER },
          repeat: { type: Type.STRING, enum: ["none", "daily", "weekly", "monthly"] },
          remindMinutesBefore: { type: Type.INTEGER },
        },
        required: ["title"],
      },
    },
  },
  required: ["transcript", "tasks"],
};

export interface VoiceResult {
  transcript: string;
  drafts: TaskDraft[];
  via: "gemini" | "local";
}

/** Interpreta a resposta do modelo, tolerando lixo em volta do JSON. */
export function interpretModelOutput(text: string, now: Date, tz: string): VoiceResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    try {
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      parsed = null;
    }
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const transcript = typeof obj.transcript === "string" ? obj.transcript.trim() : "";
  const rawTasks = Array.isArray(obj.tasks) ? obj.tasks : [];

  const drafts: TaskDraft[] = [];
  for (const raw of rawTasks.slice(0, 20)) {
    const d = normalizeDraft(raw);
    if (d) drafts.push(d);
  }
  if (drafts.length > 0) return { transcript, drafts, via: "gemini" };

  if (transcript) {
    const q = parseQuickText(transcript, now, tz);
    const d = normalizeDraft({ ...q, title: q.title || transcript });
    if (d) return { transcript, drafts: [d], via: "local" };
  }
  throw new VoiceError("Não consegui entender nenhuma tarefa. Tente falar de novo, mais perto do microfone.", 422);
}

async function generate(parts: unknown[], now: Date, tz: string): Promise<VoiceResult> {
  let text: string | undefined;
  try {
    const response = await getClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: parts as never }],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });
    text = response.text;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "erro desconhecido";
    if (/GEMINI_API_KEY/.test(msg)) throw new VoiceError("A chave do Gemini não está configurada no servidor.", 503);
    throw new VoiceError(`O Gemini não respondeu: ${msg.slice(0, 160)}`, 502);
  }
  if (!text) throw new VoiceError("O Gemini não devolveu nada. Tente de novo.", 502);
  return interpretModelOutput(text, now, tz);
}

export async function tasksFromAudio(
  audio: Buffer,
  mimeType: string,
  now: Date,
  tz: string,
): Promise<VoiceResult> {
  return generate(
    [{ text: buildPrompt(now, tz, "audio") }, { inlineData: { mimeType, data: audio.toString("base64") } }],
    now,
    tz,
  );
}

export async function tasksFromText(text: string, now: Date, tz: string): Promise<VoiceResult> {
  try {
    return await generate([{ text: buildPrompt(now, tz, "texto") }, { text: `Texto:\n${text}` }], now, tz);
  } catch (error) {
    // Sem Gemini, o interpretador local ainda resolve o caso simples.
    const q = parseQuickText(text, now, tz);
    const d = normalizeDraft({ ...q, title: q.title || text });
    if (d) return { transcript: text, drafts: [d], via: "local" };
    throw error;
  }
}
