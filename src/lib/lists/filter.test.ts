import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanFilter, describeFilter, filterHref, filterToSearch, isEmptyFilter, parseStoredFilter, SYSTEM_LISTS } from "@/lib/lists/filter";

describe("smart list filter ⇄ Properties query params", () => {
  it("keeps known params, drops view-only ones (tab, select, near, list) and junk", () => {
    const f = cleanFilter({ q: " Lamar ", roof: "TPO", age: "20plus", stale: "1", tab: "active", select: "1", near: "30.2,-97.7", bogus: "x", warranty: "yes" });
    expect(f).toEqual({ q: "Lamar", roof: "TPO", age: "20plus", stale: "1" });
  });

  it("validates enums and toggles", () => {
    expect(cleanFilter({ age: "ancient", cond: "damage", scope: "everyone", sort: "recent", never: "1" })).toEqual({ cond: "damage", never: "1" });
    expect(cleanFilter({ sort: "age", scope: "mine" })).toEqual({ sort: "age", scope: "mine" });
  });

  it("round-trips through a canonical, stably ordered query string", () => {
    const f = { storm: "1", market: "memphis", roof: "EPDM", scope: "mine" };
    const s = filterToSearch(f);
    expect(s).toBe("scope=mine&market=memphis&roof=EPDM&storm=1");
    expect(cleanFilter(Object.fromEntries(new URLSearchParams(s)))).toEqual(cleanFilter(f));
    expect(filterHref(f)).toBe(`/app/properties?${s}&tab=all`);
    expect(filterHref({})).toBe("/app/properties?tab=all");
  });

  it("parses stored jsonb defensively", () => {
    expect(parseStoredFilter({ stale: "1", n: 3, tab: "lists" })).toEqual({ stale: "1" });
    expect(parseStoredFilter(null)).toEqual({});
    expect(parseStoredFilter(["stale"])).toEqual({});
  });

  it("knows an empty filter and describes a real one", () => {
    expect(isEmptyFilter(cleanFilter({ tab: "all", select: "1" }))).toBe(true);
    expect(describeFilter({ scope: "mine", market: "memphis", cond: "damage", never: "1" }, [{ slug: "memphis", name: "Memphis" }])).toEqual([
      "Mine",
      "Memphis",
      "Leaks & damage",
      "Never touched",
    ]);
  });

  it("system lists match the migration that seeds them", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261004500000_lists_pursuit_admin.sql"), "utf8");
    expect(SYSTEM_LISTS).toHaveLength(6);
    for (const l of SYSTEM_LISTS) {
      const row = sql.split("\n").find((line) => line.includes(`('${l.key}',`));
      expect(row, l.key).toBeTruthy();
      expect(row).toContain(`'${l.name}'`);
      const json = row!.match(/'(\{.*\})'\)/)?.[1];
      expect(JSON.parse(json!)).toEqual(l.filter);
      expect(cleanFilter(l.filter)).toEqual(l.filter);
    }
  });
});
