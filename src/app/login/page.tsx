"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

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
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xs rounded-2xl bg-[var(--surface)] p-6 shadow-sm"
      >
        <h1 className="text-2xl font-bold mb-1">Transcrever</h1>
        <p className="text-sm text-[var(--muted)] mb-5">Entre com a sua senha.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          autoFocus
          required
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--background)] px-4 py-3 text-base mb-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3 disabled:opacity-60"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
        {error && (
          <p className="text-sm text-[var(--color-danger)] mt-3">Senha incorreta.</p>
        )}
      </form>
    </main>
  );
}
