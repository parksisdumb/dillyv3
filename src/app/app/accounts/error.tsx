"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function AccountsError(props: BoundaryProps) {
  useReportBoundary(props.error, "Accounts");
  return <ErrorScreen {...props} where="Accounts" />;
}
