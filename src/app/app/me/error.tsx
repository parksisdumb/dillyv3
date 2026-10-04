"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function MeError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Me" />;
}
