import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageBody } from "@/components/status/page-boundary";
import { adminCtx } from "@/lib/server/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { agoLabel } from "@/lib/format";
import { SectionTitle } from "@/components/ui/bits";
import { CreateCompanyForm, EnterCompanyButton } from "@/components/admin/team-admin";

export const metadata: Metadata = { title: "Admin · Platform" };

async function PlatformBody() {
  const c = await adminCtx();
  if (!c.s.isPlatformAdmin) notFound();
  // Cross-company counts: service role (the platform admin already sees every tenant through RLS).
  const admin = supabaseAdmin();
  const [tenants, members, touches, markets] = await Promise.all([
    admin.from("tenant").select("id,slug,name,kind,created_at").order("name"),
    admin.from("membership").select("tenant_id").eq("active", true).limit(10000),
    admin.from("touch").select("tenant_id,occurred_at").order("occurred_at", { ascending: false }).limit(2000),
    admin.from("market").select("slug,name,state").order("name"),
  ]);
  const n = new Map<string, number>();
  for (const m of members.data ?? []) n.set(m.tenant_id, (n.get(m.tenant_id) ?? 0) + 1);
  const last = new Map<string, string>();
  for (const t of touches.data ?? []) if (!last.has(t.tenant_id)) last.set(t.tenant_id, t.occurred_at);
  return (
    <div>
      <SectionTitle>Companies · {(tenants.data ?? []).length}</SectionTitle>
      <ul className="divide-y divide-line border-y border-line bg-surface" aria-label="Companies">
        {(tenants.data ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{t.name}</div>
              <div className="num text-xs text-muted">
                {t.slug} · {n.get(t.id) ?? 0} members · last activity {last.has(t.id) ? agoLabel(last.get(t.id)!) : "none yet"}
              </div>
            </div>
            <EnterCompanyButton slug={t.slug} name={t.name} current={t.slug === c.s.tenant.slug} />
          </li>
        ))}
      </ul>
      <SectionTitle>Add company</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <CreateCompanyForm markets={markets.data ?? []} />
      </div>
    </div>
  );
}

export default function PlatformPage() {
  return pageBody(() => PlatformBody());
}
