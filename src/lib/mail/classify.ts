/**
 * Pure mail logic: header parsing, message classification, counterpart matching and the touch rows the sync
 * writes. No I/O — unit-tested in classify.test.ts.
 */
import type { MailMessage } from "./provider";

/** Headers requested from Gmail (format=metadata). Nothing else is ever read. */
export const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "Message-ID",
  "In-Reply-To",
  "Auto-Submitted",
  "X-Autoreply",
  "X-Autorespond",
  "Precedence",
  "X-Failed-Recipients",
] as const;

// ---------------------------------------------------------------------------------------------------------------
// Addresses

const EMAIL_RE = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/;
const EMAIL_RE_G = new RegExp(EMAIL_RE.source, "g");

export function normalizeEmail(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

/**
 * RFC 5322 address list → lower-cased addresses. Handles display names with commas inside quotes
 * ("Smith, Ann" <ann@x.com>), angle addresses, bare addresses, comments and group syntax (undisclosed-recipients:;).
 */
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  const parts: string[] = [];
  let cur = "";
  let inQuote = false;
  let angle = 0;
  let paren = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && inQuote) {
      cur += ch + (value[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"' && paren === 0) inQuote = !inQuote;
    else if (!inQuote) {
      if (ch === "(") paren++;
      else if (ch === ")" && paren > 0) paren--;
      else if (ch === "<" && paren === 0) angle++;
      else if (ch === ">" && angle > 0) angle--;
      else if ((ch === "," || ch === ";") && angle === 0 && paren === 0) {
        parts.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  parts.push(cur);
  const out: string[] = [];
  for (const p of parts) {
    const angled = p.match(/<([^<>]*)>/);
    const addr = normalizeEmail(angled ? angled[1] : p.replace(/"(?:[^"\\]|\\.)*"/g, "").replace(/\([^)]*\)/g, ""));
    if (addr && !out.includes(addr)) out.push(addr);
  }
  return out;
}

/** Every address that appears anywhere in a string (bounce subjects, X-Failed-Recipients). */
export function findAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...new Set((value.match(EMAIL_RE_G) ?? []).map((a) => a.toLowerCase()))];
}

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** Consumer mailbox domains: never treated as "our company" even if a rep signs in with one. */
export const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "att.net",
  "sbcglobal.net",
  "comcast.net",
  "bellsouth.net",
  "verizon.net",
]);

/** Company domains of the tenant's users (e.g. foxroofing.co). Mail among colleagues is never a touch. */
export function internalDomains(userEmails: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const e of userEmails) {
    const n = normalizeEmail(e);
    if (!n) continue;
    const d = domainOf(n);
    if (!FREEMAIL.has(d)) out.add(d);
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------------------------------
// Header decoding

/** Decode RFC 2047 encoded-words (=?UTF-8?B?...?= / =?UTF-8?Q?...?=) in a header value. */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?") // whitespace between adjacent encoded-words is dropped
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, enc: string, text: string) => {
      try {
        const bytes =
          enc.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
                "latin1",
              );
        const cs = charset.toLowerCase().split("*")[0];
        return new TextDecoder(cs === "utf8" ? "utf-8" : cs).decode(bytes);
      } catch {
        return whole;
      }
    });
}

