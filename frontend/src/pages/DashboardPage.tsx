import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type Repo,
  type RunDetail,
  type RunSummary,
} from "../api/client";
import {
  BoltIcon,
  BrowseIcon,
  CheckIcon,
  ClockIcon,
  IssueIcon,
  LogsIcon,
  PlusIcon,
  RepoIcon,
} from "../components/icons";
import { SearchBox, TopbarShell } from "../components/Topbar";
import {
  LIVE,
  DONE,
  FAILED,
  AWAITING,
  DISCARDED,
  formatRelative,
  formatClock,
  formatDuration,
  formatDurationShort,
} from "../utils/format";

const PIPELINE = [
  "queued",
  "clone",
  "branch",
  "index",
  "pm",
  "architecture",
  "planner",
  "develop",
  "review",
  "awaiting_push",
  "gitops",
  "done",
] as const;

const DOTS = [
  "bg-[oklch(72%_0.15_150)]",
  "bg-[oklch(78%_0.14_210)]",
  "bg-[oklch(72%_0.12_25)]",
  "bg-[oklch(80%_0.13_90)]",
  "bg-[oklch(75%_0.1_60)]",
  "bg-[oklch(78%_0.14_220)]",
];

type FeedKind = "act" | "ok" | "err" | "plain";

type FeedItem = {
  id: string;
  kind: FeedKind;
  title: string;
  href: string;
  meta: string;
};

function repoShort(full?: string | null): string {
  if (!full) return "repo";
  const parts = full.split("/");
  return parts[parts.length - 1] || full;
}

function stageProgress(stage: string): { now: number; total: number; pct: number } {
  const total = PIPELINE.length;
  const idx = PIPELINE.indexOf(stage as (typeof PIPELINE)[number]);
  const now = idx < 0 ? 1 : Math.min(idx + 1, total);
  return { now, total, pct: Math.round((now / total) * 100) };
}

function runUiStatus(status: string): "running" | "ok" | "err" | "awaiting" | "off" {
  if (LIVE.has(status)) return "running";
  if (AWAITING.has(status)) return "awaiting";
  if (DISCARDED.has(status)) return "off";
  if (FAILED.has(status)) return "err";
  return "ok";
}

