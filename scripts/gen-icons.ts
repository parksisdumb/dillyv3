/**
 * Generates the PWA icons in public/icons from the Dilly mark (a roof-ridge chevron over a bold D).
 *
 *   npx tsx scripts/gen-icons.ts
 *
 * Outputs (commit them):
 *   dilly-mark.svg         source mark, rounded tile
 *   icon-192.png / -512    purpose "any" (rounded tile, transparent corners)
 *   maskable-192 / -512    purpose "maskable" (full-bleed ink, mark inside the 80% safe zone)
 *   apple-touch-icon.png   180×180 full-bleed (iOS rounds the corners itself)
 *   badge-72.png           monochrome white silhouette for the Android status bar
 *
 * Colors are the design tokens in src/app/globals.css: ink #15202B, safety orange #E4570F, ground #F5F6F3.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const INK = "#15202B";
const ACCENT = "#E4570F";
const GROUND = "#F5F6F3";
const OUT = path.resolve(__dirname, "..", "public", "icons");

/** The mark on a 512 canvas, scaled about the centre. */
function mark(scale: number, chevron: string, letter: string): string {
  const t = `translate(256 256) scale(${scale}) translate(-256 -252)`;
  return `<g transform="${t}">
    <path d="M118 206 L256 104 L394 206" fill="none" stroke="${chevron}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
    <path fill-rule="evenodd" fill="${letter}" d="M158 236 H256 A100 98 0 0 1 256 432 H158 Z M214 286 H252 A48 48 0 0 1 252 382 H214 Z"/>
  </g>`;
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;

const variants = {
  rounded: svg(`<rect width="512" height="512" rx="112" fill="${INK}"/>${mark(1, ACCENT, GROUND)}`),
  maskable: svg(`<rect width="512" height="512" fill="${INK}"/>${mark(0.8, ACCENT, GROUND)}`),
  apple: svg(`<rect width="512" height="512" fill="${INK}"/>${mark(0.86, ACCENT, GROUND)}`),
  badge: svg(mark(1.1, "#FFFFFF", "#FFFFFF")),
};

async function png(src: string, size: number, file: string) {
  await sharp(Buffer.from(src), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
  console.log(`wrote public/icons/${file}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "dilly-mark.svg"), `${variants.rounded}\n`);
  await png(variants.rounded, 192, "icon-192.png");
  await png(variants.rounded, 512, "icon-512.png");
  await png(variants.maskable, 192, "maskable-192.png");
  await png(variants.maskable, 512, "maskable-512.png");
  await png(variants.apple, 180, "apple-touch-icon.png");
  await png(variants.badge, 72, "badge-72.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
