"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function clientTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

/** fetch JSON com o fuso do aparelho; sessão expirada leva ao login. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-tz", clientTz());
  if (init.body && typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError("Sem conexão com o servidor.", 0);
  }

  if (res.status === 401) {
    window.location.href = "/login";
    throw new ApiError("Sessão expirada.", 401);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError((data && typeof data.error === "string" && data.error) || "Algo deu errado.", res.status);
  }
  return data as T;
}
