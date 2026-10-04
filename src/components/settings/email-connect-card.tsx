import { Suspense } from "react";
import { ctx } from "@/lib/server/ctx";
import { safe } from "@/lib/server/safe";
import { loadMyMailConnection } from "@/lib/mail/view";
import { disconnectMail, syncMailNow } from "@/lib/actions/mail";
import { agoLabel } from "@/lib/format";
import { ActionForm } from "@/components/ui/action-form";
import { Chip, SectionTitle } from "@/components/ui/bits";
import { GoogleButton } from "./google-button";
import { MailNotice } from "./mail-notice";

const START = "/api/mail/google/start";
const PRIVACY = "We read message metadata only (sender, recipient, subject, date) — never message bodies.";

/**
 * Settings → Email. Connect Gmail so emails to and from your contacts log automatically as touches and drive
 * follow-up nudges on Today. Hidden for reps when the server isn't configured; admins see why.
 */
export async function EmailConnectCard() {
  const c = await ctx();
  const { s } = c;
  const admin = s.isPlatformAdmin || s.tenant.role === "owner" || s.tenant.role === "admin";
  const { configured, conn } = await safe(() => loadMyMailConnection(c), { configured: false, conn: null }, "settings:mail", { tenant: c.tenantId });

  if (!configured) {
    if (!admin) return null;
    return (
      <section id="email" aria-labelledby="email-title">
        <SectionTitle>
          <span id="email-title">Email sync</span>
        </SectionTitle>
        <div className="border-y border-line bg-surface px-4 py-4 text-sm text-muted">
          <p className="font-semibold text-ink">Email sync isn&apos;t configured yet</p>
          <p className="mt-1">
            Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and MAIL_TOKEN_KEY to let reps connect Gmail (see the runbook, “Gmail sync”). Reps don&apos;t see this section until then.
          </p>
        </div>
      </section>
    );
  }

  const connected = conn?.status === "active";
  const broken = conn?.status === "error";

  return (
    <section id="email" aria-labelledby="email-title">
      <SectionTitle action={connected ? <Chip tone="good">Connected</Chip> : broken ? <Chip tone="bad">Needs attention</Chip> : undefined}>
        <span id="email-title">Email sync</span>
      </SectionTitle>
      <div className="border-y border-line bg-surface px-4 py-4">
        <Suspense fallback={null}>
          <MailNotice />
        </Suspense>

        {connected && conn ? (
          <>
            <p className="font-semibold">{conn.email}</p>
            <p className="text-sm text-muted">{conn.last_synced_at ? `Last synced ${agoLabel(conn.last_synced_at)}` : "First sync in progress…"}</p>
            <p className="mt-2 text-sm text-muted">Emails to and from your contacts log as touches automatically. {PRIVACY}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ActionForm action={syncMailNow} submitLabel="Sync now" submitVariant="secondary" submitSize="md" className="gap-0">
                {null}
              </ActionForm>
              <ActionForm
                action={disconnectMail}
                submitLabel="Disconnect"
                submitVariant="secondary"
                submitSize="md"
                className="gap-0"
                confirm="Disconnect Gmail? New emails stop logging. Touches already logged stay."
              >
                {null}
              </ActionForm>
            </div>
          </>
        ) : broken && conn ? (
          <>
            <p className="font-semibold">{conn.email}</p>
            <p role="alert" className="mt-1 text-sm text-danger">
              {conn.last_error ?? "Reconnect Gmail — Google access was removed"}
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <GoogleButton href={START} label="Reconnect with Google" />
              <ActionForm action={disconnectMail} submitLabel="Disconnect" submitVariant="secondary" submitSize="md" className="gap-0">
                {null}
              </ActionForm>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">Connect your Gmail so emails to and from your contacts log automatically as touchpoints, and you get follow-up nudges on Today.</p>
            <p className="mt-1 text-sm text-muted">{PRIVACY}</p>
            <div className="mt-4">
              <GoogleButton href={START} />
            </div>
            <p className="mt-3 text-xs text-muted">Outlook: coming soon.</p>
          </>
        )}
      </div>
    </section>
  );
}
