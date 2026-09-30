import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MyDay · tarefas por voz",
    short_name: "MyDay",
    description: "Fale suas tarefas, com dia e hora, e receba o aviso no celular.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f5ef",
    theme_color: "#141c3a",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      { src: "/screenshots/tarefas.png", sizes: "1082x2402", type: "image/png", form_factor: "narrow", label: "Suas tarefas do dia" },
      { src: "/screenshots/revisao.png", sizes: "1082x2402", type: "image/png", form_factor: "narrow", label: "A voz vira tarefas com dia e hora" },
    ],
    shortcuts: [
      {
        name: "Gravar tarefa",
        short_name: "Gravar",
        description: "Abre o gravador de voz",
        url: "/?action=record",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Nova tarefa",
        short_name: "Nova",
        url: "/?action=new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
