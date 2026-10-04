/**
 * Provider-neutral mailbox interface. Gmail (gmail.metadata) implements it today; Outlook is "coming soon" and
 * will implement the same surface with Microsoft Graph (Mail.ReadBasic: /me/messages?$select=from,toRecipients,
 * ccRecipients,subject,receivedDateTime,internetMessageHeaders… and /me/mailFolders/…/messages/delta for the cursor).
 *
 * Only metadata ever crosses this interface: headers we ask for by name, labels/folders and the timestamp.
 * There is deliberately no way to fetch a body.
 */

export type MailProviderId = "google" | "microsoft";

/** One message's metadata, normalized. Header names are lower-cased; repeated headers are joined with ", ". */
export type MailMessage = {
  id: string;
  threadId?: string;
  /** Milliseconds since epoch (Gmail internalDate / Graph receivedDateTime). */
  internalDate: number;
  /** Gmail label ids (SENT, INBOX, DRAFT, SPAM, CATEGORY_PROMOTIONS…). Graph: map folder → SENT/INBOX/DRAFT. */
  labels: string[];
  headers: Record<string, string>;
};

export type ListPage = { ids: string[]; nextPageToken?: string };
export type ChangesPage = { ids: string[]; nextPageToken?: string; cursor: string };

export interface MailClient {
  readonly provider: MailProviderId;
  /** The mailbox address and a cursor marking "now" (Gmail historyId). */
  profile(): Promise<{ email: string; cursor: string }>;
  /** Recent messages, newest first (no search query: the gmail.metadata scope does not allow `q`). */
  listRecent(pageToken?: string): Promise<ListPage>;
  /** Message ids added since `cursor`; "expired" when the cursor is too old and a re-list is needed. */
  changesSince(cursor: string, pageToken?: string): Promise<ChangesPage | "expired">;
  /** Metadata for these ids (bounded concurrency). Messages deleted in the meantime are left out. */
  getMetadata(ids: string[]): Promise<MailMessage[]>;
}

/** Google said the grant is gone (revoked, password change, admin block). The rep must reconnect. */
export class MailAuthRevokedError extends Error {
  constructor(message = "Reconnect Gmail — Google access was removed") {
    super(message);
    this.name = "MailAuthRevokedError";
  }
}

/** 429 / rate-limit 403: stop this run, keep progress, continue next tick. */
export class MailRateLimitedError extends Error {
  constructor(message = "rate limited") {
    super(message);
    this.name = "MailRateLimitedError";
  }
}

export class MailHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "MailHttpError";
  }
}

/** Human message stored on the connection and shown in Settings + the Today banner. */
export const RECONNECT_MESSAGE: Record<MailProviderId, string> = {
  google: "Reconnect Gmail — Google access was removed",
  microsoft: "Reconnect Outlook — Microsoft access was removed",
};
