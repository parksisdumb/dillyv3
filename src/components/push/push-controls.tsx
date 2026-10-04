"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removePushSubscriptionByEndpoint, savePushSubscription, sendTestPush } from "@/lib/push/actions";
import { btn } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { IDLE } from "@/lib/actions/state";

/**
 * This-device push controls. States:
 *   checking     first client render (nothing is known on the server)
 *   unsupported  no Push API here (iPhone Safari outside the home-screen app, old browsers)
 *   no-server    VAPID keys aren't configured
 *   denied       the rep (or the OS) blocked notifications → how to undo it
 *   off          not subscribed: explanation first, then the OS prompt
 *   on           subscribed and saved
 */
export type PushState = "checking" | "unsupported" | "no-server" | "denied" | "off" | "on";

function isIos(ua: string) {
  return /iPhone|iPad|iPod/.test(ua);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export function PushControls({ vapidPublicKey, activeDevices, endpointTails }: { vapidPublicKey: string | null; activeDevices: number; endpointTails: string[] }) {
  const [state, setState] = useState<PushState>("checking");
  const [ios, setIos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const detect = useCallback(async () => {
    setIos(isIos(navigator.userAgent));
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return setState("unsupported");
    if (!vapidPublicKey) return setState("no-server");
    if (Notification.permission === "denied") return setState("denied");
    if (Notification.permission !== "granted") return setState("off");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      const known = !!sub && endpointTails.some((t) => sub.endpoint.endsWith(t));
      setState(known ? "on" : "off");
    } catch {
      setState("off");
    }
  }, [vapidPublicKey, endpointTails]);

  useEffect(() => {
    void detect();
  }, [detect]);

  const enable = () =>
    start(async () => {
      setError(null);
      try {
        // Ask the OS only after the rep tapped the button that the explanation sits above.
        const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (perm !== "granted") {
          setState(perm === "denied" ? "denied" : "off");
          return;
        }
        const reg = await registration();
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) }));
        const r = await savePushSubscription(sub.toJSON(), navigator.userAgent);
        if (!r.ok) {
          setError(r.error ?? "Couldn't turn on reminders.");
          return;
        }
        setState("on");
        toast(r.message ?? "Reminders on");
        router.refresh();
      } catch {
        setError("Couldn't turn on reminders on this phone. Check your signal and try again.");
      }
    });

  const disable = () =>
    start(async () => {
      setError(null);
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) {
          const r = await removePushSubscriptionByEndpoint(sub.endpoint);
          if (!r.ok) {
            setError(r.error ?? "Couldn't turn off reminders.");
            return;
          }
          await sub.unsubscribe().catch(() => undefined);
        }
        setState("off");
        toast("Reminders off for this phone");
        router.refresh();
      } catch {
        setError("Couldn't turn off reminders. Check your signal and try again.");
      }
    });

  const test = () =>
    start(async () => {
      setError(null);
      try {
        const r = await sendTestPush(IDLE);
        if (r.ok) toast(r.message ?? "Test sent");
        else setError(r.error ?? "Couldn't send the test.");
        router.refresh();
      } catch {
        setError("Couldn't send the test — can't reach the server.");
      }
    });

  return (
    <div className="flex flex-col gap-3" data-push-state={state}>
      {state === "checking" && <p className="text-sm text-muted">Checking this phone…</p>}

      {state === "unsupported" &&
        (ios ? (
          <div className="text-sm">
            <p className="font-semibold">To get reminders on iPhone, add Dilly to your Home Screen first.</p>
            <ol className="mt-1 list-decimal pl-5 text-muted">
              <li>In Safari, tap Share, then Add to Home Screen.</li>
              <li>Open Dilly from the new icon and come back here.</li>
            </ol>
            <p className="mt-1 text-muted">Needs iOS 16.4 or later (Settings → General → Software Update).</p>
          </div>
        ) : (
          <p className="text-sm text-muted">This browser can&apos;t receive notifications. Use Chrome on Android, or the home-screen app on iPhone.</p>
        ))}

      {state === "no-server" && <p className="text-sm text-muted">Phone reminders aren&apos;t switched on for your team yet. Your reminders still show on Today.</p>}

      {state === "denied" && (
        <div className="text-sm">
          <p className="font-semibold">Notifications are blocked for Dilly on this phone.</p>
          {ios ? (
            <p className="mt-1 text-muted">iPhone: Settings → Notifications → Dilly → turn on Allow Notifications. Then come back here.</p>
          ) : (
            <p className="mt-1 text-muted">
              Android: long-press the Dilly icon → App info → Notifications → allow. In Chrome: tap the icon left of the address → Permissions →
              Notifications → Allow. Then reload this page.
            </p>
          )}
        </div>
      )}

      {state === "off" && (
        <>
          <div className="text-sm">
            <p className="font-semibold">Get reminders on this phone</p>
            <p className="mt-1 text-muted">
              At most 3 a day, only in work hours: a P1 or big follow-up due today, overdue follow-ups, a reply on one of your accounts. Tap one to
              open that account. Your phone will ask to allow notifications next.
            </p>
          </div>
          <button type="button" onClick={enable} disabled={pending} className={btn("primary", "lg", "w-full")}>
            {pending ? "Turning on…" : "Turn on reminders"}
          </button>
        </>
      )}

      {state === "on" && (
        <>
          <p className="text-sm">
            <span className="font-semibold">Reminders are on for this phone.</span>
          </p>
          <button type="button" onClick={disable} disabled={pending} className={btn("secondary", "md", "w-full")}>
            Turn off on this phone
          </button>
        </>
      )}

      {vapidPublicKey && activeDevices > 0 && state !== "checking" && (
        <button type="button" onClick={test} disabled={pending} className={btn("secondary", "md", "w-full")}>
          Send test notification
        </button>
      )}

      {error && (
        <p role="alert" className="rounded-lg border-2 border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
