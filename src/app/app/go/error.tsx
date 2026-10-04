"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function GoError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Go" />;
}
