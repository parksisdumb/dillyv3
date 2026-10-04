"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function ContactsError(props: BoundaryProps) {
  useReportBoundary(props.error, "Contacts");
  return <ErrorScreen {...props} where="Contacts" />;
}
