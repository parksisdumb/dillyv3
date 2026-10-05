import Link from "next/link";
import { CHANNELS, OUTCOMES, type Channel, type Outcome } from "@/lib/domain/vocab";
import { agoLabel } from "@/lib/format";
import { cn } from "@/components/ui/styles";

export type TimelineTouch = {
  id: string;
  occurred_at: string;
  channel: string;
  outcome: string;
  notes: string | null;
  who: string | null;
  contact: string | null;
  contact_id?: string | null;
  account?: string | null;
  account_id?: string | null;
  voided?: boolean;
  /** Entered more than an hour after it happened: when it happened and when it was logged (company zone). */
  logged_later?: { when: string; logged: string } | null;
};

const toneClass: Record<string, string> = {
  great: "text-accent",
  good: "text-success",
  neutral: "text-muted",
  bad: "text-danger",
};

/** Touch ledger, newest first. */
export function TouchTimeline({ touches, showAccount = false }: { touches: TimelineTouch[]; showAccount?: boolean }) {
  return (
    <ol className="divide-y divide-line border-y border-line bg-surface">
      {touches.map((t) => {
        const o = OUTCOMES[t.outcome as Outcome];
        return (
          <li key={t.id} className={cn("px-4 py-3", t.voided && "opacity-50 line-through")}>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">{CHANNELS[t.channel as Channel]?.label ?? t.channel}</span>
              <span className={cn("label text-xs", toneClass[o?.tone ?? "neutral"])}>{o?.label ?? t.outcome}</span>
              {t.logged_later && (
                <span
                  className="label shrink-0 rounded-full border border-warning px-2 py-0.5 text-[11px] text-ink"
                  title={`Logged ${t.logged_later.logged}`}
                  data-testid="logged-later"
                >
                  Logged later
                </span>
              )}
              <span className="flex-1" />
              <time className="num shrink-0 text-xs text-muted" dateTime={t.occurred_at} title={new Date(t.occurred_at).toLocaleString()}>
                {t.logged_later ? t.logged_later.when : agoLabel(t.occurred_at)}
              </time>
            </div>
            {t.logged_later && <div className="text-xs text-muted">Logged {t.logged_later.logged}</div>}
            <div className="mt-0.5 text-sm text-muted">
              {t.who ?? "System"}
              {t.contact && (
                <>
                  {" → "}
                  {t.contact_id ? (
                    <Link className="underline decoration-line underline-offset-2" href={`/app/contacts/${t.contact_id}`}>
                      {t.contact}
                    </Link>
                  ) : (
                    t.contact
                  )}
                </>
              )}
              {showAccount && t.account && (
                <>
                  {" · "}
                  {t.account_id ? (
                    <Link className="underline decoration-line underline-offset-2" href={`/app/accounts/${t.account_id}`}>
                      {t.account}
                    </Link>
                  ) : (
                    t.account
                  )}
                </>
              )}
            </div>
            {t.notes && <p className="mt-1 whitespace-pre-line text-base">{t.notes}</p>}
          </li>
        );
      })}
    </ol>
  );
}
