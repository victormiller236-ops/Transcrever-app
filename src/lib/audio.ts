"use client";

/** Limite de gravação: 110 s em WAV 16 kHz/16 bits ≈ 3,5 MB, abaixo do teto de 4,5 MB da Vercel. */
export const MAX_RECORD_SECONDS = 110;
const TARGET_RATE = 16000;

export class AudioError extends Error {}

const RECORDER_MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDER_MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  new Int16Array(buffer, 44).set(samples);
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Decodifica o que o navegador gravou (webm/mp4/ogg…) e devolve WAV mono 16 kHz.
 * O Gemini aceita WAV sem ressalvas, e assim o formato não depende do aparelho.
 */
export async function toWav16k(blob: Blob): Promise<{ wav: Blob; seconds: number }> {
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new AudioError("Este navegador não consegue processar áudio.");

  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const seconds = decoded.duration;

    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * TARGET_RATE)), TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const data = rendered.getChannelData(0);

    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak < 0.005) throw new AudioError("A gravação saiu em silêncio. Confira se o microfone não está mudo.");

    // Celular costuma gravar baixo: sobe o volume (no máximo 4×) sem estourar.
    const gain = peak < 0.5 ? Math.min(4, 0.9 / peak) : 1;
    const pcm = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = Math.max(-1, Math.min(1, data[i] * gain));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return { wav: encodeWav(pcm, TARGET_RATE), seconds };
  } catch (e) {
    if (e instanceof AudioError) throw e;
    throw new AudioError("Não consegui ler esse áudio.");
  } finally {
    void ctx.close().catch(() => {});
  }
}
