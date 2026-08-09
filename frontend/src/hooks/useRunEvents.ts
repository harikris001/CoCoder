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

  useEffect(() => {
    if (!runId || !enabled) return;

    const ws = new WebSocket(`${WS_BASE}/runs/${runId}/events`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
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

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [runId, enabled]);

  return { events, connected, lastStatus, clear: () => setEvents([]) };
}
