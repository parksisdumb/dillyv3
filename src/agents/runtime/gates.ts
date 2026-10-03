/**
 * Approval gates (§6). Anything that leaves the building passes a gate until that gate's trust score
 * earns auto-approve. Trust scores are maintained by the Evaluator / the approval_decided trigger.
 */
import { must, mustRow, toJson, type Db } from "./db";

export type Gate = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8" | "G9";

/** Gates that never auto-approve in v1 regardless of trust score (§6, Evaluator guardrails). */
export const NEVER_AUTO_APPROVE: ReadonlySet<Gate> = new Set<Gate>(["G2", "G3", "G4", "G9"]);

export interface ApprovalRequest {
  tenantId: string;
  gate: Gate;
  runId: string | null;
  actionType: string;
  summary: string;
  payload: Record<string, unknown>;
  expiresAt?: string | null;
}

/** Insert a pending approval row; returns its id. The UI queue reads public.approval. */
export async function requestApproval(db: Db, req: ApprovalRequest): Promise<string> {
  const row = mustRow(
    await db
      .from("approval")
      .insert({
        tenant_id: req.tenantId,
        gate: req.gate,
        agent_run_id: req.runId,
        action_type: req.actionType,
        summary: req.summary,
        payload: toJson(req.payload),
        status: "pending",
        expires_at: req.expiresAt ?? null,
      })
      .select("id")
      .single(),
    "insert approval",
  );
  return row.id;
}

/** Reads trust_score.auto_approve for (tenant, agent, gate, step). Never true for G2/G3/G4/G9. */
export async function isAutoApproved(
  db: Db,
  tenantId: string,
  agentKey: string,
  gate: Gate,
  stepKey = "*",
): Promise<boolean> {
  if (NEVER_AUTO_APPROVE.has(gate)) return false;
  const row = must(
    await db
      .from("trust_score")
      .select("auto_approve")
      .eq("tenant_id", tenantId)
      .eq("agent_key", agentKey)
      .eq("gate", gate)
      .eq("step_key", stepKey)
      .maybeSingle(),
    "read trust_score",
  );
  return row?.auto_approve ?? false;
}

/**
 * G1 EXCEPTION HOOK (§6): Speed-to-Lead first responses to inbound replies auto-approve from day one
 * on approved templates — the 5-minute SLA is impossible otherwise. Everything else earns it.
 *
 * Not wired further in v1: the Speed-to-Lead agent does not exist yet. When it does, call this before
 * `requestApproval` for G1 actions; `true` means execute through the Sending Governor and record an
 * `auto_approved` approval row for the audit trail.
 */
export interface G1ExceptionInput {
  agentKey: string;
  isFirstResponseToInbound: boolean;
  templateApproved: boolean;
}

export function g1SpeedToLeadException(input: G1ExceptionInput): boolean {
  return input.agentKey === "speed-to-lead" && input.isFirstResponseToInbound && input.templateApproved;
}
