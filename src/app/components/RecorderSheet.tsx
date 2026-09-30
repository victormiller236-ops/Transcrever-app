"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import {
  AudioError,
  MAX_RECORD_SECONDS,
  pickRecorderMime,
  toWav16k,
} from "@/lib/audio";
import { formatDuration } from "@/lib/format";
import type { TaskDraft } from "@/lib/types";
import { Icon, Sheet } from "./ui";
import { ReviewPanel } from "./ReviewPanel";

type Phase = "idle" | "recording" | "processing" | "review" | "error";

interface VoiceResponse {
  transcript: string;
  drafts: TaskDraft[];
  via: "gemini" | "local";
}

const EXAMPLES = [
  "“Amanhã às 9 reunião com a Ana, e sexta pagar o aluguel”",
  "“Toda segunda às 7 academia, me avise 15 minutos antes”",
  "“Daqui a 2 horas ligar para o banco, é urgente”",
];

function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "O microfone está bloqueado. No Chrome, toque no cadeado ao lado do endereço → Permissões → Microfone → Permitir. Depois tente de novo.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "Não encontrei nenhum microfone neste aparelho.";
  if (name === "NotReadableError")
    return "O microfone está em uso por outro app. Feche o outro app e tente de novo.";
  return "Não consegui acessar o microfone.";
}

