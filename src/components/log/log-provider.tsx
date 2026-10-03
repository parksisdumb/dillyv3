"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LogTarget } from "@/lib/actions/log-types";
import { LogSheet } from "@/components/log/log-sheet";

type Ctx = {
  /** Open the Log sheet. With no target, uses whatever the current page registered. */
  openLog: (target?: LogTarget) => void;
  setPageTarget: (t: LogTarget | null) => void;
  /** Screens that are themselves a logging surface (Go sessions) hide the floating button. */
  fabHidden: boolean;
  setFabHidden: (hidden: boolean) => void;
};

const LogCtx = createContext<Ctx>({ openLog: () => {}, setPageTarget: () => {}, fabHidden: false, setFabHidden: () => {} });
export const useLog = () => useContext(LogCtx);

export function LogProvider({ children }: { children: React.ReactNode }) {
  const pageTarget = useRef<LogTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<LogTarget>({});
  const [nonce, setNonce] = useState(0);
  const [fabHidden, setFabHidden] = useState(false);

  const openLog = useCallback((t?: LogTarget) => {
    setTarget(t ?? pageTarget.current ?? {});
    setNonce((n) => n + 1);
    setOpen(true);
  }, []);
  const setPageTarget = useCallback((t: LogTarget | null) => {
    pageTarget.current = t;
  }, []);
  const value = useMemo(() => ({ openLog, setPageTarget, fabHidden, setFabHidden }), [openLog, setPageTarget, fabHidden]);

  return (
    <LogCtx.Provider value={value}>
      {children}
      <LogSheet key={nonce} open={open} target={target} onClose={() => setOpen(false)} />
    </LogCtx.Provider>
  );
}

/** Drop into a page to make the global Log button pre-fill with this page's account/contact/property. */
export function LogContext(props: LogTarget) {
  const { setPageTarget } = useLog();
  const { accountId, contactId, propertyId, opportunityId } = props;
  useEffect(() => {
    setPageTarget({ accountId, contactId, propertyId, opportunityId });
    return () => setPageTarget(null);
  }, [setPageTarget, accountId, contactId, propertyId, opportunityId]);
  return null;
}

/** Render on a screen that already is a logging surface: hides the floating Log button while mounted. */
export function HideLogFab() {
  const { setFabHidden } = useLog();
  useEffect(() => {
    setFabHidden(true);
    return () => setFabHidden(false);
  }, [setFabHidden]);
  return null;
}
