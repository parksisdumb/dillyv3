import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { loadContacts, type ContactSP } from "@/lib/server/book";
import { ContactsListView } from "@/components/accounts/contacts-list-view";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<ContactSP> }) {
  const sp = await searchParams;
  const c = await ctx();
  const { rows, error, capped } = await loadContacts(c, sp);
  return <ContactsListView sp={sp} rows={rows} error={error} capped={capped} />;
}
