"use client";

import { signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client-api";
import {
  disablePush,
  enablePush,
  getPushState,
  isStandalone,
  pushSupported,
  sendTestPush,
  type PushState,
} from "@/lib/pwa";
import { getSpeakEnabled, setSpeakEnabled, speak, speechSupported } from "@/lib/speech";
import { Icon, Logo, useToast } from "./ui";

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function Card({ title, icon, children }: { title: string; icon: React.ComponentProps<typeof Icon>["name"]; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-[var(--surface)] p-5 shadow-[var(--shadow)]">
      <h2 className="mb-3 flex items-center gap-2 text-[17px] font-bold">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--color-accent)]">
          <Icon name={icon} size={17} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsTab({
  tz,
  installPrompt,
  onInstalled,
}: {
  tz: string;
  installPrompt: InstallPromptEvent | null;
  onInstalled: () => void;
}) {
  const toast = useToast();
  const [push, setPush] = useState<PushState | "loading">("loading");
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [speakOn, setSpeakOn] = useState(true);
  const [canSpeak, setCanSpeak] = useState(false);

  const refresh = useCallback(async () => {
    setPush(await getPushState());
  }, []);

  useEffect(() => {
    // Lê o estado real do navegador (permissão, inscrição, modo instalado) ao abrir a aba.
    /* eslint-disable react-hooks/set-state-in-effect */
    void refresh();
    setStandalone(isStandalone());
    setSpeakOn(getSpeakEnabled());
    setCanSpeak(speechSupported());
    /* eslint-enable react-hooks/set-state-in-effect */
    api("/api/push/key")
      .then(() => setServerReady(true))
      .catch((e) => setServerReady(e instanceof ApiError && e.status === 503 ? false : null));
  }, [refresh]);

  async function toggle() {
    setBusy(true);
    try {
      if (push === "on") {
        await disablePush();
        toast.show("Avisos desligados neste aparelho.");
      } else {
        const state = await enablePush();
        if (state === "on") toast.show("Avisos ligados. Vou te chamar na hora certa.", { tone: "success" });
        else if (state === "denied") toast.show("Permissão negada. Libere as notificações nas configurações do site.", { tone: "error", ms: 6000 });
      }
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Não consegui ligar os avisos.", { tone: "error", ms: 5000 });
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await sendTestPush();
      toast.show("Aviso de teste enviado. Olhe a barra de notificações.");
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Falhou.", { tone: "error", ms: 5000 });
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") onInstalled();
  }

  const pushUnsupported = push === "unsupported" || (!pushSupported() && push !== "loading");

  return (
    <div className="flex flex-col gap-4 pt-2" data-testid="settings">
      <div className="flex items-center gap-4 pb-2">
        <Logo size={64} />
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">MyDay</h1>
          <p className="text-[14px] text-[var(--muted)]">Tarefas por voz, com aviso na hora certa.</p>
        </div>
      </div>

      <Card title="Avisos no celular" icon="bell">
        {pushUnsupported ? (
          <p className="text-[14px] leading-relaxed text-[var(--muted)]">
            Este navegador não recebe avisos. No Android, use o Chrome e instale o app (abaixo).
          </p>
        ) : serverReady === false ? (
          <p className="text-[14px] leading-relaxed text-[var(--muted)]">
            O servidor ainda não tem as chaves de aviso (VAPID). Veja o passo a passo no README, seção “Avisos”.
          </p>
        ) : (
          <>
            <p className="mb-4 text-[14px] leading-relaxed text-[var(--muted)]">
              {push === "on"
                ? "Ligados neste aparelho. Você recebe o aviso mesmo com o app fechado."
                : push === "denied"
                  ? "Bloqueados. No Chrome: cadeado ao lado do endereço → Permissões → Notificações → Permitir."
                  : "Ligue para ser avisado no horário das suas tarefas, mesmo com o app fechado."}
            </p>
            <div className="flex flex-col gap-2.5">
              {push !== "denied" && (
                <button
                  type="button"
                  disabled={busy || push === "loading"}
                  onClick={toggle}
                  data-testid="toggle-push"
                  className={`h-13 rounded-2xl py-3.5 text-[16px] font-bold disabled:opacity-50 ${
                    push === "on"
                      ? "border border-[var(--line)] text-[var(--foreground)]"
                      : "bg-[var(--color-primary)] text-[var(--on-primary)]"
                  }`}
                >
                  {push === "on" ? "Desligar avisos" : "Ligar avisos"}
                </button>
              )}
              {push === "on" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={test}
                  data-testid="test-push"
                  className="rounded-2xl border border-[var(--line)] py-3.5 text-[15px] font-semibold disabled:opacity-50"
                >
                  Enviar aviso de teste
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      <Card title="Aviso falado" icon="volume">
        {!canSpeak ? (
          <p className="text-[14px] leading-relaxed text-[var(--muted)]">Este navegador não sabe ler em voz alta.</p>
        ) : (
          <>
            <p className="mb-4 text-[14px] leading-relaxed text-[var(--muted)]">
              Quando o MyDay está aberto, o aviso é lido em voz alta (voz em português do seu Android). Com a tela
              apagada ou o app fechado, o aviso toca o som e vibra; ao tocar nele, o app abre e lê o lembrete.
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={speakOn}
                data-testid="toggle-speak"
                onClick={() => {
                  setSpeakOn(!speakOn);
                  setSpeakEnabled(!speakOn);
                }}
                className={`h-13 rounded-2xl py-3.5 text-[16px] font-bold ${
                  speakOn ? "bg-[var(--color-primary)] text-[var(--on-primary)]" : "border border-[var(--line)]"
                }`}
              >
                {speakOn ? "Ler em voz alta: ligado" : "Ler em voz alta: desligado"}
              </button>
              <button
                type="button"
                data-testid="test-speak"
                onClick={async () => {
                  const r = await speak("Lembrete: ligar para o banco. É agora.");
                  if (r === "blocked") toast.show("O navegador bloqueou o som. Toque de novo.", { tone: "error" });
                }}
                className="rounded-2xl border border-[var(--line)] py-3.5 text-[15px] font-semibold"
              >
                Testar a voz
              </button>
            </div>
          </>
        )}
      </Card>

      <Card title="Instalar no Android" icon="phone">
        {standalone ? (
          <p className="text-[14px] leading-relaxed text-[var(--muted)]">Pronto: o MyDay já está instalado e abre em tela cheia.</p>
        ) : installPrompt ? (
          <>
            <p className="mb-4 text-[14px] leading-relaxed text-[var(--muted)]">
              Instale para abrir pelo ícone, em tela cheia, e receber os avisos como qualquer app.
            </p>
            <button
              type="button"
              onClick={install}
              data-testid="install-app"
              className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent)] py-3.5 text-[16px] font-bold text-[var(--on-accent)]"
            >
              <Icon name="download" size={18} />
              Instalar o MyDay
            </button>
          </>
        ) : (
          <p className="text-[14px] leading-relaxed text-[var(--muted)]">
            No Chrome, toque no menu <b>⋮</b> e escolha <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).
          </p>
        )}
      </Card>

      <Card title="Conta" icon="settings">
        <p className="mb-3 text-[13px] text-[var(--muted)]">Fuso horário: {tz}</p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--line)] text-[15px] font-semibold"
        >
          <Icon name="logout" size={17} />
          Sair
        </button>
      </Card>
    </div>
  );
}
