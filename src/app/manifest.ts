import type { MetadataRoute } from "next";

/**
 * Web app manifest → /manifest.webmanifest (Next links it from every page).
 * Colors are the design tokens in src/app/globals.css. Icons come from scripts/gen-icons.ts.
 */
const MANIFEST = {
  id: "/app/today",
  name: "Dilly",
  short_name: "Dilly",
  description: "Business development for commercial roofing reps.",
  start_url: "/app/today",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#F5F6F3",
  theme_color: "#F5F6F3",
  categories: ["business", "productivity"],
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
} satisfies MetadataRoute.Manifest;

export default function manifest(): MetadataRoute.Manifest {
  return MANIFEST;
}
