"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function TodayError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Today" />;
}
