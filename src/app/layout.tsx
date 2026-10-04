import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Semi_Condensed } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import { ClientErrorReporter } from "@/components/observability/client-errors";
import { EARLY_ERROR_SCRIPT } from "@/lib/observability/client-error";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const barlowSemi = Barlow_Semi_Condensed({
  variable: "--font-barlow-semi",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Dilly", template: "%s · Dilly" },
  description: "Business development for commercial roofing reps.",
  applicationName: "Dilly",
  // iOS: installed to the home screen, Dilly opens full screen (and can receive web push, iOS 16.4+).
  appleWebApp: { capable: true, title: "Dilly", statusBarStyle: "default" },
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  // Next emits only `mobile-web-app-capable`; older iOS Safari still reads the apple- prefixed one.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F6F3" },
    { media: "(prefers-color-scheme: dark)", color: "#0F151B" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Buffers errors thrown before hydration; ClientErrorReporter reports them once it installs. */}
        <script dangerouslySetInnerHTML={{ __html: EARLY_ERROR_SCRIPT }} />
      </head>
      <body className={`${barlow.variable} ${barlowSemi.variable} bg-ground text-ink antialiased`}>
        {children}
        <ServiceWorkerRegister />
        <ClientErrorReporter release={(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_RELEASE ?? "dev").slice(0, 12)} />
      </body>
    </html>
  );
}
