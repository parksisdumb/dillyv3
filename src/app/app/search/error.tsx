"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function SearchError(props: BoundaryProps) {
  useReportBoundary(props.error, "Search");
  return <ErrorScreen {...props} where="Search" />;
}
