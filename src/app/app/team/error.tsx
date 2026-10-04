"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function TeamError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Team" />;
}
