import { AdminNav } from "@/components/admin/admin-nav";

export type AdminSection = { href: string; label: string };

export function adminSections(level: "admin" | "readonly", platform: boolean): AdminSection[] {
  return level === "admin"
    ? [
        { href: "/app/admin/team", label: "Team" },
        { href: "/app/admin/company", label: "Company" },
        { href: "/app/admin/data", label: "Data" },
        ...(platform ? [{ href: "/app/admin/platform", label: "Platform" }] : []),
      ]
    : [{ href: "/app/admin/team", label: "Team" }];
}

/** Admin header + section tabs. */
export function AdminChrome({ tenantName, readonly, sections, current, children }: { tenantName: string; readonly: boolean; sections: AdminSection[]; current?: string; children: React.ReactNode }) {
  return (
    <div>
      <header className="px-4 pb-2 pt-4">
        <h1 className="font-display text-2xl font-bold leading-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted">
          {tenantName}
          {readonly ? " · view only" : ""}
        </p>
      </header>
      <AdminNav sections={sections} current={current} />
      {children}
    </div>
  );
}
