import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { listCounts, loadAssignments, loadLists, type ListRow } from "@/lib/server/lists";
import type { ListGroup } from "@/components/lists/lists-index";
import type { ListOption } from "@/components/lists/list-sheets";

/** Lists tab groups: assigned to me · mine · team · built-in · imports. */
export async function loadListGroups(c: Ctx): Promise<ListGroup[]> {
  const [lists, members] = await Promise.all([loadLists(c), getMembers(c)]);
  const [counts, assigns] = await Promise.all([listCounts(c, lists), loadAssignments(c, lists.map((l) => l.id))]);
  const name = new Map(members.map((m) => [m.user_id, m.name.split(" ")[0] ?? m.name]));
  const me = c.s.userId;
  const card = (l: ListRow) => {
    const a = assigns.get(l.id) ?? [];
    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      createdFrom: l.created_from,
      n: counts.get(l.id)?.n ?? null,
      capped: counts.get(l.id)?.capped,
      assignedTo: c.s.isManager && a.length ? `Assigned: ${a.map((x) => name.get(x.user_id) ?? "rep").join(", ")}` : null,
      sub: l.owner_user_id && l.owner_user_id !== me && l.created_from !== "system" ? `by ${name.get(l.owner_user_id) ?? "a teammate"}` : null,
    };
  };
  const assignedToMe = lists.filter((l) => (assigns.get(l.id) ?? []).some((a) => a.user_id === me));
  const used = new Set(assignedToMe.map((l) => l.id));
  const rest = lists.filter((l) => !used.has(l.id));
  return [
    { title: "Assigned to you", lists: assignedToMe.map(card), empty: c.s.isManager ? undefined : "Nothing assigned yet — your manager can hand you a list." },
    { title: "Your lists", lists: rest.filter((l) => l.owner_user_id === me && l.created_from !== "import").map(card) },
    { title: "Team lists", lists: rest.filter((l) => l.owner_user_id !== me && l.created_from !== "system" && l.created_from !== "import").map(card) },
    { title: "Built-in", lists: rest.filter((l) => l.created_from === "system").map(card) },
    { title: "Imports", lists: rest.filter((l) => l.created_from === "import").map(card) },
  ];
}

/** Static lists this person may add to (theirs; any, for managers). */
export async function loadEditableLists(c: Ctx): Promise<ListOption[]> {
  const lists = await loadLists(c);
  return lists.filter((l) => l.kind === "static" && (c.s.isManager || l.owner_user_id === c.s.userId)).map((l) => ({ id: l.id, name: l.name }));
}
