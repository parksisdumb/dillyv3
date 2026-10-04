"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function AccountsError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Accounts" />;
}
