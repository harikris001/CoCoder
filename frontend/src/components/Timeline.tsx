import type { RunEvent } from "../api/client";

export function Timeline({
  events,
  live = [],
}: {
  events: RunEvent[];
  live?: Array<{ stage: string; message: string; created_at?: string }>;
}) {
  const merged = [
    ...events.map((e) => ({
      key: `db-${e.id}`,
      stage: e.stage,
      message: e.message,
      created_at: e.created_at,
    })),
    ...live.map((e, i) => ({
      key: `live-${i}-${e.stage}-${e.message}`,
      stage: e.stage,
      message: e.message,
      created_at: e.created_at,
    })),
  ];

  if (!merged.length) {
    return <p className="empty">No events yet.</p>;
  }

  return (
    <ol className="timeline">
      {merged.map((item) => (
        <li key={item.key}>
          <div className="timeline-stage">{item.stage}</div>
          <div className="timeline-body">
            <p>{item.message}</p>
            {item.created_at && (
              <time>{new Date(item.created_at).toLocaleString()}</time>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
