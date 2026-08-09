import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type DiffOut, type RunDetail } from "../api/client";
import {
  AgentOutputView,
  AGENT_META,
  agentNameForStage,
} from "../components/AgentOutputView";
import { DiffViewer } from "../components/DiffViewer";
import { StatusBadge } from "../components/StatusBadge";
import { useRunEvents } from "../hooks/useRunEvents";

const LIVE_STATUSES = new Set(["queued", "running"]);

const AGENT_STEPS = ["pm", "architecture", "planner", "review"] as const;

export function RunDetailPage() {
  const { id } = useParams();
  const runId = Number(id);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [diff, setDiff] = useState<DiffOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>("pm");
  const statusRef = useRef<string | null>(null);

  const isLive = !!run && LIVE_STATUSES.has(run.status);
  const { events: liveEvents, connected, lastStatus } = useRunEvents(
    Number.isFinite(runId) ? runId : null,
    isLive,
  );

  const load = useCallback(async () => {
    if (!Number.isFinite(runId)) return;
    try {
      const [detail, d] = await Promise.all([
        api.getRun(runId),
        api.getDiff(runId).catch(() => null),
      ]);
      statusRef.current = detail.status;
      setRun(detail);
      if (d) setDiff(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isLive || !liveEvents.length) return;
    const t = setTimeout(() => void load(), 800);
    return () => clearTimeout(t);
  }, [isLive, liveEvents.length, load]);

  useEffect(() => {
    if (!lastStatus) return;
    if (lastStatus === statusRef.current) return;
    void load();
  }, [lastStatus, load]);

  async function retry() {
    setBusy(true);
    try {
      await api.retryRun(runId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!run && !error) return <p className="empty">Loading…</p>;
  if (!run) return <div className="alert">{error}</div>;

  const events = [
    ...(run.events || []),
    ...liveEvents
      .filter((e) => e.stage && e.message)
      .map((e, i) => ({
        id: -1000 - i,
        stage: e.stage!,
        message: e.message!,
        created_at: e.created_at || new Date().toISOString(),
        payload: null,
      })),
  ];

  const selectedMeta = AGENT_META[selected];
  const selectedData =
    selectedMeta?.outputField != null ? run[selectedMeta.outputField] : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {run.repo_full_name ? (
              <Link to={`/repos/${run.repo_id}`}>{run.repo_full_name}</Link>
            ) : (
              "Run"
            )}{" "}
            · issue #{run.issue_number}
          </p>
          <h1>{run.issue_title}</h1>
          <p className="lede">
            Branch <code>{run.branch_name}</code> · stage{" "}
            <code>{run.stage}</code>
            {isLive && connected ? (
              <span className="live-dot"> Live</span>
            ) : (
              <span className="meta"> · websocket idle</span>
            )}
          </p>
        </div>
        <div className="actions">
          <StatusBadge status={run.status} />
          {(run.status === "failed" || run.status === "needs_human") && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void retry()}
            >
              Retry
            </button>
          )}
          {run.pull_request?.url && (
            <a
              className="btn"
              href={run.pull_request.url}
              target="_blank"
              rel="noreferrer"
            >
              Open PR
            </a>
          )}
          {run.issue_url && (
            <a
              className="btn ghost"
              href={run.issue_url}
              target="_blank"
              rel="noreferrer"
            >
              Issue
            </a>
          )}
        </div>
      </div>

      {error && <div className="alert">{error}</div>}
      {run.error && <div className="alert">{run.error}</div>}

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Pipeline timeline</h2>
          </div>
          <ol className="timeline">
            {events.map((item) => (
              <li key={`${item.id}-${item.stage}-${item.message}`}>
                <div className="timeline-stage">
                  <strong>{agentNameForStage(item.stage)}</strong>
                  <span> · {item.stage}</span>
                </div>
                <div className="timeline-body">
                  <p>{item.message}</p>
                  {item.created_at && (
                    <time>{new Date(item.created_at).toLocaleString()}</time>
                  )}
                </div>
              </li>
            ))}
            {!events.length && <p className="empty">No events yet.</p>}
          </ol>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Files touched</h2>
          </div>
          <ul className="file-list">
            {(run.files_touched || []).map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
            {!(run.files_touched || []).length && (
              <li className="empty">None yet.</li>
            )}
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Agent outputs</h2>
        </div>
        <div className="btn-row" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          {AGENT_STEPS.map((key) => {
            const meta = AGENT_META[key];
            const has =
              meta.outputField != null && run[meta.outputField] != null;
            return (
              <button
                key={key}
                type="button"
                className={`btn ${selected === key ? "" : "ghost"}`}
                disabled={!has}
                onClick={() => setSelected(key)}
              >
                {meta.agent}
              </button>
            );
          })}
        </div>
        <div style={{ padding: "4px 0 12px" }}>
          <p className="meta" style={{ marginBottom: 12 }}>
            {selectedMeta?.agent} · {selectedMeta?.title}
          </p>
          <AgentOutputView stage={selected} data={selectedData} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Diff</h2>
          <button type="button" className="btn ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <DiffViewer
          diff={diff?.diff || ""}
          files={diff?.files || run.files_touched || []}
        />
      </section>
    </div>
  );
}
