"use client";
import { useSearchParams } from "next/navigation";

const MESSAGES: Record<string, { tone: "good" | "bad"; text: string }> = {
  connected: { tone: "good", text: "Gmail connected. Your last 30 days of email with your contacts is syncing now." },
  denied: { tone: "bad", text: "Gmail wasn't connected — Google access was declined." },
  scope: { tone: "bad", text: "Gmail wasn't connected: tick “View your email message metadata” on Google's screen and try again." },
  expired: { tone: "bad", text: "That sign-in link expired. Tap Continue with Google again." },
  error: { tone: "bad", text: "Couldn't connect Gmail. Try again in a minute." },
  not_configured: { tone: "bad", text: "Email sync isn't configured yet." },
};

/** One-line result of the Google round trip (?mail=… on /app/settings). */
export function MailNotice() {
  const key = useSearchParams().get("mail");
  const m = key ? MESSAGES[key] : undefined;
  if (!m) return null;
  return (
    <p
      role={m.tone === "bad" ? "alert" : "status"}
      className={m.tone === "bad" ? "mb-3 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger" : "mb-3 rounded-lg bg-success/12 px-3 py-2 text-sm text-success"}
    >
      {m.text}
    </p>
  );
}
