// Cliente HTTP com cookie de sessão, para testar as rotas como o navegador faria.

export interface Session {
  get: (path: string, init?: RequestInit) => Promise<Response>;
  json: <T = any>(path: string, init?: RequestInit & { tz?: string }) => Promise<{ status: number; data: T }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  cookie: string;
}

export async function login(baseUrl: string, password: string): Promise<Session> {
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const jar = new Map<string, string>();
  const collect = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  collect(csrfRes);
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  const res = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, password, json: "true" }),
  });
  collect(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error("login falhou");

  const get = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, { redirect: "manual", ...init, headers: { cookie: cookieHeader(), ...(init.headers as object) } });
  return {
    cookie: cookieHeader(),
    get,
    json: async (path, init = {}) => {
      const headers: Record<string, string> = { "x-tz": init.tz ?? "America/Sao_Paulo", ...(init.headers as Record<string, string>) };
      if (typeof init.body === "string") headers["content-type"] = "application/json";
      const r = await get(path, { ...init, headers });
      const data = await r.json().catch(() => null);
      return { status: r.status, data };
    },
  };
}
