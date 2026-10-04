"use client";
import { ErrorScreen, type BoundaryProps } from "@/components/status/error-screen";

export default function DillyError(props: BoundaryProps) {
  return <ErrorScreen {...props} where="Dilly" />;
}
