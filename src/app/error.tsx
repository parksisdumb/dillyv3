"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

// Catches failures in layouts below the root — notably /app's session/tenant lookup — where the app shell
// itself couldn't render, so this screen stands alone.
export default function RootSegmentError(props: BoundaryProps) {
  return <ErrorScreen {...props} inShell={false} />;
}
