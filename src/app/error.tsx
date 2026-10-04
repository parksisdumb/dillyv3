"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";
import { useReportBoundary } from "@/components/observability/client-errors";

// Catches failures in layouts below the root — notably /app's session/tenant lookup — where the app shell
// itself couldn't render, so this screen stands alone.
export default function RootSegmentError(props: BoundaryProps) {
  useReportBoundary(props.error, "root");
  return <ErrorScreen {...props} inShell={false} />;
}
