"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

interface TranscriptionDTO {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  text: string | null;
  errorMessage: string | null;
  createdAt: string;
}

type Stage = "idle" | "uploading" | "transcribing" | "done" | "error";

const RECORDING_MIME_CANDIDATES = [
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg",
];

function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of RECORDING_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("aac")) return "aac";
  return "audio";
}

function formatSeconds(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function TranscreverClient({
  initialTranscriptions,
}: {
  initialTranscriptions: TranscriptionDTO[];
}) {
  const [transcriptions, setTranscriptions] = useState(initialTranscriptions);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [current, setCurrent] = useState<TranscriptionDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const busy = stage === "uploading" || stage === "transcribing";

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function handlePickFile() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setStage("idle");
    setCurrent(null);
    setErrorMessage(null);
  }

  async function runTranscription(source: File | Blob, filename: string, mimeType: string) {
    setStage("uploading");
    setErrorMessage(null);

    try {
      const blobResult = await upload(filename, source, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
      });

      setStage("transcribing");

      const res = await fetch("/api/transcriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl: blobResult.url,
          filename,
          mimeType: mimeType || "application/octet-stream",
        }),
      });

      if (!res.ok) {
        throw new Error("Falha ao processar a transcrição.");
      }

      const { transcription } = (await res.json()) as { transcription: TranscriptionDTO };
      setTranscriptions((prev) => [transcription, ...prev]);
      setCurrent(transcription);

      if (transcription.status === "completed") {
        setStage("done");
      } else {
        setErrorMessage(transcription.errorMessage ?? "Erro desconhecido na transcrição.");
        setStage("error");
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro desconhecido.");
      setStage("error");
    }
  }

  async function handleTranscribeFile() {
    if (!file) return;
    await runTranscription(file, file.name, file.type || "application/octet-stream");
  }

  async function startRecording() {
    setErrorMessage(null);
    setFile(null);
    setCurrent(null);
    setStage("idle");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const finalMimeType = recorder.mimeType || mimeType || "audio/mp4";
        const blob = new Blob(chunksRef.current, { type: finalMimeType });
        chunksRef.current = [];

        if (blob.size === 0) {
          setErrorMessage("Não deu pra gravar nada. Tenta de novo.");
          setStage("error");
          return;
        }

        const stamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        const filename = `gravacao-${stamp}.${extensionForMimeType(finalMimeType)}`;
        void runTranscription(blob, filename, finalMimeType);
      };

      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setErrorMessage(
        "Não consegui acessar o microfone. Confira se deu permissão pro Safari nas Configurações do iPhone."
      );
      setStage("error");
    }
  }

  function stopRecording() {
    setRecording(false);
    mediaRecorderRef.current?.stop();
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }

  async function handleShare(text: string, filename: string) {
    if (navigator.share) {
      try {
        await navigator.share({ title: filename, text });
      } catch {
        /* user cancelled the share sheet */
      }
    } else {
      await handleCopy(text);
    }
  }

  function handleSaveTxt(text: string, filename: string) {
    const base = filename.replace(/\.[^/.]+$/, "");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(id: string) {
    setTranscriptions((prev) => prev.filter((t) => t.id !== id));
    if (current?.id === id) setCurrent(null);
    await fetch(`/api/transcriptions/${id}`, { method: "DELETE" });
  }

  return (
    <div className="flex flex-col flex-1">
      <header className="pt-6 pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Transcrever</h1>
        <p className="text-[15px] text-[var(--muted)] mt-1">
          Selecione um áudio ou vídeo, ou fale direto no microfone.
        </p>

        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={busy}
          className={`mt-4 w-full rounded-xl px-4 py-3 text-base font-semibold shadow-sm disabled:opacity-60 flex items-center justify-center gap-2 ${
            recording
              ? "bg-[var(--color-danger)] text-white"
              : "bg-[var(--color-primary)] text-[var(--background)]"
          }`}
        >
          {recording ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
              Parar gravação · {formatSeconds(recordSeconds)}
            </>
          ) : (
            <>🎙️ Falar e transcrever</>
          )}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/*"
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          type="button"
          onClick={handlePickFile}
          disabled={busy || recording}
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base font-medium shadow-sm disabled:opacity-60"
        >
          Ou selecionar arquivo
        </button>

        <p className="mt-2 text-sm text-[var(--muted)] break-words">
          {file ? file.name : "Nenhum arquivo selecionado"}
        </p>

        {file && (
          <button
            type="button"
            onClick={handleTranscribeFile}
            disabled={busy || recording}
            className="mt-3 w-full rounded-xl bg-[var(--color-primary)] text-[var(--background)] font-semibold py-3 disabled:opacity-40"
          >
            Transcrever
          </button>
        )}

        {busy && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--color-accent)]" />
            </div>
            <p className="mt-2 text-center text-sm text-[var(--muted)]">
              {stage === "uploading" ? "Enviando..." : "Transcrevendo..."}
            </p>
          </div>
        )}

        {stage === "error" && errorMessage && (
          <p className="mt-3 text-sm text-[var(--color-danger)]">{errorMessage}</p>
        )}
      </header>

      {stage === "done" && current?.text && (
        <section className="mb-6">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{current.text}</p>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => handleCopy(current.text!)}
              className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] py-2.5 text-sm font-medium"
            >
              {copyFeedback ? "Copiado!" : "Copiar"}
            </button>
            <button
              type="button"
              onClick={() => handleShare(current.text!, current.filename)}
              className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] py-2.5 text-sm font-medium"
            >
              Compartilhar
            </button>
            <button
              type="button"
              onClick={() => handleSaveTxt(current.text!, current.filename)}
              className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] py-2.5 text-sm font-medium"
            >
              Salvar .txt
            </button>
          </div>
        </section>
      )}

      <section>
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-2">
          Histórico {transcriptions.length > 0 && `(${transcriptions.length})`}
        </p>
        {transcriptions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-4 text-sm italic text-[var(--faint)]">
            Nenhuma transcrição ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transcriptions.map((t) => (
              <li
                key={t.id}
                className="rounded-xl bg-[var(--surface)] px-3.5 py-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.filename}</p>
                    <p className="text-xs text-[var(--faint)]">{formatDate(t.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Excluir"
                    onClick={() => handleDelete(t.id)}
                    className="shrink-0 text-xl leading-none text-[var(--faint)]"
                  >
                    ×
                  </button>
                </div>
                {t.status === "completed" && t.text ? (
                  <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{t.text}</p>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-danger)]">
                    {t.errorMessage ?? "Erro na transcrição."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
