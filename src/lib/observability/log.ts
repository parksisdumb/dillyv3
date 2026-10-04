/**
 * Structured JSON logger. No dependencies; safe in Node, Edge (middleware) and the browser.
 *
 * One line per event on stdout/stderr, which Vercel's log drain (and `vercel logs`) indexes as JSON:
 *   {"ts":"…","level":"error","msg":"safe:leaderboard","requestId":"…","tenant":"…","user":"…","route":"/app/today",
 *    "durationMs":12,"err":{"name":"…","message":"…","stack":"…"}}
 *
 * Never log secrets, tokens, cookies or request bodies. Ids (tenant, user, record) are fine.
 *
 * Error reporting hook: call `setErrorReporter(fn)` once (e.g. from instrumentation.ts) to forward
 * error-level events to Sentry or similar.
 * TODO(sentry): when SENTRY_DSN is set, install @sentry/nextjs and register
 *   setErrorReporter((e) => Sentry.captureException(e.err ?? new Error(e.msg), { extra: e }))
 * — no dependency is added for launch.
 */

export type Level = "debug" | "info" | "warn" | "error";

export type LogFields = {
  requestId?: string | null;
  tenant?: string | null;
  user?: string | null;
  route?: string | null;
  durationMs?: number;
  err?: unknown;
  [key: string]: unknown;
};

export type LogEvent = Omit<LogFields, "err"> & {
  ts: string;
  level: Level;
  msg: string;
  err?: SerializedError;
};

export type SerializedError = { name: string; message: string; stack?: string; digest?: string; code?: string; cause?: string };

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): Level {
  const v = (typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined)?.toLowerCase();
  return v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";
}

export function serializeError(e: unknown): SerializedError | undefined {
  if (e == null) return undefined;
  if (e instanceof Error) {
    const x = e as Error & { digest?: string; code?: string; cause?: unknown };
    // Node's fetch hides the real reason ("ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT") in `cause`.
    const c = x.cause as { code?: unknown; message?: unknown } | string | undefined;
    const cause = c == null ? undefined : typeof c === "string" ? c : String(c.code ?? c.message ?? "");
    return {
      name: x.name,
      message: x.message,
      stack: x.stack?.split("\n").slice(0, 12).join("\n"),
      ...(x.digest ? { digest: x.digest } : {}),
      ...(x.code ? { code: String(x.code) } : {}),
      ...(cause ? { cause: cause.slice(0, 300) } : {}),
    };
  }
  if (typeof e === "object") {
    // Supabase / PostgREST errors are plain objects: { message, code, details, hint }.
    const o = e as { message?: unknown; code?: unknown; name?: unknown };
    return { name: String(o.name ?? "Error"), message: String(o.message ?? JSON.stringify(e)).slice(0, 2000), ...(o.code ? { code: String(o.code) } : {}) };
  }
  return { name: "Error", message: String(e).slice(0, 2000) };
}

type Reporter = (e: LogEvent & { error?: unknown }) => void;
let reporter: Reporter | null = null;

/** Install an error sink (Sentry, etc.). Called for every error-level event. */
export function setErrorReporter(fn: Reporter | null) {
  reporter = fn;
}

function emit(level: Level, msg: string, fields: LogFields = {}) {
  if (ORDER[level] < ORDER[minLevel()]) return;
  const { err, ...rest } = fields;
  const event: LogEvent = { ts: new Date().toISOString(), level, msg, ...rest };
  const se = serializeError(err);
  if (se) event.err = se;
  let line: string;
  try {
    line = JSON.stringify(event);
  } catch {
    line = JSON.stringify({ ts: event.ts, level, msg, note: "unserializable fields" });
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  if (level === "error" && reporter) {
    try {
      reporter({ ...event, error: err });
    } catch {
      // A broken reporter must never take down the request.
    }
  }
}

export const log = {
  debug: (msg: string, f?: LogFields) => emit("debug", msg, f),
  info: (msg: string, f?: LogFields) => emit("info", msg, f),
  warn: (msg: string, f?: LogFields) => emit("warn", msg, f),
  error: (msg: string, f?: LogFields) => emit("error", msg, f),
  /** A child logger with fixed fields (request id, tenant, route…). */
  with(base: LogFields) {
    return {
      debug: (msg: string, f?: LogFields) => emit("debug", msg, { ...base, ...f }),
      info: (msg: string, f?: LogFields) => emit("info", msg, { ...base, ...f }),
      warn: (msg: string, f?: LogFields) => emit("warn", msg, { ...base, ...f }),
      error: (msg: string, f?: LogFields) => emit("error", msg, { ...base, ...f }),
    };
  },
};

export const REQUEST_ID_HEADER = "x-request-id";

/** Short random id for requests and error references. */
export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** The 8-char reference a rep can read out to support ("ref 3f9a12bc"). */
export function shortRef(id: string | null | undefined): string {
  return (id ?? newId()).replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
}
