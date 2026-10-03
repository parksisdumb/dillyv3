"use client";
// Dev-only helpers for /preview: open the Log sheet at a given step, or show a toast, without a server.
import { useEffect, useState } from "react";
import { LogSheet } from "@/components/log/log-sheet";
import { useToast } from "@/components/ui/toast";
import type { ContactOption, LogContextData } from "@/lib/actions/log-types";
import type { Channel } from "@/lib/domain/vocab";

export function PreviewLogSheet({ data, contact, picking, channel }: { data: LogContextData; contact: ContactOption | null; picking?: boolean; channel?: Channel | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  return <LogSheet open={open} target={{ accountId: data.account?.id }} onClose={() => setOpen(false)} initial={{ data, contact, picking, channel }} />;
}

export function PreviewToast({ text }: { text: string }) {
  const { toast } = useToast();
  useEffect(() => {
    toast(text);
  }, [toast, text]);
  return null;
}
