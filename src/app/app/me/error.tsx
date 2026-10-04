"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function MeError(props: BoundaryProps) {
  useReportBoundary(props.error, "Me");
  return <ErrorScreen {...props} where="Me" />;
}
