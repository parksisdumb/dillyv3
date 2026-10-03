import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import { TOUCH_COLS, withNames } from "@/lib/server/timeline";
import { PERSONA_ROLES, type PersonaRole } from "@/lib/domain/vocab";
import { Chip, Empty, PageHeader, SectionTitle } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { LogContext } from "@/components/log/log-provider";
import { LogButton } from "@/components/log/log-button";
import { TouchTimeline } from "@/components/accounts/touch-timeline";
import { ContactEditForm } from "@/components/accounts/forms";
import { IconMail, IconPhone } from "@/components/icons";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await ctx();
  const { sb, tenantId } = c;
  const { data: p } = await sb.from("contact").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!p) notFound();
  const [acct, touches, accounts] = await Promise.all([
    p.account_id ? sb.from("account").select("id,name").eq("id", p.account_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("touch").select(TOUCH_COLS).eq("tenant_id", tenantId).eq("contact_id", id).order("occurred_at", { ascending: false }).limit(40),
    sb.from("account").select("id,name").eq("tenant_id", tenantId).is("duplicate_of", null).order("name").limit(800),
  ]);
  const timeline = await withNames(c, touches.data ?? []);
  const phone = p.mobile ?? p.phone;

  return (
    <div>
      <LogContext contactId={id} accountId={p.account_id} />
      <PageHeader
        back={p.account_id ? `/app/accounts/${p.account_id}` : "/app/accounts"}
        title={p.full_name ?? "Unnamed contact"}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {p.title && <span>{p.title}</span>}
            <Chip>{PERSONA_ROLES[p.persona_role as PersonaRole] ?? p.persona_role}</Chip>
            {acct.data && (
              <Link className="underline decoration-line underline-offset-2" href={`/app/accounts/${acct.data.id}`}>
                {acct.data.name}
              </Link>
            )}
            {p.do_not_contact && <Chip tone="bad">Do not contact</Chip>}
            {p.email_status === "bounced" && <Chip tone="bad">Email bounced</Chip>}
          </span>
        }
      />
      <div className="flex gap-2 px-4 pt-2">
        <LogButton target={{ contactId: id, accountId: p.account_id }} variant="primary" className="flex-1" label={`Log with ${p.first_name ?? "them"}`} />
        {phone && !p.do_not_contact && (
          <a href={`tel:${phone}`} className={btn("secondary", "md")} aria-label="Call">
            <IconPhone size={20} />
          </a>
        )}
        {p.email && !p.do_not_contact && (
          <a href={`mailto:${p.email}`} className={btn("secondary", "md")} aria-label="Email">
            <IconMail size={20} />
          </a>
        )}
      </div>

      <SectionTitle>Timeline</SectionTitle>
      {timeline.length === 0 ? <Empty title="No touches yet" /> : <TouchTimeline touches={timeline} />}

      <SectionTitle>Details</SectionTitle>
      <ContactEditForm c={p} accounts={accounts.data ?? []} />
    </div>
  );
}
