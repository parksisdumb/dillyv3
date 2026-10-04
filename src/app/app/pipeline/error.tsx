"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function PipelineError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Pipeline" />;
}
