import { pageBody } from "@/components/status/page-boundary";
import type { Metadata } from "next";
import Link from "next/link";
import { ctx } from "@/lib/server/ctx";
import { saveProfile } from "@/lib/actions/settings";
import { changePassword } from "@/lib/actions/password";
import { signOut } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/fields";
import { PageHeader, SectionTitle } from "@/components/ui/bits";
import { btn } from "@/components/ui/styles";
import { IconChevronRight, IconKey, IconLogout } from "@/components/icons";
import { EmailConnectCard } from "@/components/settings/email-connect-card";
import { NotificationsSection } from "@/components/push/notifications-section";

export const metadata: Metadata = { title: "Settings" };

/** Personal settings only. Company, people, targeting, data → Admin (owners/admins). */
async function SettingsPageBody() {
  const c = await ctx();
  const { sb, s } = c;
  const ownerish = s.tenant.role === "owner" || s.tenant.role === "admin" || s.isPlatformAdmin;
  const profile = await sb.from("profile").select("full_name,phone,email").eq("id", s.userId).single();

  return (
    <div>
      <PageHeader title="Settings" sub={s.tenant.name} />

      {(ownerish || s.isManager) && (
        <Link href="/app/admin" className="mx-4 mb-2 flex min-h-14 items-center gap-3 rounded-lg border-2 border-line bg-surface px-4 hover:border-ink">
          <IconKey size={20} />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Admin</span>
            <span className="block text-sm text-muted">
              {ownerish ? "Team & logins, company, markets, targeting, team goal, data" : "Team members (view only)"}
            </span>
          </span>
          <IconChevronRight size={20} className="text-muted" />
        </Link>
      )}

      <SectionTitle>Profile</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <ActionForm action={saveProfile} submitLabel="Save profile" submitVariant="secondary" className="px-4">
          <TextField label="Name" name="full_name" required defaultValue={profile.data?.full_name} autoComplete="name" />
          <TextField label="Mobile" name="phone" type="tel" inputMode="tel" defaultValue={profile.data?.phone} autoComplete="tel" />
          <p className="text-sm text-muted">Signed in as {profile.data?.email ?? s.email}</p>
        </ActionForm>
      </div>

      <SectionTitle>Password</SectionTitle>
      <div className="border-y border-line bg-surface py-4">
        <ActionForm action={changePassword} submitLabel="Change password" submitVariant="secondary" className="px-4">
          <input type="hidden" name="username" value={profile.data?.email ?? s.email} autoComplete="username" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="New password" name="password" type="password" autoComplete="new-password" hint="10+ characters, letters with numbers or symbols" />
            <TextField label="Type it again" name="confirm" type="password" autoComplete="new-password" />
          </div>
        </ActionForm>
      </div>

      <EmailConnectCard />
      <NotificationsSection />

      <form action={signOut} className="px-4 py-6">
        <button type="submit" className={btn("secondary", "lg", "w-full")}>
          <IconLogout size={20} /> Sign out
        </button>
      </form>
    </div>
  );
}

// No loading.tsx and no page-level Suspense (tests/e2e/BUGS.md B9, B10): see pageBody().
export default function SettingsPage() {
  return pageBody(() => SettingsPageBody());
}
