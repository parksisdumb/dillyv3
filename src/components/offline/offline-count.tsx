"use client";
import { useEffect, useState } from "react";
import { deviceQueue } from "@/lib/offline/idb";

/** On the /offline page: how many logs are safe on this phone, waiting to send. */
export function OfflineCount() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    deviceQueue()
      .list()
      .then((xs) => setN(xs.filter((x) => x.status === "pending").length))
      .catch(() => setN(null));
  }, []);
  if (!n) return null;
  return (
    <p role="status" className="mt-4 rounded-lg border-2 border-warning bg-warning/10 px-3 py-2 text-base">
      <strong className="num">{n}</strong> {n === 1 ? "log is" : "logs are"} saved on this phone and will send by themselves when you have signal.
    </p>
  );
}
