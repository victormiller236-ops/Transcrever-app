// Gera os ícones do app Android a partir de public/icons/logo.svg.
// Uso (na raiz do repositório): node android-app/scripts/gen-android-icons.mjs
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const res = join(root, "android-app/android/app/src/main/res");
const logo = readFileSync(join(root, "public/icons/logo.svg"), "utf8");
// Só o homem e a maleta, sem o fundo dourado (camada de frente do ícone adaptativo).
const foreground = logo
  .replace(/<rect width="512" height="512" fill="url\(#bg\)"\/>/, "")
  .replace(/<circle cx="256" cy="262" r="196"[^>]*\/>/, "")
  .replace('viewBox="0 0 512 512"', 'viewBox="-110 -110 732 732"');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });

async function render(html, w, h, file, transparent = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<style>html,body{margin:0;background:${transparent ? "transparent" : "#f3a93a"}}svg{display:block}</style>${html}`);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
}
const sized = (svg, px) => svg.replace("<svg ", `<svg style="width:${px}px;height:${px}px" `);

const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const adaptive = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

try {
  for (const [d, px] of Object.entries(legacy)) {
    const dir = join(res, `mipmap-${d}`);
    await render(`<div style="width:${px}px;height:${px}px;border-radius:22%;overflow:hidden">${sized(logo, px)}</div>`, px, px, join(dir, "ic_launcher.png"), true);
    await render(`<div style="width:${px}px;height:${px}px;border-radius:50%;overflow:hidden">${sized(logo, px)}</div>`, px, px, join(dir, "ic_launcher_round.png"), true);
  }
  for (const [d, px] of Object.entries(adaptive)) {
    await render(sized(foreground, px), px, px, join(res, `mipmap-${d}`, "ic_launcher_foreground.png"), true);
  }
} finally {
  await browser.close();
}
writeFileSync(
  join(res, "values", "ic_launcher_background.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F3A93A</color>\n</resources>\n',
);
console.log("ícones do Android gerados");
