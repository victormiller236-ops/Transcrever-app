import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isLoginPage = pathname === "/login";

  if (!isLoggedIn && pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
});

// Ficam de fora do login: o que o navegador busca sem cookie para tornar o app
// instalável (manifest, ícones, service worker) e o endpoint do cron, que tem
// segredo próprio (CRON_SECRET). Se "sw.js" voltar a ser redirecionado para
// /login, o Chrome recusa registrar o service worker e o app deixa de instalar.
export const config = {
  matcher: [
    "/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/|screenshots/|street-shift).*)",
  ],
};
