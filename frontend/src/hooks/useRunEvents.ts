import { useEffect, useRef, useState } from "react";
import { WS_BASE, type RunEvent } from "../api/client";

type LiveEvent = RunEvent & {
  type?: string;
  run_id?: number;
  status?: string;
};

export function useRunEvents(runId: number | null, enabled = true) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!runId || !enabled) return;

    let isUnmounted = false;

    function connect() {
      if (isUnmounted) return;
      const ws = new WebSocket(`${WS_BASE}/runs/${runId}/events`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryCountRef.current = 0;
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!isUnmounted) {
          // Reconnect with exponential backoff (1s up to 16s)
          const timeout = Math.min(1000 * 2 ** retryCountRef.current, 16000);
          retryCountRef.current += 1;
          timerRef.current = setTimeout(connect, timeout);
        }
      };
      ws.onerror = () => {
        setConnected(false);
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as LiveEvent;
          if (data.type === "ping" || data.type === "subscribed") return;
          if (data.status) setLastStatus(data.status);
          if (data.stage && data.message) {
            setEvents((prev) => [...prev, data]);
          }
        } catch {
          // ignore malformed
        }
      };
    }

    connect();

    return () => {
      isUnmounted = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [runId, enabled]);

  return { events, connected, lastStatus, clear: () => setEvents([]) };
}
