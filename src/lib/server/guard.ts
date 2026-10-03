import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "@/lib/session";

/** Team screens are for owner/admin/manager; reps land on their own stats instead. */
export function requireManager(s: Session) {
  if (!s.isManager) redirect("/app/me");
}