export function cleanSubject(raw: string | null | undefined): string {
  const s = decodeMimeWords(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s ? s.slice(0, 300) : "(no subject)";
}

// ---------------------------------------------------------------------------------------------------------------
// Classification

export type MailKind = "sent" | "reply" | "auto_reply" | "bounce" | "ignore";

/** Labels that are never business correspondence. */
const IGNORED_LABELS = new Set(["DRAFT", "SPAM", "TRASH", "CHAT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"]);

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const BOUNCE_SUBJECT =
  /^(undeliverable|undelivered mail returned to sender|delivery status notification \((failure|delay)\)|mail delivery failed|returned mail|failure notice|delivery failure|message not delivered|address not found|non-delivery report)/i;
const AUTO_SUBJECT =
  /^(automatic reply|auto(?:matic)?[- ]?(?:reply|response)|out of (?:the )?office|ooo\b|away from (?:the )?office|on vacation|vacation reply|i am out of the office|i'm out of the office|abwesenheitsnotiz|respuesta autom[aá]tica|r[ée]ponse automatique)/i;

export function isFrom(m: MailMessage, address: string): boolean {
  return parseAddressList(m.headers["from"])[0] === address.toLowerCase();
}

/**
 * sent       — the user sent it (SENT label, or From is the user)
 * bounce     — a delivery failure notice (mailer-daemon/postmaster, or a bounce subject)
 * auto_reply — out-of-office / autoresponder (Auto-Submitted ≠ no, X-Autoreply, Precedence: auto_reply, OOO subjects)
 * reply      — any other mail received from a human
 * ignore     — drafts, spam, trash, chats, Promotions/Social tabs
 */
export function classify(m: MailMessage, userEmail: string): MailKind {
  if (m.labels.some((l) => IGNORED_LABELS.has(l))) return "ignore";
  const from = parseAddressList(m.headers["from"])[0] ?? "";
  if (m.labels.includes("SENT") || (from && from === userEmail.toLowerCase())) return "sent";
  const subject = cleanSubject(m.headers["subject"]);
  if (BOUNCE_SENDER.test(from) || (BOUNCE_SUBJECT.test(subject) && (!!m.headers["x-failed-recipients"] || /daemon|postmaster|mail delivery/i.test(m.headers["from"] ?? "")))) {
    return "bounce";
  }
  const autoSubmitted = (m.headers["auto-submitted"] ?? "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "auto_reply";
  if (m.headers["x-autoreply"] !== undefined || m.headers["x-autorespond"] !== undefined) return "auto_reply";
  if (/^auto[_-]reply$/i.test((m.headers["precedence"] ?? "").trim())) return "auto_reply";
  if (AUTO_SUBJECT.test(subject)) return "auto_reply";
  return "reply";
}

/**
 * The outside addresses this message is "with":
 *   sent → To + Cc;  reply / auto_reply → From;  bounce → the failed recipient(s).
 * The user's own address and colleagues (same company domain) are dropped.
 */
export function counterparts(m: MailMessage, kind: MailKind, userEmail: string, internal: string[]): string[] {
  let addrs: string[];
  switch (kind) {
    case "sent":
      addrs = [...parseAddressList(m.headers["to"]), ...parseAddressList(m.headers["cc"])];
      break;
    case "reply":
    case "auto_reply":
      addrs = parseAddressList(m.headers["from"]).slice(0, 1);
      break;
    case "bounce": {
      const failed = findAddresses(m.headers["x-failed-recipients"]);
      addrs = failed.length ? failed : findAddresses(cleanSubject(m.headers["subject"]));
      break;
    }
    default:
      addrs = [];
  }
  const me = userEmail.toLowerCase();
  const own = new Set(internal.map((d) => d.toLowerCase()));
  return [...new Set(addrs)].filter((a) => a !== me && !own.has(domainOf(a)) && !BOUNCE_SENDER.test(a));
}

// ---------------------------------------------------------------------------------------------------------------
// Touch rows

export type ContactMatch = { id: string; email: string };

export type TouchRow = {
  external_id: string;
  provider_message_id: string;
  contact_id: string;
  occurred_at: string;
  direction: "outbound" | "inbound";
  outcome: "sent" | "replied" | "auto_reply" | "bounced";
  notes: string;
  skip_follow_up: boolean;
};

const OUTCOME: Record<Exclude<MailKind, "ignore">, TouchRow["outcome"]> = {
  sent: "sent",
  reply: "replied",
  auto_reply: "auto_reply",
  bounce: "bounced",
};

/**
 * Dedupe key for touch.external_id (unique per tenant + source): the provider message id, or
 * '<message id>:<contact id>' when one message matches several contacts.
 */
export function dedupeKey(messageId: string, contactId: string, matchedContacts: number): string {
  return matchedContacts > 1 ? `${messageId}:${contactId}` : messageId;
}

export type BuildStats = { messages: number; ignored: number; unknown: number; matched: number; byKind: Record<string, number> };

/**
 * Turn classified messages into touch rows (one per matched contact per message).
 * - Only contacts already in the tenant are logged; unknown senders are counted, never stored.
 * - Within a batch only the newest message per contact schedules a follow-up; the trigger would close the
 *   earlier ones immediately anyway.
 * - Mail older than `followUpCutoff` (first-sync backfill) is logged without scheduling a task.
 */
export function buildTouchRows(
  messages: MailMessage[],
  opts: { userEmail: string; internal: string[]; contactsByEmail: Map<string, ContactMatch[]>; followUpCutoff: number },
): { rows: TouchRow[]; stats: BuildStats } {
  const stats: BuildStats = { messages: messages.length, ignored: 0, unknown: 0, matched: 0, byKind: {} };
  const rows: TouchRow[] = [];
  for (const m of messages) {
    const kind = classify(m, opts.userEmail);
    if (kind === "ignore") {
      stats.ignored++;
      continue;
    }
    const addrs = counterparts(m, kind, opts.userEmail, opts.internal);
    const contacts = new Map<string, ContactMatch>();
    for (const a of addrs) for (const c of opts.contactsByEmail.get(a) ?? []) contacts.set(c.id, c);
    if (contacts.size === 0) {
      stats.unknown++;
      continue;
    }
    stats.matched++;
    stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
    for (const c of contacts.values()) {
      rows.push({
        external_id: dedupeKey(m.id, c.id, contacts.size),
        provider_message_id: m.id,
        contact_id: c.id,
        occurred_at: new Date(m.internalDate).toISOString(),
        direction: kind === "sent" ? "outbound" : "inbound",
        outcome: OUTCOME[kind],
        notes: cleanSubject(m.headers["subject"]),
        skip_follow_up: m.internalDate < opts.followUpCutoff,
      });
    }
  }
  // Newest per contact keeps its follow-up; older ones in the same batch skip it.
  const newest = new Map<string, string>();
  for (const r of rows) {
    const cur = newest.get(r.contact_id);
    if (!cur || cur < r.occurred_at) newest.set(r.contact_id, r.occurred_at);
  }
  for (const r of rows) if (newest.get(r.contact_id) !== r.occurred_at) r.skip_follow_up = true;
  rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.external_id.localeCompare(b.external_id));
  return { rows, stats };
}

/** All addresses worth looking up in the contact table for a batch. */
export function lookupAddresses(messages: MailMessage[], userEmail: string, internal: string[]): string[] {
  const out = new Set<string>();
  for (const m of messages) {
    const kind = classify(m, userEmail);
    if (kind === "ignore") continue;
    for (const a of counterparts(m, kind, userEmail, internal)) out.add(a);
  }
  return [...out];
}
