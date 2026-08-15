/**
 * Shared formatting helpers and constants used across pages.
 */

/* ─── Status sets ─── */
export const LIVE = new Set(["queued", "running"]);
export const DONE = new Set(["completed", "done"]);
export const FAILED = new Set(["failed", "error", "needs_human"]);
export const AWAITING = new Set(["awaiting_push"]);
export const DISCARDED = new Set(["discarded"]);

/* ─── Time formatting ─── */

/** Human-readable relative time string like "3m ago" or "just now". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

/** Format an HH:MM clock string from an ISO timestamp. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Pretty-print a duration between two ISO timestamps as "Xm XXs" or "Xh Ym". */
export function formatDuration(
  start: string | null | undefined,
  end?: string | null,
): string {
  if (!start) return "—";
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "—";
  const sec = Math.floor((b - a) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Short duration from raw milliseconds. */
export function formatDurationShort(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
