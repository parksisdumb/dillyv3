"use client";
import { useActionState, useState, startTransition } from "react";
import { signInWithPassword, sendMagicLink } from "@/lib/actions/auth";
import { IDLE } from "@/lib/actions/state";
import { btn, input, labelText } from "@/components/ui/styles";

export function LoginForms({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, IDLE);
  const [mlState, mlAction, mlPending] = useActionState(sendMagicLink, IDLE);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => pwAction(fd));
        }}
      >
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Email</span>
          <input
            className={input}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Password</span>
          <input className={input} type="password" name="password" autoComplete="current-password" />
        </label>
        {pwState.error && (
          <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
            {pwState.error}
          </p>
        )}
        <button type="submit" className={btn("primary", "lg", "w-full")} disabled={pwPending}>
          {pwPending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="flex items-center gap-3 text-muted">
        <span className="h-px flex-1 bg-line" />
        <span className="label text-xs">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData();
          fd.set("email", email);
          fd.set("next", next);
          startTransition(() => mlAction(fd));
        }}
      >
        <button type="submit" className={btn("secondary", "lg", "w-full")} disabled={mlPending}>
          {mlPending ? "Sending…" : "Email me a sign-in link"}
        </button>
        {mlState.error && (
          <p role="alert" className="mt-3 rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
            {mlState.error}
          </p>
        )}
        {mlState.ok && mlState.message && (
          <p role="status" className="mt-3 rounded-lg border-2 border-success px-3 py-2 text-sm text-success">
            {mlState.message}
          </p>
        )}
      </form>
    </div>
  );
}
