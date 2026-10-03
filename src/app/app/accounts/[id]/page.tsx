import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { AccountDetailView } from "@/components/accounts/account-detail-view";

export const metadata: Metadata = { title: "Account" };

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId, today } = c;

  const { data: a } = await sb.from("account_ranked").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!a) notFound();

  const [task, opps, props, contacts, touches, owner] = await Promise.all([
    sb.from("task").select("id,title,due_on,reason").eq("tenant_id", tenantId).eq("account_id", id).eq("status", "open").order("due_on").limit(1).maybeSingle(),
    sb
      .from("opportunity")
      .select("id,name,stage,value_estimate,next_step,next_step_due,stage_changed_at")
      .eq("tenant_id", tenantId)
      .eq("account_id", id)
      .not("stage", "in", "(won,lost)")
      .order("value_estimate", { ascending: false, nullsFirst: false }),
    sb
      .from("property")
      .select("id,name,address1,city,state,roof_system,roof_install_year,roof_area_sf,asset_class")
      .eq("tenant_id", tenantId)
      .eq("account_id", id)
      .is("duplicate_of", null)
      .order("name"),
    sb
      .from("contact")
      .select("id,full_name,title,persona_role,phone,mobile,email,do_not_contact,last_touch_at")
      .eq("tenant_id", tenantId)
      .eq("account_id", id)
      .is("duplicate_of", null)
      .order("last_touch_at", { ascending: false, nullsFirst: false }),
    sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("account_id", id).order("occurred_at", { ascending: false }).limit(40),
    a.owner_user_id ? sb.from("profile").select("full_name,email").eq("id", a.owner_user_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return (
    <AccountDetailView
      d={{
        id,
        today,
        a: { ...a, name: a.name ?? "Account" },
        task: task.data,
        opps: opps.data ?? [],
        props: (props.data ?? []).map((p) => ({ ...p, roof_area_sf: p.roof_area_sf == null ? null : Number(p.roof_area_sf) })),
        contacts: contacts.data ?? [],
        timeline: await withNames(c, touches.data ?? []),
        ownerName: owner.data?.full_name ?? owner.data?.email ?? null,
      }}
    />
  );
}
