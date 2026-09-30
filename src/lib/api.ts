import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveTimezone } from "./datetime";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

export async function requireSession(): Promise<boolean> {
  return Boolean(await auth());
}

/** Fuso do usuário: o navegador manda no cabeçalho `x-tz`. */
export function tzFrom(req: Request): string {
  return resolveTimezone(req.headers.get("x-tz"));
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
