// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Voice = { lang: string; name: string };

function install(opts: { voices?: Voice[]; behavior?: "end" | "not-allowed" | "silent" }) {
  const spoken: { text: string; lang: string; voice: Voice | null }[] = [];
  class Utterance {
    text: string;
    lang = "";
    voice: Voice | null = null;
    rate = 1;
    volume = 1;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    getVoices: () => opts.voices ?? [],
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    speak: (u: Utterance) => {
      spoken.push({ text: u.text, lang: u.lang, voice: u.voice });
      if (opts.behavior === "not-allowed") queueMicrotask(() => u.onerror?.({ error: "not-allowed" }));
      else if (opts.behavior !== "silent") queueMicrotask(() => u.onend?.());
    },
  };
  Object.assign(window, { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance });
  return { spoken, synth };
}

describe("speech", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
    delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  });

  it("fala com a voz pt-BR quando existe, cancelando o que estava falando", async () => {
    const { spoken, synth } = install({ voices: [{ lang: "en-US", name: "en" }, { lang: "pt_BR", name: "pt" }] });
    const { speak } = await import("@/lib/speech");
    expect(await speak("Lembrete: pagar a luz. É agora.")).toBe("spoken");
    expect(synth.cancel).toHaveBeenCalled();
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("Lembrete: pagar a luz. É agora.");
    expect(spoken[0].voice?.name).toBe("pt");
    expect(spoken[0].lang).toBe("pt_BR");
  });

  it("sem voz em português, ainda pede pt-BR ao sistema", async () => {
    const { spoken } = install({ voices: [{ lang: "en-US", name: "en" }] });
    const { speak } = await import("@/lib/speech");
    await speak("oi");
    expect(spoken[0].voice).toBeNull();
    expect(spoken[0].lang).toBe("pt-BR");
  });

  it("navegador recusando por falta de toque vira 'blocked' (a tela mostra o botão Ouvir)", async () => {
    install({ voices: [{ lang: "pt-BR", name: "pt" }], behavior: "not-allowed" });
    const { speak } = await import("@/lib/speech");
    expect(await speak("oi")).toBe("blocked");
  });

  it("sem suporte: 'unsupported'", async () => {
    const { speak, speechSupported } = await import("@/lib/speech");
    expect(speechSupported()).toBe(false);
    expect(await speak("oi")).toBe("unsupported");
  });

  it("espera a lista de vozes chegar (alguns aparelhos demoram)", async () => {
    const { synth } = install({ voices: [] });
    const { speak } = await import("@/lib/speech");
    vi.useFakeTimers();
    const p = speak("oi");
    await vi.advanceTimersByTimeAsync(700); // estoura a espera pela lista e fala mesmo assim
    expect(await p).toBe("spoken");
    expect(synth.addEventListener).toHaveBeenCalledWith("voiceschanged", expect.any(Function));
    vi.useRealTimers();
  });

  it("preferência de voz: ligada por padrão, salva ao desligar", async () => {
    const { getSpeakEnabled, setSpeakEnabled } = await import("@/lib/speech");
    expect(getSpeakEnabled()).toBe(true);
    setSpeakEnabled(false);
    expect(getSpeakEnabled()).toBe(false);
    setSpeakEnabled(true);
    expect(getSpeakEnabled()).toBe(true);
  });
});
