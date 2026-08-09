import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Repo as ApiRepo, type RunSummary } from "../api/client";
import { BoltIcon, ClockIcon, PlusIcon, RepoIcon, SyncIcon } from "../components/icons";
import { SearchBox, TopbarShell } from "../components/Topbar";
import { useToast } from "../components/Toast";

type FilterKey = "all" | "running" | "queued" | "attention" | "off";
type SortKey = "recent" | "name" | "lastRun";
type RowStatus = "running" | "attention" | "ok" | "queued" | "off";

type RepoRow = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  branch: string;
  indexStatus: string;
  status: RowStatus;
  statusText: string;
  lastRunAt: string | null;
  lastRunLabel: string;
  prs: number;
  agentOn: boolean;
  latestRunId: number | null;
};

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "queued", label: "Queued" },
  { key: "attention", label: "Attention" },
  { key: "off", label: "Not ready" },
];

function statusPill(status: RowStatus, text: string) {
  const cls =
    status === "running"
      ? "pill-running"
      : status === "attention"
        ? "pill-err"
        : status === "queued"
          ? "pill-queued"
          : status === "off"
            ? "pill-off"
            : "pill-ok";
  return <span className={`pill ${cls}`}>{text}</span>;
}

function parseRepoInput(raw: string): { owner: string; name: string } | null {
  const trimmed = raw.trim().replace(/\.git$/i, "");
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (urlMatch) {
    return { owner: urlMatch[1], name: urlMatch[2].replace(/\.git$/i, "") };
  }

  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 2) return { owner: parts[0], name: parts[1] };
  return null;
}

