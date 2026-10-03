"use client";
import { useOptimistic, useTransition } from "react";
import { setOnboarding } from "@/lib/actions/accounts";
import { ONBOARDING, type OnboardingStatus } from "@/lib/domain/vocab";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/styles";
import { IconCheck } from "@/components/icons";

const STEPS = Object.keys(ONBOARDING) as OnboardingStatus[];
const SHORT: Record<OnboardingStatus, string> = {
  none: "None",
  initial_touch: "Touch",
  paperwork_started: "Start",
  paperwork_received: "Rec'd",
  paperwork_finished: "Done",
  compliant: "Vendor",
};

/** Vendor onboarding ladder. Tapping a step saves it; the database awards points for paperwork steps. */
export function OnboardingStepper({ accountId, status }: { accountId: string; status: string }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useOptimistic(status as OnboardingStatus);
  const idx = STEPS.indexOf(current);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label text-xs text-muted">Vendor onboarding</span>
        <span className="text-sm font-semibold">{ONBOARDING[current] ?? current}</span>
      </div>
      <ol className="mt-2 grid grid-cols-6 gap-1" aria-label="Onboarding steps">
        {STEPS.map((step, i) => {
          const done = i <= idx;
          return (
            <li key={step}>
              <button
                type="button"
                disabled={pending || step === current}
                aria-current={step === current ? "step" : undefined}
                aria-label={ONBOARDING[step]}
                onClick={() =>
                  start(async () => {
                    setCurrent(step);
                    const r = await setOnboarding(accountId, step);
                    toast(r.ok ? r.message ?? "Saved" : r.error ?? "Didn't save", r.ok ? "good" : "bad");
                  })
                }
                className="flex min-h-12 w-full flex-col items-center justify-center gap-1.5 py-1 disabled:cursor-default"
              >
                <span
                  className={cn(
                    "flex h-3 w-full items-center justify-center rounded-sm",
                    done ? "bg-success" : "bg-surface-2",
                    step === current && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
                  )}
                >
                  {done && i === idx && i === STEPS.length - 1 && <IconCheck size={10} className="text-white" />}
                </span>
                <span className={cn("label text-xs leading-tight", done ? "text-ink" : "text-muted")}>{SHORT[step]}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
