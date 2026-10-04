import { describe, expect, it } from "vitest";
import { propertyBadges, roofSystemLabel, serviceLineBadge, visibleBadges } from "@/lib/domain/badges-property";

const TODAY = "2026-10-04";
const keys = (b: { key: string }[]) => b.map((x) => x.key);

describe("roofSystemLabel", () => {
  it("normalizes free text to short labels", () => {
    expect(roofSystemLabel("tpo")).toBe("TPO");
    expect(roofSystemLabel("Modified Bitumen")).toBe("Mod-bit");
    expect(roofSystemLabel("mod_bit")).toBe("Mod-bit");
    expect(roofSystemLabel("Built-up gravel")).toBe("BUR");
    expect(roofSystemLabel("Standing seam metal")).toBe("Metal");
    expect(roofSystemLabel("Silicone coating")).toBe("Coating");
    expect(roofSystemLabel("Asphalt shingle")).toBe("Shingle");
    expect(roofSystemLabel("unknown")).toBeNull();
    expect(roofSystemLabel(null)).toBeNull();
    expect(roofSystemLabel("Green roof system")).toBe("Green roo…");
  });
});

describe("propertyBadges", () => {
  it("orders leak first, then open job type, storm, new management, roof + age, warranty", () => {
    const b = propertyBadges(
      {
        roof_system: "TPO",
        roof_install_year: 2009,
        warranty_expires_on: "2025-01-01",
        open_service_lines: ["re_roof"],
        active_flags: ["active_leak"],
        management_changed_on: "2026-09-20",
        storm_kind: "hail",
        storm_at: "2026-10-01T10:00:00Z",
      },
      TODAY,
    );
    expect(keys(b)).toEqual(["flag:active_leak", "opp:re_roof", "storm", "new_mgmt", "roof", "age", "warranty"]);
    expect(b[0]).toMatchObject({ label: "Leak", icon: "droplet", tone: "bad" });
    expect(b.find((x) => x.key === "new_mgmt")).toMatchObject({ label: "New mgmt", tone: "hot" });
    expect(b.find((x) => x.key === "age")).toMatchObject({ label: "17 yrs", tone: "warn" });
    expect(b.find((x) => x.key === "warranty")).toMatchObject({ label: "Warranty out" });
  });

  it("roof age turns amber at 15 and red at 20", () => {
    const age = (y: number) => propertyBadges({ roof_install_year: y }, TODAY).find((x) => x.key === "age")!.tone;
    expect(age(2014)).toBe("neutral");
    expect(age(2011)).toBe("warn");
    expect(age(2006)).toBe("bad");
  });

  it("warranty badge only when expired or ending within 12 months", () => {
    const w = (d: string) => propertyBadges({ warranty_expires_on: d }, TODAY).find((x) => x.key === "warranty")?.label;
    expect(w("2027-03-04")).toBe("Warranty 5mo");
    expect(w("2028-06-01")).toBeUndefined();
    expect(w("2026-10-01")).toBe("Warranty out");
  });

  it("an emergency job and a leak flag show one droplet; hail flag hides the hail storm badge", () => {
    const b = propertyBadges({ open_service_lines: ["emergency", "repair"], active_flags: ["active_leak", "hail_damage"], storm_kind: "hail_storm" }, TODAY);
    expect(keys(b)).toEqual(["flag:active_leak", "opp:repair", "flag:hail_damage", "roof"]);
    const e = propertyBadges({ open_service_lines: ["emergency"] }, TODAY);
    expect(e[0]).toMatchObject({ key: "opp:emergency", icon: "droplet", tone: "bad" });
  });

  it("management change counts for 90 days; storms for 30", () => {
    expect(keys(propertyBadges({ management_changed_on: "2026-07-01" }, TODAY))).not.toContain("new_mgmt");
    expect(keys(propertyBadges({ management_changed_on: "2026-07-10" }, TODAY))).toContain("new_mgmt");
    expect(keys(propertyBadges({ ownership_changed_on: "2026-10-04" }, TODAY))).toContain("new_owner");
    expect(keys(propertyBadges({ storm_kind: "storm", storm_at: "2026-08-01T00:00:00Z" }, TODAY))).not.toContain("storm");
    expect(propertyBadges({ storm_kind: "wind" }, TODAY).find((x) => x.key === "storm")).toMatchObject({ label: "Wind event", icon: "wind" });
  });

  it("unknown roof is a quiet neutral chip at the end; unknown flags are ignored", () => {
    const b = propertyBadges({ active_flags: ["sinkhole"], warranty_expires_on: "2026-12-01" }, TODAY);
    expect(keys(b)).toEqual(["warranty", "roof"]);
    expect(b[1]).toMatchObject({ label: "Roof unknown", tone: "neutral" });
  });

  it("visibleBadges caps rows at N with a +more count", () => {
    const b = propertyBadges({ roof_system: "EPDM", roof_install_year: 2000, open_service_lines: ["repair", "inspection"], active_flags: ["ponding"] }, TODAY);
    expect(visibleBadges(b, 3)).toEqual({ shown: b.slice(0, 3), more: 2 });
    expect(visibleBadges(b.slice(0, 2), 3).more).toBe(0);
  });

  it("service line badge for pipeline cards", () => {
    expect(serviceLineBadge("maintenance")).toMatchObject({ label: "Maintenance", icon: "calendar" });
    expect(serviceLineBadge("coating")).toMatchObject({ icon: "roller" });
    expect(serviceLineBadge("inspection")).toMatchObject({ icon: "clipboard" });
    expect(serviceLineBadge("mystery")).toMatchObject({ label: "Open job" });
    expect(serviceLineBadge(null)).toBeNull();
  });
});
