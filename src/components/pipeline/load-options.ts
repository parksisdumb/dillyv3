import "server-only";
import type { Ctx } from "@/lib/server/ctx";

/** Select options for the opportunity form: all accounts, plus the chosen account's buildings and people. */
export async function loadOppOptions(c: Ctx, accountId: string | null) {
  const { sb, tenantId } = c;
  const [accts, props, people] = await Promise.all([
    sb.from("account").select("id,name").eq("tenant_id", tenantId).is("duplicate_of", null).order("name").limit(800),
    accountId
      ? sb.from("property").select("id,name,address1").eq("tenant_id", tenantId).eq("account_id", accountId)
      : Promise.resolve({ data: [] as { id: string; name: string | null; address1: string | null }[] }),
    accountId
      ? sb.from("contact").select("id,full_name,title").eq("tenant_id", tenantId).eq("account_id", accountId)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; title: string | null }[] }),
  ]);
  return {
    accounts: (accts.data ?? []).map((a) => ({ id: a.id, label: a.name })),
    properties: (props.data ?? []).map((p) => ({ id: p.id, label: p.name || p.address1 || "Unnamed property" })),
    contacts: (people.data ?? []).map((p) => ({ id: p.id, label: [p.full_name ?? "Unnamed", p.title].filter(Boolean).join(" · ") })),
  };
}
