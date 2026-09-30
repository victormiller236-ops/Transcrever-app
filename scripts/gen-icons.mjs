// Gera os PNGs do PWA a partir de public/icons/logo.svg, usando o Chromium.
// Uso: node scripts/gen-icons.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public/icons/logo.svg"), "utf8");
const badge = readFileSync(join(root, "public/icons/badge.svg"), "utf8");
const executablePath = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon-48.png", 48],
];

const browser = await chromium.launch({ executablePath });
try {
  for (const [file, size] of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: join(root, "public/icons", file) });
    await page.close();
  }
  // Emblema monocromático da barra de status do Android (só o canal alfa importa).
  const page = await browser.newPage({ viewport: { width: 96, height: 96 } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${badge}`);
  await page.screenshot({ path: join(root, "public/icons/badge-96.png"), omitBackground: true });
  await page.close();
} finally {
  await browser.close();
}
console.log("ícones gerados");
