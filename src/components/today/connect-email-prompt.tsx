import Link from "next/link";
import { cookies } from "next/headers";
import { ctx } from "@/lib/server/ctx";
import { safe } from "@/lib/server/safe";
import { loadMyMailConnection } from "@/lib/mail/view";
import { MAIL_PROMPT_COOKIE } from "@/lib/mail/prompt-cookie";
import { DismissMailPrompt } from "./dismiss-mail-prompt";

/**
 * Today: "Connect your email" for anyone without a Gmail connection (dismissible, like V2), and a
 * non-dismissible "Reconnect Gmail" banner when Google removed access. Renders nothing when email sync
 * isn't configured, and never breaks the page.
 */
export async function ConnectEmailPrompt() {
  const c = await ctx();
  const { configured, conn } = await safe(() => loadMyMailConnection(c), { configured: false, conn: null }, "today:mail-prompt", { tenant: c.tenantId });
  if (!configured || conn?.status === "active") return null;

  if (conn?.status === "error") {
    return (
      <div role="alert" className="mx-4 mt-4 flex items-center gap-3 rounded-lg border-2 border-danger bg-surface px-4 py-3">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold text-danger">{conn.last_error ?? "Reconnect Gmail — Google access was removed"}</span>
          <span className="block text-muted">Emails with your contacts aren&apos;t logging until you do.</span>
        </p>
        <Link href="/app/settings#email" className="label shrink-0 text-sm text-accent underline-offset-4 hover:underline">
          Reconnect
        </Link>
      </div>
    );
  }

  if ((await cookies()).get(MAIL_PROMPT_COOKIE)?.value === "1") return null;
  return (
    <DismissMailPrompt>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Connect your email</span>
        <span className="block text-muted">Emails with your contacts log themselves, and replies show up here as follow-ups.</span>
      </p>
      <Link href="/app/settings#email" className="label shrink-0 text-sm text-accent underline-offset-4 hover:underline">
        Connect
      </Link>
    </DismissMailPrompt>
  );
}
