"use client";

import { useRef, useState } from "react";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = stage === "uploading" || stage === "transcribing";

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

  async function handleTranscribe() {
    if (!file) return;
    setStage("uploading");
    setErrorMessage(null);

    try {
      const blobResult = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
      });

      setStage("transcribing");

      const res = await fetch("/api/transcriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl: blobResult.url,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
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
          Selecione um áudio ou vídeo e transforme a fala em texto.
        </p>

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
          disabled={busy}
          className="mt-4 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base font-medium shadow-sm disabled:opacity-60"
        >
          Selecionar arquivo
        </button>

        <p className="mt-2 text-sm text-[var(--muted)] break-words">
          {file ? file.name : "Nenhum arquivo selecionado"}
        </p>

        <button
          type="button"
          onClick={handleTranscribe}
          disabled={!file || busy}
          className="mt-3 w-full rounded-xl bg-[var(--color-primary)] text-[var(--background)] font-semibold py-3 disabled:opacity-40"
        >
          Transcrever
        </button>

        {busy && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--color-accent)]" />
            </div>
            <p className="mt-2 text-center text-sm text-[var(--muted)]">
              {stage === "uploading" ? "Enviando arquivo..." : "Transcrevendo..."}
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
