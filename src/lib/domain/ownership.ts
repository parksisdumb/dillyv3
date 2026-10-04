// Ownership & management changes — the pure rules the transfer sheet shows before it calls
// public.transfer_property (20261004001000_property_party.sql). Keep these in step with that function.
import { money, plural } from "@/lib/format";
import { SERVICE_LINES, type ServiceLine } from "@/lib/domain/vocab";

export const PARTY_ROLES = {
  owner: { label: "Owner", noun: "owner", change: "Change owner" },
  manager: { label: "Manager", noun: "management", change: "Change manager" },
  asset_manager: { label: "Asset manager", noun: "asset manager", change: "Change asset manager" },
  tenant_occupant: { label: "Tenant", noun: "tenant", change: "Change tenant" },
} as const;
export type PartyRole = keyof typeof PARTY_ROLES;
export function isPartyRole(x: string): x is PartyRole {
  return x in PARTY_ROLES;
}

// --- Who goes with the building -----------------------------------------------------------------------------
// On-site staff (community manager, maintenance, leasing) usually become employees of the new management
// company. Regional / corporate people stay with their company.
const CORPORATE = /\b(regional|region|corporate|vp|vice president|svp|evp|president|ceo|coo|cfo|chief (?!engineer)|director|asset manag|portfolio|national|divisional|district|area manager|owner|principal|partner|investor|acquisitions|head of)\b/i;
const SITE = /\b(on[\s-]?site|site|community|maintenance|maint|leasing|leasing agent|porter|make[\s-]?ready|groundskeeper|grounds|concierge|front desk|office manager|assistant manager|property manager|building manager|building engineer|chief engineer|engineer|superintendent|super|technician|tech|facilities tech|general manager)\b/i;

/** Default side for a contact in the transfer checklist. The rep can flip it. */
export function staysWithBuilding(title: string | null | undefined, personaRole: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  if (t) {
    if (CORPORATE.test(t)) return false;
    if (SITE.test(t)) return true;
  }
  switch (personaRole) {
    case "economic_buyer":
    case "evaluator":
    case "influencer":
      return false;
    default:
      return true; // user, gatekeeper, initiator, unknown — the people a rep meets at the building
  }
}

// --- What moves ------------------------------------------------------------------------------------------------
export type OppForTransfer = { id: string; account_id: string | null; stage: string; value_estimate: number | null; service_line: string | null };

/**
 * The building's buying party after the change: the manager, else the owner. Open opportunities move only when
 * that changes (mirrors transfer_property step 2).
 */
export function buyerAfter(args: { role: PartyRole; accountId: string | null; currentManagerId: string | null; newAccountId: string }): string | null {
  const { role, accountId, currentManagerId, newAccountId } = args;
  if (role === "manager") return newAccountId;
  if (role === "owner") return currentManagerId ?? newAccountId;
  return accountId;
}

export function oppsThatMove(args: {
  role: PartyRole;
  accountId: string | null; // property.account_id now
  currentManagerId: string | null;
  newAccountId: string;
  opps: OppForTransfer[];
}): OppForTransfer[] {
  const after = buyerAfter(args);
  if (!after || after === args.accountId) return [];
  return args.opps.filter((o) => o.stage !== "won" && o.stage !== "lost" && (o.account_id == null || o.account_id === args.accountId));
}

function jobNoun(o: OppForTransfer): string {
  const label = SERVICE_LINES[(o.service_line ?? "other") as ServiceLine] ?? "job";
  return o.service_line === "other" || !o.service_line ? "job" : label.toLowerCase().replace(" program", "").replace(" / leak", "");
}

/** The plain-language confirm text: what will happen when the rep taps Confirm. One sentence per line. */
export function transferSummary(args: {
  propertyName: string;
  role: PartyRole;
  newName: string;
  oldName: string | null;
  withBuilding: number;
  withOldCompany: number;
  movingOpps: OppForTransfer[];
  stayingOppCount?: number;
  touches: number;
  buyerName?: string | null; // who opportunities stay with when they don't move
}): string[] {
  const { propertyName, role, newName, oldName, withBuilding, withOldCompany, movingOpps, touches } = args;
  const lines: string[] = [];
  lines.push(
    role === "manager"
      ? `${propertyName} moves to ${newName}.`
      : `${propertyName}'s ${PARTY_ROLES[role].noun} becomes ${newName}${oldName ? ` (was ${oldName})` : ""}.`,
  );
  const people: string[] = [];
  if (withBuilding) people.push(`${plural(withBuilding, "contact")} ${withBuilding === 1 ? "moves" : "move"} with the building`);
  if (withOldCompany) people.push(`${withOldCompany} ${withOldCompany === 1 ? "stays" : "stay"} with ${oldName ?? "their company"}`);
  if (people.length) lines.push(`${people.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));
  if (movingOpps.length === 1) {
    const o = movingOpps[0];
    lines.push(`Open ${o.value_estimate ? `${money(o.value_estimate)} ` : ""}${jobNoun(o)} moves to ${newName}.`);
  } else if (movingOpps.length > 1) {
    const total = movingOpps.reduce((n, o) => n + (o.value_estimate ?? 0), 0);
    lines.push(`${movingOpps.length} open jobs${total ? ` (${money(total)})` : ""} move to ${newName}.`);
  } else if (args.stayingOppCount && args.buyerName) {
    lines.push(`Open jobs stay with ${args.buyerName} — they buy the roofing here.`);
  }
  lines.push(
    touches > 1
      ? `All ${touches} touches and roof data stay on the property.`
      : touches === 1
        ? "The touch logged here and roof data stay on the property."
        : "Roof data and history stay on the property.",
  );
  return lines;
}

/** Plain-language portfolio summary for a bulk move. */
export function portfolioSummary(args: { count: number; role: PartyRole; newName: string; oldName: string | null; withBuilding: number; withOldCompany: number }): string[] {
  const { count, role, newName, oldName, withBuilding, withOldCompany } = args;
  const lines = [
    role === "manager"
      ? `${plural(count, "property", "properties")} move${count === 1 ? "s" : ""} to ${newName}.`
      : `${newName} becomes the ${PARTY_ROLES[role].noun} of ${plural(count, "property", "properties")}.`,
  ];
  const people: string[] = [];
  if (withBuilding) people.push(`${plural(withBuilding, "on-site contact")} ${withBuilding === 1 ? "moves" : "move"} with the buildings`);
  if (withOldCompany) people.push(`${withOldCompany} ${withOldCompany === 1 ? "stays" : "stay"} with ${oldName ?? "their company"}`);
  if (people.length) lines.push(`${people.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));
  if (role === "manager") lines.push(`Open jobs on these buildings move to ${newName}. Touches, photos and roof data stay on each property.`);
  else lines.push("Touches, photos and roof data stay on each property.");
  return lines;
}

/** "Mar 2024 – Oct 2026", "Since Oct 2026", "Before Dilly" */
export function tenureLabel(startedOn: string | null, endedOn: string | null): string {
  const m = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  if (!startedOn && !endedOn) return "On record";
  if (!startedOn) return `Until ${m(endedOn!)}`;
  if (!endedOn) return `Since ${m(startedOn)}`;
  return `${m(startedOn)} – ${m(endedOn)}`;
}
