import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/bits";
import { NewContact } from "@/components/accounts/new-contact";

export const metadata: Metadata = { title: "New contact" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ source?: string; back?: string }> }) {
  const { source, back } = await searchParams;
  const field = source === "field";
  const backHref = back && back.startsWith("/app/") ? back : "/app/contacts";
  return (
    <div>
      <PageHeader back={backHref} title={field ? "Add person I met" : "New contact"} sub="We check for the same person before saving." />
      <div className="px-4 pt-2">
        <NewContact source={field ? "field" : "rep"} />
      </div>
    </div>
  );
}
