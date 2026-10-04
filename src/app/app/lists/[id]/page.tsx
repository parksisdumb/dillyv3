import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { listProgress, listRows, loadAssignments, loadList, myActiveIds } from "@/lib/server/lists";
import { getMembers } from "@/lib/server/members";
import { safe } from "@/lib/server/safe";
import { describeFilter } from "@/lib/lists/filter";
import { ListDetailView, type ListSort } from "@/components/lists/list-detail-view";
import type { PropertySP } from "@/lib/server/book";

export const metadata: Metadata = { title: "List" };

async function ListPageBody({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string; near?: string; select?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const c = await ctx();
  const list = await loadList(c, id);
  if (!list) notFound();
  const f = { tenant: c.tenantId, user: c.s.userId, list: id };
  const sort: ListSort = sp.sort === "near" && sp.near ? "near" : sp.sort === "age" ? "age" : sp.sort === "untouched" ? "untouched" : "list";
  const view: PropertySP = sort === "near" ? { sort: "near", near: sp.near } : sort === "age" ? { sort: "age" } : {};
  const [res, assigns, members, active] = await Promise.all([
    listRows(c, list, view, 400),
    safe(() => loadAssignments(c, [list.id]), new Map(), "list:assignments", f),
    c.s.isManager ? safe(() => getMembers(c), [], "list:members", f) : Promise.resolve([]),
    safe(() => myActiveIds(c), [], "list:active", f),
  ]);
  let rows = res.rows;
  if (sort === "untouched") rows = [...rows].sort((a, b) => (a.last_touch_at ?? "").localeCompare(b.last_touch_at ?? ""));
  const assigned = (assigns.get(list.id) ?? []).map((a: { user_id: string }) => a.user_id);
  const canEdit = c.s.isManager || list.owner_user_id === c.s.userId;
  return (
    <ListDetailView
      d={{
        list: { id: list.id, name: list.name, description: list.description, kind: list.kind, createdFrom: list.created_from, filter: list.filter, visibility: list.visibility, archived: !!list.archived_at },
        summary: describeFilter(list.filter),
        rows,
        total: res.total,
        capped: res.capped,
        error: res.error,
        progress: listProgress(res.rows),
        today: c.today,
        sort,
        selecting: sp.select === "1",
        canEdit,
        isManager: c.s.isManager,
        activeIds: active.map((a) => a.property_id),
        assigned,
        members: members.filter((m) => ["rep", "manager", "owner", "admin"].includes(m.role)).map((m) => ({ user_id: m.user_id, name: m.name, role: m.role })),
        assignedNames: members.filter((m) => assigned.includes(m.user_id)).map((m) => m.name),
      }}
    />
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default async function ListPage(props: Parameters<typeof ListPageBody>[0]) {
  const key = JSON.stringify([await props.params, await props.searchParams]);
  return pageBody(() => ListPageBody(props), key);
}
