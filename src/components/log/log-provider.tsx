"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LogTarget } from "@/lib/actions/log-types";
import { LogSheet } from "@/components/log/log-sheet";

type Ctx = {
  /** Open the Log sheet. With no target, uses whatever the current page registered. */
  openLog: (target?: LogTarget) => void;
  setPageTarget: (t: LogTarget | null) => void;
};

const LogCtx = createContext<Ctx>({ openLog: () => {}, setPageTarget: () => {} });
export const useLog = () => useContext(LogCtx);

export function LogProvider({ children }: { children: React.ReactNode }) {
  const pageTarget = useRef<LogTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<LogTarget>({});
  const [nonce, setNonce] = useState(0);

  const openLog = useCallback((t?: LogTarget) => {
    setTarget(t ?? pageTarget.current ?? {});
    setNonce((n) => n + 1);
    setOpen(true);
  }, []);
  const setPageTarget = useCallback((t: LogTarget | null) => {
    pageTarget.current = t;
  }, []);
  const value = useMemo(() => ({ openLog, setPageTarget }), [openLog, setPageTarget]);

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
