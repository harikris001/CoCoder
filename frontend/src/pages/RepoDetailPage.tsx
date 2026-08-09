import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type IndexStatus, type Repo, type RunSummary } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function RepoDetailPage() {
  const { id } = useParams();
  const repoId = Number(id);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!Number.isFinite(repoId)) return;
    try {
      const [r, idx, runList] = await Promise.all([
        api.getRepo(repoId),
        api.indexStatus(repoId),
        api.listRuns({ repo_id: repoId }),
      ]);
      setRepo(r);
      setIndex(idx);
      setRuns(runList);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, [repoId]);

  async function reindex() {
    setBusy(true);
    setError(null);
    try {
      await api.reindex(repoId);
      setInfo("Reindex queued.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncIssues() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.syncIssues(repoId);
      const created = result.created.length;
      const skipped = result.skipped.length;
      setInfo(
        created
          ? `Queued ${created} new run(s) from GitHub issues (${skipped} already tracked).`
          : `No new issues to queue (${skipped} already tracked, fetched ${result.fetched}).`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!repo && !error) return <p className="empty">Loading…</p>;

  const stats = (index?.stats || repo?.index_stats || {}) as Record<
    string,
    number | string
  >;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Repository</p>
          <h1>{repo?.full_name || `Repo #${repoId}`}</h1>
          <p className="lede">
            Hybrid index status — RAG chunks, AST symbols, dependency edges.
            GitHub webhooks need a public URL; for local use, sync issues below.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void syncIssues()}
          >
            {busy ? "Working…" : "Sync open issues"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void reindex()}
          >
            {busy ? "Queuing…" : "Reindex"}
          </button>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}
      {info && <div className="alert ok">{info}</div>}

      <section className="stats-grid">
        <div className="stat">
          <span>Status</span>
          <strong>
            <StatusBadge status={index?.status || repo?.index_status || "—"} />
          </strong>
        </div>
        <div className="stat">
          <span>RAG chunks</span>
          <strong>{stats.chunks ?? "—"}</strong>
        </div>
        <div className="stat">
          <span>AST symbols</span>
          <strong>{stats.symbols ?? "—"}</strong>
        </div>
        <div className="stat">
          <span>Graph edges</span>
          <strong>{stats.graph_edges ?? "—"}</strong>
        </div>
        <div className="stat">
          <span>Graph nodes</span>
          <strong>{stats.graph_nodes ?? "—"}</strong>
        </div>
        <div className="stat">
          <span>Last indexed</span>
          <strong>
            {index?.last_indexed_at || repo?.last_indexed_at
              ? new Date(
                  String(index?.last_indexed_at || repo?.last_indexed_at),
                ).toLocaleString()
              : "—"}
          </strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Runs for this repo</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Issue</th>
              <th>Stage</th>
              <th>Status</th>
              <th>PR</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/runs/${run.id}`}>
                    #{run.issue_number} {run.issue_title}
                  </Link>
                </td>
                <td>
                  <code>{run.stage}</code>
                </td>
                <td>
                  <StatusBadge status={run.status} />
                </td>
                <td>
                  {run.pr_url ? (
                    <a href={run.pr_url} target="_blank" rel="noreferrer">
                      Open PR
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td colSpan={4} className="empty">
                  No runs for this repository. Use &quot;Sync open issues&quot; to
                  pull from GitHub.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
