import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type IndexStatus,
  type Repo,
  type RunSummary,
} from "../api/client";
import {
  BoltIcon,
  ClockIcon,
  CopyIcon,
  IssueIcon,
  PlayIcon,
  RepoIcon,
  SyncIcon,
} from "../components/icons";
import { Crumb, SearchBox, TopbarShell } from "../components/Topbar";
import { useToast } from "../components/Toast";
import { DONE, FAILED, LIVE, formatRelative } from "../utils/format";

type RunFilter = "all" | "running" | "done" | "failed" | "pr";

const RUN_FILTERS: Array<{ key: RunFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "done", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "pr", label: "PR open" },
];

function runPill(run: RunSummary) {
  if (LIVE.has(run.status)) {
    if (run.status === "queued")
      return <span className="pill pill-queued">queued</span>;
    return <span className="pill pill-running">running · {run.stage}</span>;
  }
  if (FAILED.has(run.status))
    return (
      <span className="pill pill-err">
        {run.status === "needs_human" ? "needs review" : "failed"}
      </span>
    );
  if (DONE.has(run.status)) return <span className="pill pill-ok">completed</span>;
  return <span className="pill pill-queued">{run.status || "unknown"}</span>;
}

function indexPill(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "ready") return <span className="pill pill-ok">indexed</span>;
  if (s === "indexing") return <span className="pill pill-running">indexing</span>;
  if (s === "pending" || s === "queued")
    return <span className="pill pill-queued">pending</span>;
  if (s === "failed" || s === "error")
    return <span className="pill pill-err">index failed</span>;
  return <span className="pill pill-queued">{s || "unknown"}</span>;
}

