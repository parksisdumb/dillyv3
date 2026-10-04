"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function TeamError(props: BoundaryProps) {
  useReportBoundary(props.error, "Team");
  return <ErrorScreen {...props} where="Team" />;
}
