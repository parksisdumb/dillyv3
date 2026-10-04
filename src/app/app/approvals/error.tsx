"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function ApprovalsError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Approvals" />;
}
