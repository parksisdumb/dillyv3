"use client";
import { useRouter } from "next/navigation";
import { QuickContactForm } from "@/components/log/quick-contact-form";
import { useToast } from "@/components/ui/toast";

/** Create-contact page body: duplicate check first ("Is this them?"), then back to the account. */
export function NewContact({ accountId }: { accountId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  return (
    <QuickContactForm
      accountId={accountId}
      submitLabel="Add contact"
      onDone={(c, created) => {
        toast(created ? `Added ${c.name}` : `${c.name} already exists — opened`);
        router.push(created ? `/app/accounts/${accountId}` : `/app/contacts/${c.id}`);
      }}
    />
  );
}
