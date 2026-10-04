"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function GoError(props: BoundaryProps) {
  useReportBoundary(props.error, "Go");
  return <ErrorScreen {...props} where="Go" />;
}
