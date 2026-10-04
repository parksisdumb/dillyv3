"use client";
import { useRouter } from "next/navigation";
import { QuickContactForm } from "@/components/log/quick-contact-form";
import { useToast } from "@/components/ui/toast";

/** Create-contact page body: duplicate check first ("Is this them?"), then open the contact (or its account). */
export function NewContact({ accountId, source = "rep" }: { accountId?: string; source?: "rep" | "field" }) {
  const router = useRouter();
  const { toast } = useToast();
  return (
    <QuickContactForm
      accountId={accountId}
      pickAccount={!accountId}
      source={source}
      submitLabel="Add contact"
      onDone={(c, created) => {
        toast(created ? `Added ${c.name}` : `${c.name} already exists — opened`);
        router.push(created && accountId ? `/app/accounts/${accountId}` : `/app/contacts/${c.id}`);
      }}
    />
  );
}
