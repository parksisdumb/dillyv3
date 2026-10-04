"use server";
import { z } from "zod";
import { ctx } from "@/lib/server/ctx";
import { storageFor } from "@/lib/storage";
import { pathInTenants } from "@/lib/storage/paths";
import { scanCard, CARD_MESSAGES } from "@/agents/card-scan";
import { normalizeCompany, cardNotes, type CardFields } from "@/lib/cards/card";
import type { PickOption } from "@/lib/actions/book";
import { log } from "@/lib/observability/log";
import { requestInfo } from "@/lib/observability/request";

export type CardScanResponse =
  | { ok: true; fields: CardFields; notes: string | null; account: PickOption | null; company: string | null }
  | { ok: false; message: string; reason: "not_configured" | "unreadable" | "failed" | "bad_image" };

/**
 * Read an uploaded card photo (already in storage via /api/media) with Claude vision and match the company to an
 * account. Pre-fills the add-contact form; the rep confirms. Never throws.
 */
export async function scanBusinessCard(input: { path: string }): Promise<CardScanResponse> {
  const started = Date.now();
  try {
    const path = z.string().max(200).parse(input?.path);
    const { sb, s, tenantId } = await ctx();
    if (!pathInTenants(path, [tenantId])) return { ok: false, reason: "bad_image", message: "That card photo isn't in this company. Take it again." };
    const file = await storageFor(sb).get(path);
    if (!file) return { ok: false, reason: "bad_image", message: "The card photo didn't upload. Take it again, or type it in." };

    const r = await scanCard({ tenantId, userId: s.userId, image: { data: Buffer.from(file.bytes).toString("base64"), mediaType: "image/jpeg" } });
    log.info("card-scan", { ...(await requestInfo()), tenant: tenantId, user: s.userId, ok: r.ok, reason: r.ok ? null : r.reason, runId: r.runId, durationMs: Date.now() - started });
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message };

    // Company → an existing account by normalized name (same rule as app.normalize_name), else offered as new.
    let account: PickOption | null = null;
    const norm = normalizeCompany(r.fields.company);
    if (norm) {
      const { data } = await sb
        .from("account")
        .select("id,name,city,icp_tier")
        .eq("tenant_id", tenantId)
        .is("duplicate_of", null)
        .eq("normalized_name", norm)
        .order("icp_tier")
        .limit(1);
      const a = data?.[0];
      if (a) account = { id: a.id, label: a.name, sub: [`P${a.icp_tier}`, a.city].filter(Boolean).join(" · ") };
    }
    return { ok: true, fields: r.fields, notes: cardNotes(r.fields), account, company: r.fields.company };
  } catch (err) {
    log.warn("card-scan:action-failed", { ...(await requestInfo()), durationMs: Date.now() - started, err });
    return { ok: false, reason: "failed", message: CARD_MESSAGES.failed };
  }
}
