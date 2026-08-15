import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RunSummary } from "../api/client";
import {
  BoltIcon,
  ClockIcon,
  IssueIcon,
  RepoIcon,
  SyncIcon,
} from "../components/icons";
import { Crumb, SearchBox, TopbarShell } from "../components/Topbar";
import { useToast } from "../components/Toast";
import { AWAITING, DISCARDED, DONE, FAILED, LIVE, formatRelative } from "../utils/format";

type RunFilter = "all" | "running" | "queued" | "done" | "failed" | "pr" | "awaiting";

const RUN_FILTERS: Array<{ key: RunFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "queued", label: "Queued" },
  { key: "awaiting", label: "Awaiting push" },
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
  if (AWAITING.has(run.status))
    return <span className="pill pill-queued">awaiting push</span>;
  if (DISCARDED.has(run.status))
    return <span className="pill pill-off">discarded</span>;
  if (FAILED.has(run.status))
    return (
      <span className="pill pill-err">
        {run.status === "needs_human" ? "needs review" : "failed"}
      </span>
    );
  if (DONE.has(run.status)) return <span className="pill pill-ok">completed</span>;
  return <span className="pill pill-queued">{run.status || "unknown"}</span>;
}

type RepoGroup = {
  fullName: string;
  repoId: number;
  runs: RunSummary[];
};

export function IssuesPage() {
  const toast = useToast();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<RunFilter>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setRuns(await api.listRuns());
  }, []);

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

  const matchesFilter = useCallback(
    (r: RunSummary) => {
      switch (filter) {
        case "running":
          return LIVE.has(r.status);
        case "queued":
          return r.status === "queued";
        case "done":
          return DONE.has(r.status);
        case "awaiting":
          return AWAITING.has(r.status);
        case "failed":
          return FAILED.has(r.status);
        case "pr":
          return !!r.pr_url;
        default:
          return true;
      }
    },
    [filter],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byRepo = new Map<number, RepoGroup>();
    for (const r of runs) {
      if (!matchesFilter(r)) continue;
      const hay = `#${r.issue_number} ${r.issue_title} ${r.status} ${r.stage} ${r.branch_name} ${r.repo_full_name || ""}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      let g = byRepo.get(r.repo_id);
      if (!g) {
        g = {
          fullName: r.repo_full_name || `repo#${r.repo_id}`,
          repoId: r.repo_id,
          runs: [],
        };
        byRepo.set(r.repo_id, g);
      }
      g.runs.push(r);
    }
    return [...byRepo.values()]
      .map((g) => {
        g.runs.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        return g;
      })
      .sort(
        (a, b) =>
          new Date(b.runs[0].created_at).getTime() -
          new Date(a.runs[0].created_at).getTime(),
      );
  }, [runs, filter, matchesFilter, query]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      toast("Syncing repositories…");
      let created = 0;
      for (const r of runs) {
        try {
          created += (await api.syncIssues(r.repo_id)).created.length;
        } catch {
          // keep going for other repos
        }
      }
      await load();
      toast(
        created
          ? `Sync complete · ${created} new run(s) queued`
          : "Sync complete · repositories up to date",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="min-w-0">
      <TopbarShell
        crumb={
          <Crumb items={[]} current="Issues" />
        }
        title={
          <span className="flex items-center gap-3">
            Issues
            <span className="pill pill-queued">{counts.total}</span>
          </span>
        }
        titleSuffix={
          counts.live > 0 ? (
            <span className="pill pill-running">{counts.live} in flight</span>
          ) : undefined
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={loading}
              onClick={() => void load()}
            >
              <SyncIcon size={16} />
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncing || loading}
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
                  {loading ? "—" : counts.total}
                </div>
                <div className="text-[12.5px] text-muted">issues tracked</div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
              <div className="grid size-[38px] flex-none place-items-center rounded-[9px] bg-info-soft text-info-ink">
                <BoltIcon size={18} />
              </div>
              <div>
                <div className="font-mono text-[22px] font-semibold tracking-tight">
                  {loading ? "—" : counts.live}
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
                  {loading ? "—" : counts.prs}
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
                  {loading ? "—" : counts.failed}
                </div>
                <div className="text-[12.5px] text-muted">need attention</div>
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
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
              placeholder="Search issues…"
              value={query}
              onChange={setQuery}
            />
          </div>

          {/* Groups */}
          {loading ? (
            <div className="rounded-xl border border-line bg-surface px-4 py-14 text-center text-muted">
              Loading issues…
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface px-4 py-14 text-center">
              <div className="mx-auto flex max-w-[360px] flex-col items-center gap-2">
                <span className="grid size-11 place-items-center rounded-xl border border-line bg-canvas text-muted">
                  <IssueIcon size={20} />
                </span>
                <p className="mt-1 text-[13.5px] font-semibold">
                  {query || filter !== "all" ? "Nothing matches this filter." : "No issues yet"}
                </p>
                <p className="text-[12.5px] leading-relaxed text-muted">
                  {query || filter !== "all"
                    ? "Try a different filter or search term."
                    : "Sync open issues from GitHub to start the agent on them."}
                </p>
                {!(query || filter !== "all") && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-2"
                    disabled={syncing}
                    onClick={() => void handleSync()}
                  >
                    <SyncIcon size={16} className={syncing ? "animate-spin" : undefined} />
                    {syncing ? "Syncing…" : "Sync issues"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div
                  key={g.fullName}
                  className="overflow-hidden rounded-xl border border-line bg-surface"
                >
                  <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
                    <Link
                      to={`/repos/${g.repoId}`}
                      className="group flex min-w-0 items-center gap-2.5"
                    >
                      <span className="grid size-8 flex-none place-items-center rounded-lg border border-line bg-canvas text-muted">
                        <RepoIcon size={16} />
                      </span>
                      <span className="min-w-0">
                        <b className="block truncate font-semibold group-hover:opacity-80">
                          {g.fullName}
                        </b>
                        <span className="block text-[12px] text-faint">
                          {g.runs.length} issue{g.runs.length === 1 ? "" : "s"}
                        </span>
                      </span>
                    </Link>
                    <Link
                      to={`/repos/${g.repoId}`}
                      className="ml-auto text-[12.5px] font-semibold text-accent-ink hover:underline"
                    >
                      view repo →
                    </Link>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13.5px]">
                      <tbody>
                        {g.runs.map((r) => (
                          <tr
                            key={r.id}
                            className="hover:bg-canvas [&:last-child_td]:border-b-0"
                          >
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
                            <td className="whitespace-nowrap px-4 py-3">
                              {runPill(r)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-muted">
                              {formatRelative(r.created_at)}
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}