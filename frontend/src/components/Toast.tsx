import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckIcon } from "./icons";

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2400);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div
        className={`fixed bottom-6 left-1/2 z-80 flex -translate-x-1/2 items-center gap-2.5 rounded-xl bg-ink px-4.5 py-3 text-[13px] text-surface shadow-lg transition-all duration-250 ${
          msg ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
        }`}
        style={{ pointerEvents: "none" }}
        aria-hidden={!msg}
      >
        <CheckIcon className="text-accent" size={16} />
        <span>{msg}</span>
      </div>
    </ToastCtx.Provider>
  );
}