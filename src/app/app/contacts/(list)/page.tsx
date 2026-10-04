import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { loadContacts, type ContactSP } from "@/lib/server/book";
import { ContactsListView } from "@/components/accounts/contacts-list-view";
import { DataLinks } from "@/components/import/data-links";

export const metadata: Metadata = { title: "Contacts" };

// The skeleton lives in the page's own Suspense (not a route loading.tsx): see tests/e2e/BUGS.md B9.
export default async function ContactsPage({ searchParams }: { searchParams: Promise<ContactSP> }) {
  const sp = await searchParams;
  return pageBody(() => ContactsBody({ sp }), JSON.stringify(sp));
}

async function ContactsBody({ sp }: { sp: ContactSP }) {
  const c = await ctx();
  const { rows, error, capped } = await loadContacts(c, sp);
  return <ContactsListView sp={sp} rows={rows} error={error} capped={capped} headerExtra={c.s.isManager ? <DataLinks entity="contacts" sp={sp} /> : null} />;
}
