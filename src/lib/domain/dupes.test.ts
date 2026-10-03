import { describe, expect, it } from "vitest";
import { duplicateGroups } from "./dupes";

const c = (id: string, full_name: string | null, extra: Partial<{ email: string; phone: string; mobile: string; account_id: string }> = {}) => ({
  id,
  full_name,
  email: extra.email ?? null,
  phone: extra.phone ?? null,
  mobile: extra.mobile ?? null,
  account_id: extra.account_id ?? null,
});

describe("duplicateGroups", () => {
  it("joins by email, phone digits, and same name on the same account", () => {
    const groups = duplicateGroups([
      c("1", "Dave Smith", { email: "DAVE@x.com" }),
      c("2", "David Smith", { email: "dave@x.com" }),
      c("3", "Maria", { phone: "(512) 555-0101" }),
      c("4", "Maria Lopez", { mobile: "+1 512 555 0101" }),
      c("5", "Kim Lee", { account_id: "a" }),
      c("6", "kim  lee", { account_id: "a" }),
      c("7", "Kim Lee", { account_id: "b" }),
    ]);
    const ids = groups.map((g) => g.map((x) => x.id).sort().join(",")).sort();
    expect(ids).toEqual(["1,2", "3,4", "5,6"]);
  });

  it("chains transitively", () => {
    const groups = duplicateGroups([c("1", "A", { email: "a@x.com" }), c("2", "B", { email: "a@x.com", phone: "5125550199" }), c("3", "C", { phone: "512-555-0199" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});
