"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function PropertiesError(props: BoundaryProps) {
  useReportBoundary(props.error, "Properties");
  return <ErrorScreen {...props} where="Properties" />;
}
