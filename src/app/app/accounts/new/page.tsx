import type { Metadata } from "next";
import { ctx } from "@/lib/server/ctx";
import { getMembers } from "@/lib/server/members";
import { PageHeader } from "@/components/ui/bits";
import { AccountForm } from "@/components/accounts/forms";

export const metadata: Metadata = { title: "New account" };

export default async function NewAccount() {
  const c = await ctx();
  const members = await getMembers(c);
  return (
    <div>
      <PageHeader back="/app/accounts" title="New account" />
      <AccountForm members={members} me={c.s.userId} />
    </div>
  );
}
