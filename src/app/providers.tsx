"use client";

import { SessionProvider } from "next-auth/react";
import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return <SessionProvider>{children}</SessionProvider>;
}