function runStatusText(run: RunSummary): string {
  if (LIVE.has(run.status)) return run.status === "queued" ? "queued" : `running · ${run.stage}`;
  if (AWAITING.has(run.status)) return "awaiting push";
  if (DISCARDED.has(run.status)) return "discarded";
  if (FAILED.has(run.status)) return run.status === "needs_human" ? "needs review" : "failed · retry";
  if (run.pr_url) {
    const m = run.pr_url.match(/\/pull\/(\d+)/);
    return m ? `PR · #${m[1]}` : "completed · PR";
  }
  return "completed";
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function eventKind(stage: string, message: string): FeedKind {
  const s = stage.toLowerCase();
  const m = message.toLowerCase();
  if (s === "failed" || s === "needs_human" || m.includes("fail")) return "err";
  if (s === "done" || m.includes("pr opened") || m.includes("complete")) return "ok";
  if (["pm", "architecture", "planner", "develop", "review", "branch", "gitops"].includes(s)) return "act";
  return "plain";
}

function buildFeedSorted(details: RunDetail[]): FeedItem[] {
  type Row = FeedItem & { at: number };
  const items: Row[] = [];
  for (const run of details) {
    const href = `/runs/${run.id}`;
    const label = `${run.repo_full_name || "repo"}#${run.issue_number}`;
    for (const ev of run.events || []) {
      items.push({
        id: `${run.id}-${ev.id}`,
        kind: eventKind(ev.stage, ev.message),
        title: `${ev.message} · ${label}`,
        href,
        meta: `${formatRelative(ev.created_at)} · ${ev.stage}`,
        at: new Date(ev.created_at).getTime() || 0,
      });
    }
  }
  items.sort((a, b) => b.at - a.at);
  return items.slice(0, 12).map(({ at: _at, ...rest }) => rest);
}

type StatusFilter = "all" | "running" | "failed" | "needs_human" | "awaiting_push" | "completed";

function matchesStatusFilter(run: RunSummary, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return LIVE.has(run.status);
  if (filter === "failed") return run.status === "failed" || run.status === "error";
  if (filter === "needs_human") return run.status === "needs_human" || AWAITING.has(run.status);
  if (filter === "awaiting_push") return AWAITING.has(run.status);
  if (filter === "completed") return DONE.has(run.status);
  return true;
}

export function DashboardPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [details, setDetails] = useState<RunDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [feedLimit, setFeedLimit] = useState(4);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [repoList, runList] = await Promise.all([api.listRepos(), api.listRuns()]);
    setRepos(repoList);
    setRuns(runList);

    const forDetail = runList.slice(0, 5);
    const detailed = await Promise.all(
      forDetail.map((r) => api.getRun(r.id).catch(() => null)),
    );
    setDetails(detailed.filter((d): d is RunDetail => !!d));
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

  // Light poll while anything is live
  const hasLive = runs.some((r) => LIVE.has(r.status));
  useEffect(() => {
    if (!hasLive) return;
    const id = window.setInterval(() => {
      void load().catch(() => {});
    }, 3000);
    return () => window.clearInterval(id);
  }, [hasLive, load]);

  useEffect(() => {
    if (!hasLive) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [hasLive]);

  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const runsThisWeek = runs.filter((r) => new Date(r.created_at).getTime() >= weekAgo);
  const finishedWeek = runsThisWeek.filter((r) => DONE.has(r.status) || FAILED.has(r.status));
  const passedWeek = finishedWeek.filter((r) => DONE.has(r.status));
  const passRate = finishedWeek.length
    ? Math.round((passedWeek.length / finishedWeek.length) * 100)
    : null;

  const activeRuns = runs.filter((r) => LIVE.has(r.status));
  const readyRepos = repos.filter((r) => (r.index_status || "").toLowerCase() === "ready");

  const cycleMs = median(
    runs
      .filter((r) => DONE.has(r.status))
      .map((r) => {
        const a = new Date(r.created_at).getTime();
        const b = new Date(r.updated_at).getTime();
        return Number.isNaN(a) || Number.isNaN(b) || b < a ? null : b - a;
      })
      .filter((n): n is number => n != null),
  );

  const feed = useMemo(() => buildFeedSorted(details), [details]);
  const visibleFeed = feed.slice(0, feedLimit);

  const repoOptions = useMemo(() => {
    const names = new Set<string>();
    for (const r of repos) names.add(r.full_name);
    for (const r of runs) {
      if (r.repo_full_name) names.add(r.repo_full_name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [repos, runs]);

  const recentRows = useMemo(() => {
    const q = query.toLowerCase().trim();
    return runs.filter((r) => {
      if (!matchesStatusFilter(r, statusFilter)) return false;
      if (repoFilter !== "all" && (r.repo_full_name || "") !== repoFilter) return false;
      if (!q) return true;
      const hay = `${r.id} ${r.repo_full_name || ""} ${r.issue_title} ${r.status} ${r.stage} #${r.issue_number}`;
      return hay.toLowerCase().includes(q);
    });
  }, [runs, query, statusFilter, repoFilter]);

  const lastRun = runs[0];

  return (
    <div className="min-w-0">
      <TopbarShell
        crumb={
          <span className="text-[12.5px] text-muted">
            Home <span className="mx-1.5 text-faint">/</span> Dashboard
          </span>
        }
        title="Overview"
        actions={
          <>
            <SearchBox
              placeholder="Search runs, repos, issues…"
              value={query}
              onChange={setQuery}
            />
            <Link to="/repos" className="btn btn-primary">
              <PlusIcon size={16} />
              <span>New run</span>
            </Link>
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

          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3.5 max-[1080px]:grid-cols-2 max-[560px]:grid-cols-1">
            <div className="rounded-xl border border-line bg-surface p-[18px]">
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <RepoIcon size={15} className="text-faint" /> Repos watched
              </div>
              <div className="mt-2.5 font-mono text-[27px] font-semibold tracking-tight">
                {loading ? "—" : repos.length}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-accent-ink">
                <span className="relative h-2 w-11 flex-none overflow-hidden rounded-[3px] bg-accent-soft">
                  <span
                    className="absolute inset-y-0 left-0 rounded-[inherit] bg-accent"
                    style={{
                      width: `${repos.length ? Math.round((readyRepos.length / repos.length) * 100) : 0}%`,
                    }}
                  />
                </span>
                {readyRepos.length} indexed
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface p-[18px]">
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <BoltIcon size={15} className="text-faint" /> Runs this week
              </div>
              <div className="mt-2.5 font-mono text-[27px] font-semibold tracking-tight">
                {loading ? "—" : runsThisWeek.length}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-accent-ink">
                <span className="relative h-2 w-11 flex-none overflow-hidden rounded-[3px] bg-accent-soft">
                  <span
                    className="absolute inset-y-0 left-0 rounded-[inherit] bg-accent"
                    style={{ width: `${passRate ?? 0}%` }}
                  />
                </span>
                {passRate == null ? "no finished runs" : `${passRate}% passed`}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface p-[18px]">
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <IssueIcon size={15} className="text-faint" /> Active runs
              </div>
              <div className="mt-2.5 font-mono text-[27px] font-semibold tracking-tight">
                <span className="text-info-ink">{loading ? "—" : activeRuns.length}</span>{" "}
                <span className="text-[15px] font-normal text-muted">
                  / {Math.max(activeRuns.length, runs.length, 1)}
                </span>
              </div>
              <div className="mt-1.5 truncate text-xs text-info-ink">
                {activeRuns.length
                  ? activeRuns
                      .slice(0, 3)
                      .map((r) => `#${r.issue_number}`)
                      .join(" · ")
                  : "none live"}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-surface p-[18px]">
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <ClockIcon size={15} className="text-faint" /> Median cycle time
              </div>
              <div className="mt-2.5 font-mono text-[27px] font-semibold tracking-tight">
                {loading ? "—" : cycleMs != null ? formatDurationShort(cycleMs) : "—"}
              </div>
              <div className="mt-1.5 text-xs text-accent-ink">
                across completed runs
              </div>
            </div>
          </div>

          <div className="mt-9 grid grid-cols-[1.35fr_1fr] items-start gap-4 max-[1020px]:grid-cols-1">
            {/* Active runs */}
            <section>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-semibold tracking-tight">Active runs</h2>
                  <p className="mt-0.5 text-[13px] text-muted">Live progress from the agent loop.</p>
                </div>
                <Link to={lastRun ? `/runs/${lastRun.id}` : "/issue"} className="btn btn-ghost btn-sm">
                  View issue
                </Link>
              </div>

              <div className="grid gap-2.5">
                {loading && (
                  <div className="rounded-xl border border-line bg-surface p-6 text-[13px] text-muted">
                    Loading active runs…
                  </div>
                )}
                {!loading && activeRuns.length === 0 && (
                  <div className="rounded-xl border border-line bg-surface p-6 text-[13px] text-muted">
                    No active runs. Sync issues from a repository to queue one.
                  </div>
                )}
                {activeRuns.map((r) => {
                  const prog = stageProgress(r.stage);
                  const elapsedSec = Math.max(
                    0,
                    Math.floor((now - new Date(r.created_at).getTime()) / 1000),
                  );
                  const detail = details.find((d) => d.id === r.id);
                  const lastMsg =
                    detail?.events?.[detail.events.length - 1]?.message ||
                    `Stage · ${r.stage}`;
                  return (
                    <Link
                      key={r.id}
                      to={`/runs/${r.id}`}
                      className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong"
                    >
                      <div className="mb-2.5 flex min-w-0 items-center gap-2.5">
                        <span className="whitespace-nowrap font-mono text-[13px] font-semibold">
                          {r.repo_full_name || `repo#${r.repo_id}`}
                        </span>
                        <span className="truncate text-[12.5px] text-muted">
                          #{r.issue_number} · {r.issue_title}
                        </span>
                        <span className="ml-auto flex flex-none items-center gap-1.5 text-[11px] uppercase tracking-[0.05em] text-faint">
                          <BoltIcon size={13} /> run-{r.id}
                        </span>
                      </div>
                      <div className="mb-2 flex items-center gap-2.5 text-[13px]">
                        <span className="size-3.5 flex-none rounded-full border-2 border-info-soft border-t-info animate-spin" />
                        <span className="truncate">{lastMsg}</span>
                      </div>
                      <div className="mb-3 flex flex-wrap gap-x-4.5 gap-y-1 text-xs text-muted">
                        <span>
                          step{" "}
                          <b className="font-mono font-semibold text-ink">
                            {prog.now}/{prog.total}
                          </b>
                        </span>
                        <span>
                          elapsed{" "}
                          <b className="font-mono font-semibold text-ink">
                            {Math.floor(elapsedSec / 60)}:
                            {String(elapsedSec % 60).padStart(2, "0")}
                          </b>
                        </span>
                        <span>
                          status{" "}
                          <b className="font-mono font-semibold text-ink">{r.status}</b>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
                        <div
                          className="h-full rounded-full bg-info transition-[width] duration-700"
                          style={{ width: `${prog.pct}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>

            {/* Activity feed */}
            <section>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-semibold tracking-tight">Activity feed</h2>
                  <p className="mt-0.5 text-[13px] text-muted">Every update, surfaced with context.</p>
                </div>
              </div>

              <div className="grid overflow-hidden rounded-xl border border-line bg-line">
                {loading && (
                  <div className="bg-surface p-6 text-center text-[13px] text-muted">
                    Loading activity…
                  </div>
                )}
                {!loading && visibleFeed.length === 0 && (
                  <div className="bg-surface p-6 text-center text-[13px] text-muted">
                    No activity yet.
                  </div>
                )}
                {visibleFeed.map((f) => {
                  const ic =
                    f.kind === "ok"
                      ? "ok"
                      : f.kind === "err"
                        ? "err"
                        : f.kind === "act"
                          ? "act"
                          : "plain";
                  return (
                    <div key={f.id} className="flex gap-3 bg-surface p-3.5">
                      <div
                        className={`grid size-[34px] flex-none place-items-center rounded-lg border ${
                          ic === "ok"
                            ? "border-accent-soft-line bg-accent-soft"
                            : ic === "err"
                              ? "border-transparent bg-danger-soft"
                              : ic === "act"
                                ? "border-transparent bg-info-soft"
                                : "border-line bg-canvas"
                        }`}
                      >
                        {f.kind === "ok" ? (
                          <CheckIcon size={17} className="text-accent-ink" />
                        ) : f.kind === "err" ? (
                          <BrowseIcon size={17} className="text-danger-ink" />
                        ) : f.kind === "act" ? (
                          <IssueIcon size={17} className="text-info-ink" />
                        ) : (
                          <LogsIcon size={17} className="text-muted" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] leading-[1.45]">
                          <Link
                            to={f.href}
                            className="font-semibold text-ink hover:text-accent-ink hover:underline"
                          >
                            {f.title}
                          </Link>
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-faint">{f.meta}</div>
                      </div>
                    </div>
                  );
                })}
                {!loading && feed.length > feedLimit && (
                  <div className="bg-surface p-3 text-center">
                    <button
                      type="button"
                      className="text-[13px] font-semibold text-muted hover:text-ink hover:underline"
                      onClick={() => setFeedLimit((n) => n + 4)}
                    >
                      Load more activity →
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Recent runs */}
          <section className="mt-9">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-[16px] font-semibold tracking-tight">Recent runs</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  Cross-run history — open a run to see its event log and agent outputs.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">
                  <span className="text-faint">Status</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    className="bg-transparent font-semibold text-ink outline-none"
                  >
                    <option value="all">All</option>
                    <option value="running">Running</option>
                    <option value="failed">Failed</option>
                    <option value="needs_human">Needs review</option>
                    <option value="awaiting_push">Awaiting push</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-muted">
                  <span className="text-faint">Repo</span>
                  <select
                    value={repoFilter}
                    onChange={(e) => setRepoFilter(e.target.value)}
                    className="max-w-[200px] bg-transparent font-semibold text-ink outline-none"
                  >
                    <option value="all">All repos</option>
                    {repoOptions.map((name) => (
                      <option key={name} value={name}>
                        {repoShort(name)}
                      </option>
                    ))}
                  </select>
                </label>
                {lastRun ? (
                  <Link to={`/runs/${lastRun.id}`} className="btn btn-ghost btn-sm">
                    Open last run
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13.5px]">
                  <thead>
                    <tr>
                      {["Run", "Project", "Status", "Started", "Duration", "Output"].map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap border-b border-line px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-faint"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-muted">
                          Loading runs…
                        </td>
                      </tr>
                    )}
                    {!loading && recentRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-muted">
                          {runs.length === 0
                            ? "No runs yet. Connect a repo and sync open issues."
                            : statusFilter !== "all" || repoFilter !== "all" || query.trim()
                              ? "No runs match these filters."
                              : "No runs match that search."}
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      recentRows.map((r, i) => {
                        const ui = runUiStatus(r.status);
                        const detail = details.find((d) => d.id === r.id);
                        const end =
                          detail?.finished_at ||
                          (DONE.has(r.status) || FAILED.has(r.status) ? r.updated_at : null);
                        const outputLabel = r.pr_url
                          ? "PR →"
                          : FAILED.has(r.status)
                            ? "view log →"
                            : "view →";
                        return (
                          <tr key={r.id} className="hover:bg-canvas [&:last-child_td]:border-b-0">
                            <td className="whitespace-nowrap px-4 py-3 font-mono">
                              <Link
                                to={`/runs/${r.id}`}
                                className="font-semibold text-ink hover:text-accent-ink hover:underline"
                              >
                                {r.id}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <span className="flex items-center gap-2">
                                <span
                                  className={`size-2.5 flex-none rounded-[3px] ${DOTS[i % DOTS.length]}`}
                                />
                                {repoShort(r.repo_full_name)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <span
                                className={`pill ${
                                  ui === "running"
                                    ? "pill-running"
                                    : ui === "ok"
                                      ? "pill-ok"
                                      : ui === "awaiting"
                                        ? "pill-queued"
                                        : ui === "off"
                                          ? "pill-off"
                                          : "pill-err"
                                }`}
                              >
                                {runStatusText(r)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-mono">
                              {formatClock(r.created_at)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-mono">
                              {formatDuration(r.created_at, end)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              {r.pr_url ? (
                                <a
                                  href={r.pr_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-semibold text-accent-ink hover:underline"
                                >
                                  {outputLabel}
                                </a>
                              ) : (
                                <Link
                                  to={`/runs/${r.id}`}
                                  className="font-semibold text-accent-ink hover:underline"
                                >
                                  {outputLabel}
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
