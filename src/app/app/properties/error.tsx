"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function PropertiesError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Properties" />;
}
