"use client";

// Leitura em voz alta dos avisos, com a voz em português do próprio Android (sem internet, sem custo).

const KEY = "myday-speak";

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function getSpeakEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSpeakEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.replace("_", "-").toLowerCase() === "pt-br") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("pt")) ??
    null
  );
}

/** Em alguns aparelhos a lista de vozes só chega depois de um instante. */
function voicesReady(): Promise<void> {
  const synth = window.speechSynthesis;
  if (synth.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener?.("voiceschanged", done);
      resolve();
    };
    synth.addEventListener?.("voiceschanged", done);
    window.setTimeout(done, 600);
  });
}

export type SpeakResult = "spoken" | "blocked" | "unsupported";

/**
 * Fala o texto. "blocked" = o navegador recusou por falta de toque do usuário na página
 * (acontece ao abrir pelo toque no aviso); a tela oferece o botão "Ouvir" nesse caso.
 */
export async function speak(text: string): Promise<SpeakResult> {
  if (!speechSupported()) return "unsupported";
  const synth = window.speechSynthesis;
  await voicesReady();
  synth.cancel();

  return new Promise<SpeakResult>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "pt-BR";
    u.rate = 1;
    u.volume = 1;
    let settled = false;
    const finish = (r: SpeakResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(guard);
      resolve(r);
    };
    // Segurança: algumas engines nunca disparam "end".
    const guard = window.setTimeout(() => finish("spoken"), 20_000);
    u.onend = () => finish("spoken");
    u.onerror = (e) => finish(e.error === "not-allowed" ? "blocked" : "spoken");
    try {
      synth.speak(u);
    } catch {
      finish("blocked");
    }
  });
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}
