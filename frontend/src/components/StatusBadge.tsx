const STATUS_CLASS: Record<string, string> = {
  queued: "badge muted",
  running: "badge running",
  completed: "badge ok",
  failed: "badge bad",
  needs_human: "badge warn",
  ready: "badge ok",
  indexing: "badge running",
  pending: "badge muted",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={STATUS_CLASS[status] || "badge"}>{status}</span>;
}
