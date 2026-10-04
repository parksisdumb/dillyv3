"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function SettingsError(props: BoundaryProps) {
  useReportBoundary(props.error, "Settings");
  return <ErrorScreen {...props} where="Settings" />;
}
