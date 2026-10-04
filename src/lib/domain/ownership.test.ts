import { describe, expect, it } from "vitest";
import { oppsThatMove, portfolioSummary, staysWithBuilding, tenureLabel, transferSummary, type OppForTransfer } from "@/lib/domain/ownership";

describe("staysWithBuilding", () => {
  it("puts on-site staff with the building", () => {
    expect(staysWithBuilding("Maintenance Supervisor, Riverside", "user")).toBe(true);
    expect(staysWithBuilding("Community Manager", "evaluator")).toBe(true);
    expect(staysWithBuilding("Leasing Office", "gatekeeper")).toBe(true);
    expect(staysWithBuilding("Chief Engineer", "evaluator")).toBe(true);
    expect(staysWithBuilding("Property Manager", null)).toBe(true);
  });
  it("keeps regional and corporate people with their company", () => {
    expect(staysWithBuilding("Regional Facilities Director", "economic_buyer")).toBe(false);
    expect(staysWithBuilding("Regional Property Manager", "evaluator")).toBe(false);
    expect(staysWithBuilding("VP Asset Management", "economic_buyer")).toBe(false);
    expect(staysWithBuilding("Director of Maintenance", "user")).toBe(false);
  });
  it("falls back on persona role when the title says nothing", () => {
    expect(staysWithBuilding(null, "economic_buyer")).toBe(false);
    expect(staysWithBuilding("", "gatekeeper")).toBe(true);
    expect(staysWithBuilding(null, null)).toBe(true);
  });
});

const opp = (id: string, account_id: string | null, stage = "proposal_sent", value = 160000, service_line = "re_roof"): OppForTransfer => ({
  id,
  account_id,
  stage,
  value_estimate: value,
  service_line,
});

describe("oppsThatMove", () => {
  const opps = [opp("open", "grey"), opp("won", "grey", "won"), opp("gc", "gc-co"), opp("nobody", null)];
  it("open jobs follow a management change", () => {
    expect(oppsThatMove({ role: "manager", accountId: "grey", currentManagerId: "grey", newAccountId: "rpm", opps }).map((o) => o.id)).toEqual(["open", "nobody"]);
  });
  it("an owner change on a managed building moves nothing", () => {
    expect(oppsThatMove({ role: "owner", accountId: "grey", currentManagerId: "grey", newAccountId: "bx", opps })).toEqual([]);
  });
  it("an owner change on an owner-run building moves open jobs", () => {
    expect(oppsThatMove({ role: "owner", accountId: "acme", currentManagerId: null, newAccountId: "bx", opps: [opp("o", "acme")] })).toHaveLength(1);
  });
  it("asset manager and tenant changes never move jobs", () => {
    expect(oppsThatMove({ role: "asset_manager", accountId: "grey", currentManagerId: "grey", newAccountId: "x", opps })).toEqual([]);
  });
});

describe("transferSummary", () => {
  it("states plainly what will happen", () => {
    expect(
      transferSummary({
        propertyName: "Riverside",
        role: "manager",
        newName: "RPM Living",
        oldName: "Greystar",
        withBuilding: 3,
        withOldCompany: 1,
        movingOpps: [opp("o", "grey")],
        touches: 41,
      }),
    ).toEqual([
      "Riverside moves to RPM Living.",
      "3 contacts move with the building, 1 stays with Greystar.",
      "Open $160K re-roof moves to RPM Living.",
      "All 41 touches and roof data stay on the property.",
    ]);
  });
  it("owner change on a managed building says the jobs stay", () => {
    expect(
      transferSummary({
        propertyName: "Riverside",
        role: "owner",
        newName: "Blackstone",
        oldName: null,
        withBuilding: 0,
        withOldCompany: 0,
        movingOpps: [],
        stayingOppCount: 1,
        buyerName: "Greystar",
        touches: 1,
      }),
    ).toEqual(["Riverside's owner becomes Blackstone.", "Open jobs stay with Greystar — they buy the roofing here.", "The touch logged here and roof data stay on the property."]);
  });
  it("sums several jobs", () => {
    const l = transferSummary({ propertyName: "R", role: "manager", newName: "N", oldName: "O", withBuilding: 1, withOldCompany: 2, movingOpps: [opp("a", "O", "lead", 20000, "repair"), opp("b", "O", "lead", 4000)], touches: 0 });
    expect(l).toEqual(["R moves to N.", "1 contact moves with the building, 2 stay with O.", "2 open jobs ($24K) move to N.", "Roof data and history stay on the property."]);
  });
});

describe("portfolioSummary + tenureLabel", () => {
  it("summarizes a bulk move", () => {
    expect(portfolioSummary({ count: 3, role: "manager", newName: "RPM Living", oldName: "Greystar", withBuilding: 2, withOldCompany: 1 })[0]).toBe("3 properties move to RPM Living.");
  });
  it("labels tenures", () => {
    expect(tenureLabel(null, null)).toBe("On record");
    expect(tenureLabel("2024-03-02", "2026-10-01")).toBe("Mar 2024 – Oct 2026");
    expect(tenureLabel("2026-10-01", null)).toBe("Since Oct 2026");
    expect(tenureLabel(null, "2026-10-01")).toBe("Until Oct 2026");
  });
});
