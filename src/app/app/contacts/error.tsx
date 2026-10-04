"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function ContactsError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Contacts" />;
}
