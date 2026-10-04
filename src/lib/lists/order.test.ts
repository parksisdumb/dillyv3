import { describe, expect, it } from "vitest";
import { isStaleActive, orderWorkingList, WORKING_CAP } from "@/lib/lists/order";

const now = new Date("2026-10-05T15:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("working list ordering", () => {
  it("active pursuits first, stale ones leading (oldest touch first), then assigned-list items", () => {
    const out = orderWorkingList(
      [
        { propertyId: "fresh", startedAt: ago(40), lastTouchAt: ago(3) },
        { propertyId: "stale-30", startedAt: ago(60), lastTouchAt: ago(30) },
        { propertyId: "stale-never", startedAt: ago(25), lastTouchAt: null },
        { propertyId: "new-never", startedAt: ago(2), lastTouchAt: null },
      ],
      [
        { propertyId: "l1", listId: "L", listName: "Oldest roofs", lastTouchAt: null },
        { propertyId: "l2", listId: "L", listName: "Oldest roofs", lastTouchAt: ago(20) },
      ],
      { now },
    );
    expect(out.map((o) => o.propertyId)).toEqual(["stale-never", "stale-30", "new-never", "fresh", "l1", "l2"]);
    expect(out.slice(0, 2).every((o) => o.stale && o.source === "active")).toBe(true);
    expect(out[0]!.reason).toMatch(/^Active · going stale/);
    expect(out[4]).toMatchObject({ source: "list", listName: "Oldest roofs", reason: "Oldest roofs · never touched" });
  });

  it("skips list items touched in the last 14 days, duplicates and exclusions", () => {
    const out = orderWorkingList(
      [{ propertyId: "a", startedAt: ago(1), lastTouchAt: null }],
      [
        { propertyId: "a", listId: "L", listName: "L", lastTouchAt: null },
        { propertyId: "recent", listId: "L", listName: "L", lastTouchAt: ago(5) },
        { propertyId: "appt", listId: "L", listName: "L", lastTouchAt: null },
        { propertyId: "ok", listId: "M", listName: "M", lastTouchAt: ago(15) },
        { propertyId: "ok", listId: "N", listName: "N", lastTouchAt: ago(15) },
      ],
      { now, exclude: new Set(["appt"]) },
    );
    expect(out.map((o) => o.propertyId)).toEqual(["a", "ok"]);
    expect(out[1]!.listName).toBe("M");
  });

  it("excluded actives (do-not-pursue, appointment today) are dropped too", () => {
    const out = orderWorkingList([{ propertyId: "dnp", startedAt: ago(1), lastTouchAt: null }], [], { now, exclude: new Set(["dnp"]) });
    expect(out).toEqual([]);
  });

  it("caps at 25, actives win the slots", () => {
    const active = Array.from({ length: 20 }, (_, i) => ({ propertyId: `a${i}`, startedAt: ago(1), lastTouchAt: null }));
    const items = Array.from({ length: 40 }, (_, i) => ({ propertyId: `l${i}`, listId: "L", listName: "L", lastTouchAt: null }));
    const out = orderWorkingList(active, items, { now });
    expect(WORKING_CAP).toBe(25);
    expect(out).toHaveLength(25);
    expect(out.filter((o) => o.source === "active")).toHaveLength(20);
    expect(orderWorkingList(active, items, { now, cap: 10 })).toHaveLength(10);
  });

  it("staleness counts from the start of the pursuit when the last touch is older", () => {
    expect(isStaleActive({ startedAt: ago(5), lastTouchAt: ago(100) }, now)).toBe(false);
    expect(isStaleActive({ startedAt: ago(30), lastTouchAt: ago(22) }, now)).toBe(true);
    expect(isStaleActive({ startedAt: ago(30), lastTouchAt: ago(21) }, now)).toBe(false);
    expect(isStaleActive({ startedAt: ago(22), lastTouchAt: null }, now)).toBe(true);
  });
});