export function RepoPage() {
  const { id } = useParams();
  const repoId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [repo, setRepo] = useState<Repo | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [filter, setFilter] = useState<RunFilter>("all");
  const [query, setQuery] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [runningIssue, setRunningIssue] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(repoId) || repoId <= 0) {
      throw new Error("Invalid repository id");
    }
    const [r, rs, idx] = await Promise.all([
      api.getRepo(repoId),
      api.listRuns({ repo_id: repoId }),
      api.indexStatus(repoId).catch(() => null),
    ]);
    setRepo(r);
    setRuns(rs);
    setIndexStatus(idx);
  }, [repoId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const counts = useMemo(() => {
    const live = runs.filter((r) => LIVE.has(r.status)).length;
    const failed = runs.filter((r) => FAILED.has(r.status)).length;
    const prs = runs.filter((r) => !!r.pr_url).length;
    return { total: runs.length, live, failed, prs };
  }, [runs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((r) => {
      const fMatch =
        filter === "all"
          ? true
          : filter === "running"
            ? LIVE.has(r.status)
            : filter === "done"
              ? DONE.has(r.status)
              : filter === "failed"
                ? FAILED.has(r.status)
                : !!r.pr_url;
      const hay = `#${r.issue_number} ${r.issue_title} ${r.status} ${r.stage} ${r.branch_name}`.toLowerCase();
      return fMatch && (q ? hay.includes(q) : true);
    });
  }, [runs, filter, query]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      toast("Looking for open issues…");
      const result = await api.syncIssues(repoId);
      if (result.created.length) {
        toast(`Queued ${result.created.length} run(s)`);
      } else {
        toast(
          result.fetched ? "No new open issues to pick up" : "No open issues found",
        );
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setSyncing(false);
    }
  }

  async function handleReindex() {
    setReindexing(true);
    setError(null);
    try {
      toast("Reindexing repository…");
      await api.reindex(repoId);
      toast("Reindex queued");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setReindexing(false);
    }
  }

  async function handleRunIssue() {
    const num = Number(issueNumber);
    if (!Number.isInteger(num) || num <= 0) {
      toast("Enter an issue number, e.g. 42");
      return;
    }
    setRunningIssue(true);
    setError(null);
    try {
      toast(`Starting agent on issue #${num}…`);
      const res = await api.runIssue(repoId, num);
      setIssueNumber("");
      navigate(`/runs/${res.run_id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setRunningIssue(false);
    }
  }

  async function handleCopy() {
    if (!repo?.clone_url) return;
    try {
      await navigator.clipboard.writeText(repo.clone_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast("Could not copy to clipboard");
    }
  }

  const indexNow = indexStatus?.status || repo?.index_status || "";

  if (loading)
    return (
      <div className="px-8 py-7">
        <p className="py-16 text-center text-muted">Loading repository…</p>
      </div>
    );

  if (error || !repo)
    return (
      <div className="px-8 py-7">
        <div className="mx-auto max-w-[720px]">
          <div className="rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">
            {error || "Repository not found"}
          </div>
          <div className="mt-4">
            <Link to="/repos" className="font-semibold text-accent-ink hover:underline">
              ← Back to repositories
            </Link>
          </div>
        </div>
      </div>
    );

  const statsEntries = Object.entries(
    (indexStatus?.stats || repo?.index_stats) as Record<string, unknown>,
  ).slice(0, 4);

  return (
    <div className="min-w-0">
      <TopbarShell
        crumb={
          <Crumb
            items={[{ href: "/repos", label: "Repositories" }]}
            current={repo.owner}
          />
        }
        title={
          <span className="flex items-center gap-2.5">
            {repo.name}
            {indexPill(indexNow)}
          </span>
        }
        titleSuffix={
          <span className="font-mono text-[12px] font-normal normal-case text-faint">
            {repo.owner}/{repo.name} · {repo.default_branch || "main"}
          </span>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={reindexing || syncing}
              onClick={() => void handleReindex()}
            >
              <SyncIcon size={16} className={reindexing ? "animate-spin" : undefined} />
              {reindexing ? "Indexing…" : "Reindex"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncing || reindexing}
              onClick={() => void handleSync()}
            >
              <SyncIcon size={16} className={syncing ? "animate-spin" : undefined} />
              {syncing ? "Syncing…" : "Sync issues"}
            </button>
          </>
        }
      />

      <div className="px-8 py-7 max-[720px]:px-4">
        <div className="mx-auto max-w-[1280px]">
          {error && (
            <div className="mb-4 rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">
              {error}
            </div>
          )}

          {/* Summary strip */}
          <div className="mb-5 grid grid-cols-2 gap-3.5 max-[640px]:grid-cols-1 lg:grid-cols-4">
            <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
              <div className="grid size-[38px] flex-none place-items-center rounded-[9px] bg-accent-soft text-accent-ink">
                <IssueIcon size={18} />
              </div>
              <div>
                <div className="font-mono text-[22px] font-semibold tracking-tight">
                  {counts.total}
                </div>
                <div className="text-[12.5px] text-muted">agent runs</div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
              <div className="grid size-[38px] flex-none place-items-center rounded-[9px] bg-info-soft text-info-ink">
                <BoltIcon size={18} />
              </div>
              <div>
                <div className="font-mono text-[22px] font-semibold tracking-tight">
                  {counts.live}
                </div>
                <div className="text-[12.5px] text-muted">running / queued</div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
              <div className="grid size-[38px] flex-none place-items-center rounded-[9px] bg-warn-soft text-warn-ink">
                <ClockIcon size={18} />
              </div>
              <div>
                <div className="font-mono text-[22px] font-semibold tracking-tight">
                  {counts.prs}
                </div>
                <div className="text-[12.5px] text-muted">PRs open</div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
              <div className="grid size-[38px] flex-none place-items-center rounded-[9px] bg-danger-soft text-danger-ink">
                <RepoIcon size={18} />
              </div>
              <div>
                <div className="font-mono text-[22px] font-semibold tracking-tight">
                  {counts.failed}
                </div>
                <div className="text-[12.5px] text-muted">need attention</div>
              </div>
            </div>
          </div>

          {/* Repo + Index cards */}
          <div className="mb-5 grid gap-3.5 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-5">
              <div className="mb-3.5 flex items-center gap-2.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">
                  Repository
                </span>
                <span className="ml-auto font-mono text-[11.5px] text-faint">
                  id · {repo.id}
                </span>
              </div>
              <div className="space-y-2.5 font-mono text-[12.5px]">
                <div className="flex items-center gap-2.5">
                  <span className="w-24 flex-none text-faint">clone</span>
                  <span className="min-w-0 flex-1 truncate" title={repo.clone_url}>
                    {repo.clone_url}
                  </span>
                  <button
                    type="button"
                    aria-label="Copy clone URL"
                    onClick={() => void handleCopy()}
                    className={`grid size-8 flex-none place-items-center rounded-md text-faint transition-colors hover:bg-canvas hover:text-ink ${
                      copied ? "!text-accent-ink" : ""
                    }`}
                  >
                    <CopyIcon size={15} />
                  </button>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-24 flex-none text-faint">path</span>
                  <span className="min-w-0 flex-1 truncate" title={repo.workspace_path}>
                    {repo.workspace_path}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-24 flex-none text-faint">branch</span>
                  <span>{repo.default_branch || "main"}</span>
                  <span className="ml-auto font-sans text-[11.5px] text-faint">
                    connected {formatRelative(repo.created_at)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface p-5">
              <div className="mb-3.5 flex items-center gap-2.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">
                  Index
                </span>
                <span className="ml-auto">{indexPill(indexNow)}</span>
              </div>
              <div className="mb-3 flex items-center gap-2.5 font-mono text-[12.5px]">
                <span className="flex-none text-faint">last indexed</span>
                <span>
                  {formatRelative(indexStatus?.last_indexed_at || repo.last_indexed_at)}
                </span>
              </div>
              {statsEntries.length > 0 ? (
                <div className="mb-4 grid grid-cols-2 gap-2">
                  {statsEntries.map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded-lg border border-line bg-canvas px-3 py-2.5"
                    >
                      <div className="font-mono text-[15px] font-semibold tracking-tight">
                        {String(v ?? "—")}
                      </div>
                      <div className="truncate text-[11.5px] capitalize text-faint">
                        {k.replace(/[_-]+/g, " ")}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-4 text-[12.5px] text-muted">
                  No index statistics yet.
                </p>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={reindexing}
                onClick={() => void handleReindex()}
              >
                <SyncIcon size={16} className={reindexing ? "animate-spin" : undefined} />
                {reindexing ? "Indexing…" : "Reindex"}
              </button>
            </div>
          </div>

          {/* Runs */}
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
              <div className="flex flex-wrap gap-2">
                {RUN_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
                      filter === f.key
                        ? "border-ink bg-ink text-surface"
                        : "border-line text-muted hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <SearchBox
                placeholder="Search runs…"
                value={query}
                onChange={setQuery}
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  placeholder="# issue"
                  value={issueNumber}
                  onChange={(e) => setIssueNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRunIssue();
                  }}
                  className="h-[44px] w-[110px] rounded-lg border border-line bg-surface px-3 font-mono text-[13px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
                  aria-label="Issue number to run"
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={runningIssue}
                  onClick={() => void handleRunIssue()}
                >
                  <PlayIcon size={15} />
                  {runningIssue ? "Starting…" : "Run"}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    {["Issue", "Agent stage", "Status", "Branch", "PR", "Started", "Action"].map(
                      (h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap border-b border-line px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-faint"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-14 text-center">
                        <div className="mx-auto flex max-w-[340px] flex-col items-center gap-2">
                          <span className="grid size-11 place-items-center rounded-xl border border-line bg-canvas text-muted">
                            <IssueIcon size={20} />
                          </span>
                          <p className="mt-1 text-[13.5px] font-semibold">
                            No runs yet
                          </p>
                          <p className="text-[12.5px] leading-relaxed text-muted">
                            {query || filter !== "all"
                              ? "Nothing matches this filter."
                              : "Sync open issues from GitHub, or point the agent at a specific issue number."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {visible.map((r) => (
                    <tr key={r.id} className="hover:bg-canvas [&:last-child_td]:border-b-0">
                      <td className="px-4 py-3">
                        <Link
                          to={`/runs/${r.id}`}
                          className="flex min-w-0 items-center gap-2.5 hover:opacity-90"
                        >
                          <span className="grid size-7 flex-none place-items-center rounded-md border border-line bg-canvas font-mono text-[11px] font-semibold text-muted">
                            #{r.issue_number}
                          </span>
                          <span className="min-w-0 truncate font-medium">
                            {r.issue_title}
                          </span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-muted">
                        {r.stage || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{runPill(r)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono">
                        {r.branch_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {r.pr_url ? (
                          <a
                            href={r.pr_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-accent-ink hover:underline"
                          >
                            PR →
                          </a>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-muted">
                        {formatRelative(r.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link
                          to={`/runs/${r.id}`}
                          className="font-semibold text-accent-ink hover:underline"
                        >
                          open →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}