"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Logo } from "../components/ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const res = await signIn("credentials", { password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError(true);
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="anim-rise w-full max-w-xs rounded-3xl bg-[var(--surface)] p-7 shadow-[var(--shadow)]">
        <Logo size={88} className="mx-auto mb-4" />
        <h1 className="mb-1 text-center text-[28px] font-bold tracking-tight">Pauta</h1>
        <p className="mb-6 text-center text-[14px] text-[var(--muted)]">Suas tarefas por voz. Entre com a sua senha.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          aria-label="Senha"
          autoComplete="current-password"
          autoFocus
          required
          className="mb-3 h-13 w-full rounded-2xl border border-[var(--line)] bg-[var(--background)] px-4 py-3.5 text-[16px] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-13 w-full rounded-2xl bg-[var(--color-primary)] py-3.5 text-[16px] font-bold text-[var(--on-primary)] disabled:opacity-60"
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
        {error && <p role="alert" className="mt-3 text-center text-[14px] text-[var(--color-danger)]">Senha incorreta.</p>}
      </form>
    </main>
  );
}
