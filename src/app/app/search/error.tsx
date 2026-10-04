"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function SearchError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Search" />;
}
