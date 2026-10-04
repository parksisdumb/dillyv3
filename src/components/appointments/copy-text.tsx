"use client";
import { useToast } from "@/components/ui/toast";
import { btn } from "@/components/ui/styles";
import { IconClipboard } from "@/components/icons";

/** "Copy address" — clipboard API with a selection fallback for older iOS webviews. */
export function CopyText({ text, label }: { text: string; label: string }) {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Address copied", "neutral");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      toast(ok ? "Address copied" : text, "neutral");
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className={btn("ghost", "md", "w-full")}>
      <IconClipboard size={20} /> {label}
    </button>
  );
}
