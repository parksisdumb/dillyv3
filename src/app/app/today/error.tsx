"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function TodayError(props: BoundaryProps) {
  useReportBoundary(props.error, "Today");
  return <ErrorScreen {...props} where="Today" />;
}
