"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

export default function DillyError(props: BoundaryProps) {
  useReportBoundary(props.error, "Dilly");
  return <ErrorScreen {...props} where="Dilly" />;
}