export function RecorderSheet({
  todayKey,
  initialFile,
  onClose,
  onSave,
  saving,
}: {
  todayKey: string;
  initialFile?: File | null;
  onClose: () => void;
  onSave: (drafts: TaskDraft[], transcript: string) => void;
  saving: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceResponse | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const live = useRef<{
    stream?: MediaStream;
    recorder?: MediaRecorder;
    ctx?: AudioContext;
    raf?: number;
    timer?: number;
    wake?: { release: () => Promise<void> } | null;
    startedAt?: number;
    cancelled?: boolean;
  }>({});
  const lastWav = useRef<Blob | null>(null);
  const [canResend, setCanResend] = useState(false);
  const mounted = useRef(true);

  const cleanupLive = useCallback(() => {
    const l = live.current;
    if (l.raf) cancelAnimationFrame(l.raf);
    if (l.timer) window.clearInterval(l.timer);
    l.stream?.getTracks().forEach((t) => t.stop());
    void l.ctx?.close().catch(() => {});
    void l.wake?.release().catch(() => {});
    live.current = { cancelled: l.cancelled };
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      live.current.cancelled = true;
      try {
        if (live.current.recorder && live.current.recorder.state !== "inactive")
          live.current.recorder.stop();
      } catch {}
      cleanupLive();
    };
  }, [cleanupLive]);

  const sendWav = useCallback(async (wav: Blob) => {
    lastWav.current = wav;
    setCanResend(true);
    setPhase("processing");
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", new File([wav], "fala.wav", { type: "audio/wav" }));
      const res = await api<VoiceResponse>("/api/tasks/voice", {
        method: "POST",
        body: form,
      });
      if (!mounted.current) return;
      setResult(res);
      setPhase("review");
    } catch (e) {
      if (!mounted.current) return;
      setError(
        e instanceof ApiError ? e.message : "Não consegui processar o áudio.",
      );
      setPhase("error");
    }
  }, []);

  const processBlob = useCallback(
    async (blob: Blob) => {
      setPhase("processing");
      try {
        const { wav, seconds } = await toWav16k(blob);
        if (seconds < 0.6)
          throw new AudioError(
            "A gravação ficou curta demais. Segure um pouco mais e fale.",
          );
        if (seconds > MAX_RECORD_SECONDS + 2) {
          throw new AudioError(
            `Esse áudio tem ${formatDuration(Math.round(seconds))}. Aqui cabe até ${formatDuration(MAX_RECORD_SECONDS)}. Para áudios longos, use a aba Transcrever e depois “Criar tarefas”.`,
          );
        }
        await sendWav(wav);
      } catch (e) {
        if (!mounted.current) return;
        setError(
          e instanceof AudioError ? e.message : "Não consegui ler esse áudio.",
        );
        setPhase("error");
      }
    },
    [sendWav],
  );

  const drawWave = useCallback((analyser: AnalyserNode) => {
    // O canvas só existe depois que a tela de gravação é exibida; espera os próximos quadros.
    const waitForCanvas = (attempt: number) => {
      const canvas = canvasRef.current;
      if (canvas) start(canvas);
      else if (attempt < 60)
        live.current.raf = requestAnimationFrame(() =>
          waitForCanvas(attempt + 1),
        );
    };
    const start = (canvas: HTMLCanvasElement) => {
      const g = canvas.getContext("2d");
      if (!g) return;
      const samples = new Uint8Array(analyser.fftSize);
      const bars = 40;
      const history: number[] = new Array(bars).fill(0);
      let lastPush = 0;
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(samples);
        // Volume (RMS) do instante: vira uma barra nova a cada ~70 ms, rolando da direita para a esquerda.
        if (now - lastPush > 70) {
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            const v = (samples[i] - 128) / 128;
            sum += v * v;
          }
          history.push(Math.min(1, Math.sqrt(sum / samples.length) * 3.2));
          history.shift();
          lastPush = now;
        }
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        g.fillStyle = getComputedStyle(canvas).color;
        const gap = 4;
        const bw = (w - gap * (bars - 1)) / bars;
        for (let i = 0; i < bars; i++) {
          const bh = Math.max(5, history[i] * h);
          g.globalAlpha = 0.35 + 0.65 * (i / bars);
          g.beginPath();
          g.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, bw / 2);
          g.fill();
        }
        g.globalAlpha = 1;
        live.current.raf = requestAnimationFrame(tick);
      };
      live.current.raf = requestAnimationFrame(tick);
    };
    waitForCanvas(0);
  }, []);

  const stop = useCallback(() => {
    const r = live.current.recorder;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    lastWav.current = null;
    setCanResend(false);
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Este navegador não permite gravar áudio. Abra o Pauta no Chrome, por HTTPS.",
      );
      setPhase("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      if (!mounted.current) return;
      setError(micErrorMessage(e));
      setPhase("error");
      return;
    }
    if (!mounted.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const chunks: Blob[] = [];
    const mime = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined,
      );
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("Este aparelho não conseguiu iniciar a gravação.");
      setPhase("error");
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      setError("A gravação foi interrompida.");
      setPhase("error");
    };
    recorder.onstop = () => {
      const cancelled = live.current.cancelled;
      const type = recorder.mimeType || mime || "audio/webm";
      cleanupLive();
      if (cancelled || !mounted.current) return;
      const blob = new Blob(chunks, { type });
      if (blob.size === 0) {
        setError("Não gravei nada. Tente de novo.");
        setPhase("error");
        return;
      }
      void processBlob(blob);
    };

    live.current = {
      stream,
      recorder,
      cancelled: false,
      startedAt: Date.now(),
    };

    try {
      const AC: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AC();
      void ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      ctx.createMediaStreamSource(stream).connect(analyser);
      live.current.ctx = ctx;
      setPhase("recording");
      drawWave(analyser);
    } catch {
      setPhase("recording"); // sem ondas, mas grava
    }

    recorder.start(250);
    setElapsed(0);
    live.current.timer = window.setInterval(() => {
      const s = Math.floor(
        (Date.now() - (live.current.startedAt ?? Date.now())) / 1000,
      );
      setElapsed(s);
      if (s >= MAX_RECORD_SECONDS) stop();
    }, 250);

    // Mantém a tela acesa: se ela apagar, o Android pode cortar o microfone.
    try {
      const nav = navigator as unknown as {
        wakeLock?: {
          request: (t: "screen") => Promise<{ release: () => Promise<void> }>;
        };
      };
      live.current.wake = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {}
  }, [cleanupLive, drawWave, processBlob, stop]);

  // Começa a gravar ao abrir (ou processa o arquivo recebido).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Abrir o gravador já começa a gravar (ou a processar o arquivo recebido).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialFile) void processBlob(initialFile);
    else void start();
  }, [initialFile, processBlob, start]);

  function cancel() {
    live.current.cancelled = true;
    try {
      if (live.current.recorder && live.current.recorder.state !== "inactive")
        live.current.recorder.stop();
    } catch {}
    cleanupLive();
    onClose();
  }

  const remaining = MAX_RECORD_SECONDS - elapsed;

  return (
    <Sheet
      onClose={cancel}
      label="Gravar tarefas por voz"
      tall={phase !== "review"}
      dismissable={phase !== "processing" && !saving}
    >
      {phase === "review" && result ? (
        <ReviewPanel
          drafts={result.drafts}
          transcript={result.transcript}
          via={result.via}
          todayKey={todayKey}
          saving={saving}
          onSave={(drafts) => onSave(drafts, result.transcript)}
          onRetry={() => {
            setResult(null);
            void start();
          }}
          onCancel={onClose}
        />
      ) : (
        <div className="flex min-h-[calc(92dvh-40px)] flex-col items-center px-6 pb-4 pt-6 text-center">
          <button
            type="button"
            onClick={cancel}
            aria-label="Fechar"
            className="absolute right-4 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)]"
          >
            <Icon name="x" size={18} />
          </button>

          {phase === "recording" && (
            <>
              <p className="mt-6 text-[15px] font-semibold text-[var(--muted)]">
                Estou ouvindo…
              </p>
              <p
                className={`mt-2 font-mono text-[56px] font-bold leading-none tabular-nums ${
                  remaining <= 15 ? "text-[var(--color-danger)]" : ""
                }`}
                data-testid="timer"
              >
                {formatDuration(elapsed)}
              </p>
              <p className="mt-1 text-[13px] text-[var(--faint)]">
                {remaining <= 15
                  ? `Acaba em ${Math.max(0, remaining)} s`
                  : `Até ${formatDuration(MAX_RECORD_SECONDS)}`}
              </p>
              <canvas
                ref={canvasRef}
                className="mt-8 h-28 w-full max-w-sm text-[var(--color-accent)]"
                aria-hidden="true"
              />
              <p className="mt-8 max-w-xs text-[14px] leading-relaxed text-[var(--muted)]">
                Pode dizer várias tarefas de uma vez, com dia e hora.
              </p>
              <p className="mt-2 max-w-xs text-[13px] italic leading-relaxed text-[var(--faint)]">
                {EXAMPLES[0]}
              </p>
              <div className="mt-auto pt-8">
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Parar e entender"
                  data-testid="stop-recording"
                  className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[var(--color-danger)] text-white shadow-2xl active:scale-95"
                >
                  <Icon name="stop" size={36} />
                </button>
                <p className="mt-3 text-[13px] font-semibold text-[var(--muted)]">
                  Toque para terminar
                </p>
              </div>
            </>
          )}

          {phase === "processing" && (
            <div
              className="flex w-full flex-1 flex-col items-center justify-center gap-5"
              data-testid="processing"
            >
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--on-accent)]">
                <Icon name="sparkle" size={38} className="animate-pulse" />
              </div>
              <div>
                <p className="text-[20px] font-bold">
                  Organizando suas tarefas…
                </p>
                <p className="mt-1 text-[14px] text-[var(--muted)]">
                  Ouvindo, entendendo datas e horários.
                </p>
              </div>
              <div className="w-full max-w-xs space-y-2.5">
                <div className="skeleton h-14 rounded-2xl" />
                <div className="skeleton h-14 rounded-2xl opacity-70" />
              </div>
            </div>
          )}

          {phase === "error" && (
            <div
              className="flex w-full flex-1 flex-col items-center justify-center gap-4"
              data-testid="recorder-error"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--color-danger)]">
                <Icon name="mic" size={34} />
              </div>
              <p className="max-w-xs text-[16px] font-semibold leading-snug">
                {error}
              </p>
              <div className="flex w-full max-w-xs flex-col gap-2.5">
                {canResend && (
                  <button
                    type="button"
                    onClick={() => void sendWav(lastWav.current!)}
                    className="h-13 rounded-2xl bg-[var(--color-primary)] py-3.5 text-[16px] font-bold text-[var(--on-primary)]"
                  >
                    Enviar de novo
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void start()}
                  className="rounded-2xl border border-[var(--line)] py-3.5 text-[16px] font-semibold"
                >
                  Gravar de novo
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-2xl border border-[var(--line)] py-3.5 text-[15px] font-semibold text-[var(--muted)]"
                >
                  <Icon
                    name="upload"
                    size={16}
                    className="mr-1.5 inline -translate-y-px"
                  />
                  Usar um arquivo de áudio
                </button>
              </div>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            data-testid="audio-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void processBlob(f);
            }}
          />
        </div>
      )}
    </Sheet>
  );
}
