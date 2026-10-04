"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function PipelineError(props: BoundaryProps) {
  useReportBoundary(props.error, "Pipeline");
  return <ErrorScreen {...props} where="Pipeline" />;
}