function formatRelative(iso: string | null | undefined): string {
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

function indexLabel(status: string): string {
  switch (status) {
    case "ready":
      return "Indexed";
    case "pending":
      return "Pending";
    case "indexing":
      return "Indexing";
    case "failed":
    case "error":
      return "Index failed";
    default:
      return status || "Unknown";
  }
}

function deriveRow(repo: ApiRepo, runs: RunSummary[]): RepoRow {
  const repoRuns = runs.filter((r) => r.repo_id === repo.id);
  const latest = repoRuns[0] ?? null; // API returns newest-first
  const prs = repoRuns.filter((r) => !!r.pr_url).length;
  const index = (repo.index_status || "").toLowerCase();

  let status: RowStatus = "ok";
  let statusText = "idle";

  if (latest?.status === "running") {
    status = "running";
    statusText = `running · ${latest.stage}`;
  } else if (latest?.status === "queued") {
    status = "queued";
    statusText = "queued";
  } else if (latest?.status === "failed" || latest?.status === "error") {
    status = "attention";
    statusText = "failed · retry";
  } else if (index === "failed" || index === "error") {
    status = "attention";
    statusText = "index failed";
  } else if (index === "pending" || index === "indexing") {
    status = "queued";
    statusText = index === "indexing" ? "indexing" : "queued";
  } else if (index && index !== "ready") {
    status = "off";
    statusText = indexLabel(index);
  } else if (latest?.status === "completed" || latest?.status === "done") {
    status = "ok";
    statusText = latest.pr_url ? "idle · PR open" : "idle";
  } else {
    status = index === "ready" ? "ok" : "off";
    statusText = index === "ready" ? "idle" : indexLabel(index || "pending");
  }

  const lastRunAt = latest?.updated_at || repo.last_indexed_at || repo.updated_at || null;

  return {
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.full_name,
    branch: repo.default_branch || "main",
    indexStatus: repo.index_status,
    status,
    statusText,
    lastRunAt,
    lastRunLabel: formatRelative(lastRunAt),
    prs,
    agentOn: index === "ready",
    latestRunId: latest?.id ?? null,
  };
}

export function ReposPage() {
  const toast = useToast();
  const [rows, setRows] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    const [repos, runs] = await Promise.all([
      api.listRepos(),
      api.listRuns().catch(() => [] as RunSummary[]),
    ]);
    setRows(repos.map((r) => deriveRow(r, runs)));
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

  const counts = useMemo(
    () => ({
      all: rows.length,
      running: rows.filter((r) => r.status === "running").length,
      queued: rows.filter((r) => r.status === "queued").length,
      attention: rows.filter((r) => r.status === "attention").length,
      off: rows.filter((r) => r.status === "off").length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => {
      const fMatch =
        filter === "all" ? true : filter === "off" ? r.status === "off" : r.status === filter;
      const hay = `${r.fullName} ${r.name} ${r.owner} ${r.statusText} ${r.indexStatus}`.toLowerCase();
      const qMatch = query ? hay.includes(query.toLowerCase()) : true;
      return fMatch && qMatch;
    });

    const sorted = [...filtered];
    if (sort === "name") {
      sorted.sort((a, b) => a.fullName.localeCompare(b.fullName));
    } else if (sort === "lastRun") {
      sorted.sort((a, b) => {
        const ta = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
        const tb = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
        return tb - ta;
      });
    } else {
      // most recent: prefer lastRunAt, fall back to id
      sorted.sort((a, b) => {
        const ta = a.lastRunAt ? new Date(a.lastRunAt).getTime() : a.id;
        const tb = b.lastRunAt ? new Date(b.lastRunAt).getTime() : b.id;
        return tb - ta;
      });
    }
    return sorted;
  }, [rows, filter, query, sort]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      toast("Syncing repositories…");
      let created = 0;
      for (const row of rows) {
        try {
          const result = await api.syncIssues(row.id);
          created += result.created.length;
        } catch {
          // keep going for other repos
        }
      }
      await load();
      toast(
        created
          ? `Sync complete · ${created} new run(s) queued`
          : `Sync complete · ${rows.length} repo(s) up to date`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setSyncing(false);
    }
  }

  async function addRepo() {
    const parsed = parseRepoInput(url);
    if (!parsed) {
      toast("Enter a repository as owner/name, e.g. acme/api-gateway");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await api.registerRepo({
        owner: parsed.owner,
        name: parsed.name,
      });
      setUrl("");
      setOpen(false);
      toast(`Connected ${parsed.owner}/${parsed.name}`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="min-w-0">
      <TopbarShell
        crumb={
          <span className="text-[12.5px] text-muted">
            Home <span className="mx-1.5 text-faint">/</span> Repositories
          </span>
        }
        title="Repositories"
        actions={
          <>
            <SearchBox placeholder="Search repositories…" value={query} onChange={setQuery} />
            <button
              className="btn btn-ghost btn-sm"
              disabled={syncing || loading}
              onClick={() => void handleSync()}
            >
              <SyncIcon size={16} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button className="btn btn-primary" onClick={() => setOpen(true)}>
              <PlusIcon size={16} />
              Connect repo
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
          <div className="mb-5 grid grid-cols-3 gap-3.5 max-[860px]:grid-cols-1">
            <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
              <div className="grid size-[38px] flex-none place-items-center rounded-[9px] bg-accent-soft text-accent-ink">
                <RepoIcon size={18} />
              </div>
              <div>
                <div className="font-mono text-[22px] font-semibold tracking-tight">
                  {loading ? "—" : rows.length}
                </div>
                <div className="text-[12.5px] text-muted">repos connected</div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
              <div className="grid size-[38px] flex-none place-items-center rounded-[9px] bg-info-soft text-info-ink">
                <BoltIcon size={18} />
              </div>
              <div>
                <div className="font-mono text-[22px] font-semibold tracking-tight">
                  {loading ? "—" : rows.filter((r) => r.agentOn).length}
                </div>
                <div className="text-[12.5px] text-muted">indexed & ready</div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
              <div className="grid size-[38px] flex-none place-items-center rounded-[9px] bg-danger-soft text-danger-ink">
                <ClockIcon size={18} />
              </div>
              <div>
                <div className="font-mono text-[22px] font-semibold tracking-tight">
                  {loading ? "—" : counts.attention}
                </div>
                <div className="text-[12.5px] text-muted">need attention</div>
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
                    filter === f.key
                      ? "border-ink bg-ink text-surface"
                      : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"
                  }`}
                >
                  {f.label}{" "}
                  <span className="font-mono text-[11px] opacity-70">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Sort
              <select
                className="cursor-pointer rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] text-ink"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="recent">Most recent</option>
                <option value="name">Name A–Z</option>
                <option value="lastRun">Last run</option>
              </select>
            </label>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    {["Repository", "Branch", "Index", "Status", "Last run", "Open PRs", "Ready", ""].map(
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
                  {loading && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-muted">
                        Loading repositories…
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    visible.map((r) => (
                      <tr key={r.id} className="hover:bg-canvas [&:last-child_td]:border-b-0">
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5">
                            <span className="grid size-8 flex-none place-items-center rounded-lg border border-line bg-canvas text-muted">
                              <RepoIcon size={16} />
                            </span>
                            <span className="min-w-0">
                              <b className="block font-semibold">{r.name}</b>
                              <span className="block truncate text-[12px] text-faint">{r.owner}</span>
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono">{r.branch}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="text-[13px] text-muted">{indexLabel(r.indexStatus)}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {statusPill(r.status, r.statusText)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono">{r.lastRunLabel}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono">{r.prs}</td>
                        <td className="px-4 py-3">
                          <label className="relative inline-block h-6 w-[42px] flex-none cursor-default opacity-90">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={r.agentOn}
                              readOnly
                              aria-label={r.agentOn ? "Indexed and ready" : "Not ready"}
                            />
                            <span className="tgg absolute inset-0 rounded-full bg-line-strong transition-colors peer-checked:bg-accent" />
                            <span className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-surface shadow transition-transform duration-150 peer-checked:translate-x-[18px]" />
                          </label>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link
                            to={r.latestRunId ? `/runs/${r.latestRunId}` : "/issue"}
                            className="font-semibold text-accent-ink hover:underline"
                          >
                            view →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  {!loading && visible.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-muted">
                        {rows.length === 0
                          ? "No repositories yet. Connect one to get started."
                          : "No repositories match that filter."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Connect dialog */}
      {open && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-ink/35 p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget && !connecting) setOpen(false);
          }}
        >
          <div className="w-full max-w-[440px] rounded-[14px] border border-line bg-surface p-6">
            <h2 className="text-[17px] font-semibold tracking-tight">Connect a repository</h2>
            <p className="mt-1.5 mb-5 text-[13px] text-muted">
              CoCoder will clone the repo and start indexing it.
            </p>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-[12.5px] font-semibold">Repository</span>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !connecting) setOpen(false);
                  if (e.key === "Enter" && !connecting) void addRepo();
                }}
                placeholder="org/repo-name"
                autoFocus
                autoComplete="off"
                disabled={connecting}
                className="min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent disabled:opacity-60"
              />
              <span className="mt-1.5 block font-mono text-[11.5px] text-faint">
                e.g. owner/repo or a github.com URL
              </span>
            </label>
            <div className="mt-2 flex justify-end gap-2.5">
              <button
                className="btn btn-ghost btn-sm"
                disabled={connecting}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={connecting}
                onClick={() => void addRepo()}
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
