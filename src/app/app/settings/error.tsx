"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function SettingsError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Settings" />;
}
