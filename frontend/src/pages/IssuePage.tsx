import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type DiffOut, type RunDetail, type RunEvent } from "../api/client";
import {
  AgentOutputDrawer,
  AGENT_META,
  agentNameForStage,
  type AgentOutputs,
} from "../components/AgentOutputView";
import {
  BoltIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  PlayIcon,
  SearchIcon,
  SpinnerIcon,
} from "../components/icons";
import { Markdown } from "../components/Markdown";
import { Crumb, TopbarShell } from "../components/Topbar";
import { useToast } from "../components/Toast";
import { useRunEvents } from "../hooks/useRunEvents";
import { AWAITING, DISCARDED, DONE, FAILED, LIVE } from "../utils/format";

const PIPELINE = [
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
] as const;

const STAGE_ORDER = [
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
  "failed",
  "needs_human",
  "discarded",
];

type LineCls = "cmd" | "ok" | "tool" | "warn" | "file";

const LINE_CLS: Record<LineCls, string> = {
  cmd: "text-[oklch(84%_0.13_150)]",
  ok: "text-[oklch(74%_0.11_150)]",
  tool: "text-[oklch(66%_0.1_250)]",
  warn: "text-[oklch(70%_0.13_70)]",
  file: "text-[oklch(86%_0.01_250)]",
};

function stageIndex(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

function lineClass(stage: string, message: string): LineCls {
  const s = stage.toLowerCase();
  const m = message.toLowerCase();
  if (s === "failed" || s === "needs_human" || s === "discarded" || m.includes("fail")) return "warn";
  if (s === "done" || m.includes("pr opened") || m.includes("complete")) return "ok";
  if (["clone", "branch", "gitops"].includes(s)) return "cmd";
  if (m.includes("patch") || m.includes("file") || s === "develop") return "file";
  return "tool";
}

function formatClock(iso?: string | null): string {
  if (!iso) {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function pipelineState(stage: string, status: string) {
  const current = stageIndex(stage);
  const doneAll = DONE.has(status) || stage === "done";
  const failed = FAILED.has(status);

  return PIPELINE.map((key, i) => {
    const meta = AGENT_META[key];
    const stepIdx = stageIndex(key);
    let state: "done" | "active" | "pending" | "error" = "pending";
    if (doneAll) state = "done";
    else if (failed && stepIdx <= current) state = stepIdx === current ? "error" : "done";
    else if (stepIdx < current) state = "done";
    else if (stepIdx === current) state = "active";
    else if (stage === "queued" && i === 0) state = "active";
    return {
      key,
      title: meta?.title || key,
      agent: meta?.agent || key,
      outputField: meta?.outputField,
      state,
    };
  });
}

function outputForStep(run: RunDetail, field?: keyof AgentOutputs): unknown {
  if (!field) return null;
  return run[field] ?? null;
}

function countAdditions(diff: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) add++;
    else if (line.startsWith("-") && !line.startsWith("---")) del++;
  }
  return { add, del };
}

/** `/issue` now renders IssuesPage (all issues). This component is the run workbench for `/runs/:id`. */
export function IssuePage() {
  const { id } = useParams();
  return <IssueRunView runId={Number(id)} />;
}

function IssueRunView({ runId }: { runId: number }) {
  const toast = useToast();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [diff, setDiff] = useState<DiffOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [logQuery, setLogQuery] = useState("");
  const [logStage, setLogStage] = useState<string>("all");
  const [changeComment, setChangeComment] = useState("");
  const statusRef = useRef<string | null>(null);
  const termEl = useRef<HTMLDivElement>(null);

  const isLive = !!run && LIVE.has(run.status);
  const isDone = !!run && DONE.has(run.status);
  const isFailed = !!run && FAILED.has(run.status);
  const isAwaiting = !!run && AWAITING.has(run.status);
  const isDiscarded = !!run && DISCARDED.has(run.status);

  const { events: liveEvents, connected, lastStatus } = useRunEvents(
    Number.isFinite(runId) ? runId : null,
    isLive,
  );

  const load = useCallback(async () => {
    if (!Number.isFinite(runId)) return;
    const [detail, d] = await Promise.all([
      api.getRun(runId),
      api.getDiff(runId).catch(() => null),
    ]);
    statusRef.current = detail.status;
    setRun(detail);
    if (d) setDiff(d);
  }, [runId]);

  useEffect(() => {
    setLogQuery("");
    setLogStage("all");
    setSelectedStage(null);
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!isLive || !liveEvents.length) return;
    const t = window.setTimeout(() => void load().catch(() => {}), 800);
    return () => window.clearTimeout(t);
  }, [isLive, liveEvents.length, load]);

  useEffect(() => {
    if (!lastStatus || lastStatus === statusRef.current) return;
    void load().catch(() => {});
  }, [lastStatus, load]);

  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => void load().catch(() => {}), 2000);
    return () => window.clearInterval(id);
  }, [isLive, load]);

  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isLive]);

  const events: Array<RunEvent | { id: string; stage: string; message: string; created_at?: string }> =
    useMemo(() => {
      const base = run?.events || [];
      if (!isLive || !liveEvents.length) return base;
      const seen = new Set(base.map((e) => `${e.stage}|${e.message}`));
      const extras = liveEvents
        .filter((e) => e.stage && e.message && !seen.has(`${e.stage}|${e.message}`))
        .map((e, i) => ({
          id: `live-${i}`,
          stage: e.stage!,
          message: e.message!,
          created_at: e.created_at,
        }));
      return [...base, ...extras];
    }, [run?.events, liveEvents, isLive]);

  const logStages = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) {
      if (e.stage) seen.add(e.stage);
    }
    return [...seen];
  }, [events]);

  const visibleEvents = useMemo(() => {
    const q = logQuery.toLowerCase().trim();
    return events.filter((e) => {
      if (logStage !== "all" && e.stage !== logStage) return false;
      if (!q) return true;
      const agent = agentNameForStage(e.stage).toLowerCase();
      return (
        e.message.toLowerCase().includes(q) ||
        e.stage.toLowerCase().includes(q) ||
        agent.includes(q)
      );
    });
  }, [events, logQuery, logStage]);

  useEffect(() => {
    if (termEl.current) termEl.current.scrollTop = termEl.current.scrollHeight;
  }, [visibleEvents.length, events.length]);

  const steps = run ? pipelineState(run.stage, run.status) : [];
  const doneCount = steps.filter((s) => s.state === "done").length;
  const files = run?.files_touched?.length || diff?.files?.length || 0;
  const stats = countAdditions(diff?.diff || "");
  const elapsed = (() => {
    const stored = run?.execution_seconds ?? 0;
    if (!isLive || !run?.attempt_started_at) return formatDuration(stored);
    const started = new Date(run.attempt_started_at).getTime();
    if (Number.isNaN(started)) return formatDuration(stored);
    return formatDuration(stored + Math.floor((now - started) / 1000));
  })();

  async function retry() {
    if (!Number.isFinite(runId)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.retryRun(runId);
      toast(
        res.resume_stage
          ? `Run #${runId} resuming from ${res.resume_stage}`
          : `Run #${runId} queued`,
      );
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setBusy(false);
    }
  }

  async function approvePush() {
    if (!Number.isFinite(runId)) return;
    setBusy(true);
    setError(null);
    try {
      await api.approveRun(runId);
      toast(`Run #${runId} pushing and opening PR`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setBusy(false);
    }
  }

  async function requestChanges() {
    if (!Number.isFinite(runId)) return;
    setBusy(true);
    setError(null);
    try {
      await api.requestRunChanges(runId, changeComment.trim() || undefined);
      toast(`Run #${runId} sent back to the agent`);
      setChangeComment("");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setBusy(false);
    }
  }

  async function discardPush() {
    if (!Number.isFinite(runId)) return;
    setBusy(true);
    setError(null);
    try {
      await api.discardRun(runId);
      toast(`Run #${runId} discarded — nothing was pushed`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg);
    } finally {
      setBusy(false);
    }
  }

  async function copyLog() {
    const source = visibleEvents.length && (logQuery || logStage !== "all") ? visibleEvents : events;
    const text = source
      .map((e) => {
        const agent = agentNameForStage(e.stage);
        const t = e.created_at ? formatClock(e.created_at) : "";
        return `${t ? `${t} ` : ""}${agent} · [${e.stage}] ${e.message}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text || "(no events)");
      toast(
        source.length !== events.length
          ? `Copied ${source.length} filtered events`
          : "Run log copied to clipboard",
      );
    } catch {
      toast("Could not copy log");
    }
  }

  if (!Number.isFinite(runId)) {
    return (
      <div className="px-8 py-7 text-danger-ink">Invalid run id.</div>
    );
  }

  if (!run && !error) {
    return (
      <div className="px-8 py-7 text-muted">Loading run…</div>
    );
  }

  if (!run) {
    return (
      <div className="px-8 py-7">
        <div className="rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-danger-ink">
          {error || "Run not found"}
        </div>
        <Link to="/dashboard" className="btn btn-ghost mt-4">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const repoName = run.repo_full_name || `repo#${run.repo_id}`;
  const statusPill = isLive
    ? "pill-running"
    : isDone
      ? "pill-ok"
      : isFailed
        ? "pill-err"
        : isAwaiting
          ? "pill-queued"
          : isDiscarded
            ? "pill-off"
            : "pill-queued";
  const statusLabel = isLive
    ? run.status
    : isDone
      ? "completed"
      : isAwaiting
        ? "awaiting push"
        : isDiscarded
          ? "discarded"
          : isFailed
            ? run.status
            : run.status;

  return (
    <div className="min-w-0">
      <TopbarShell
        crumb={
          <Crumb
            items={[
              { href: "/repos", label: repoName.split("/")[1] || repoName },
            ]}
            current={`Issue ${run.issue_number}`}
          />
        }
        title={
          <>
            Issue #{run.issue_number}{" "}
            <span className={`pill ${statusPill}`}>{statusLabel}</span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyLog()}>
              <CopyIcon size={16} />
              Copy log
            </button>
            {(isFailed || isDone) && !isAwaiting && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || isLive}
                onClick={() => void retry()}
              >
                <PlayIcon size={16} />
                {busy ? "Queuing…" : isFailed ? "Resume run" : "Re-run agent"}
              </button>
            )}
            {isAwaiting && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void approvePush()}
              >
                <PlayIcon size={16} />
                {busy ? "Working…" : "Approve push"}
              </button>
            )}
            {isLive && (
              <button type="button" className="btn btn-primary" disabled>
                <PlayIcon size={16} />
                Running…
              </button>
            )}
          </>
        }
      />

      <div className="px-8 py-7 max-[720px]:px-4">
        <div className="mx-auto max-w-[1320px]">
          {error && (
            <div className="mb-4 rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">
              {error}
            </div>
          )}
          {run.error && (
            <div className="mb-4 rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">
              {run.error}
            </div>
          )}

          <div className="grid grid-cols-[1fr_1.4fr] items-start gap-5 max-[1080px]:grid-cols-1">
            {/* Issue card */}
            <section className="overflow-hidden rounded-[14px] border border-line bg-surface">
              <div className="border-b border-line p-5">
                <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  <Link to="/repos" className="font-semibold text-accent-ink">
                    {repoName}
                  </Link>
                  <span>·</span>
                  <span>#{run.issue_number}</span>
                  <span>·</span>
                  <span>run #{run.id}</span>
                  {run.issue_url && (
                    <>
                      <span>·</span>
                      <a
                        href={run.issue_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-accent-ink hover:underline"
                      >
                        GitHub
                      </a>
                    </>
                  )}
                </div>
                <h2 className="mb-3.5 text-[20px] leading-snug tracking-tight">
                  {run.issue_title}
                </h2>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-line bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted">
                    branch · {run.branch_name}
                  </span>
                  <span className="rounded-full border border-line bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted">
                    stage · {run.stage}
                  </span>
                  {isLive && (
                    <span className="rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-semibold text-info-ink">
                      {connected ? "live stream" : "connecting…"}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-5">
                <Markdown className="mb-4">{run.issue_body}</Markdown>
                {(run.files_touched || []).length > 0 && (
                  <div className="overflow-hidden rounded-[10px] border border-line bg-canvas">
                    <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                      Files touched
                    </div>
                    <ul className="px-3 py-2 font-mono text-[12.5px]">
                      {(run.files_touched || []).map((f) => (
                        <li key={f} className="border-b border-line py-1.5 last:border-0">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>

            {/* Run workbench */}
            <section className="overflow-hidden rounded-[14px] border border-line bg-surface">
              <div className="flex flex-wrap items-center gap-3.5 border-b border-line px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-[9px] bg-accent-soft text-accent-ink">
                    <BoltIcon size={18} />
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold">CoCoder agent</div>
                    <div className="font-mono text-xs text-muted">run-{run.id}</div>
                  </div>
                </div>
                <div className="ml-auto">
                  <span className={`pill ${statusPill}`}>{statusLabel}</span>
                </div>
              </div>

              <div className="border-b border-line px-5 py-4.5">
                <div className="mb-3 h-2 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-[inherit] bg-gradient-to-r from-accent to-info transition-[width] duration-700"
                    style={{
                      width: `${isDone ? 100 : Math.round((doneCount / Math.max(PIPELINE.length, 1)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-x-5.5 gap-y-2">
                  <div className="text-xs text-muted">
                    Step
                    <b className="mt-0.5 block font-mono text-[15px] font-semibold text-ink">
                      {isDone ? PIPELINE.length : doneCount} / {PIPELINE.length}
                    </b>
                  </div>
                  <div className="text-xs text-muted">
                    Elapsed
                    <b className="mt-0.5 block font-mono text-[15px] font-semibold text-info-ink">
                      {elapsed}
                    </b>
                  </div>
                  <div className="text-xs text-muted">
                    Events
                    <b className="mt-0.5 block font-mono text-[15px] font-semibold text-info-ink">
                      {events.length}
                    </b>
                  </div>
                  <div className="text-xs text-muted">
                    Files
                    <b className="mt-0.5 block font-mono text-[15px] font-semibold text-ink">
                      {files}
                    </b>
                  </div>
                </div>
              </div>

              {/* Steps timeline */}
              <div className="border-b border-line px-5 py-4.5">
                <div className="mb-3.5 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-muted">
                    Run pipeline
                  </h3>
                  <span className="font-mono text-xs text-faint">
                    {isDone ? PIPELINE.length : doneCount} / {PIPELINE.length} complete
                  </span>
                </div>
                <div>
                  {steps.map((s, i) => {
                    const done = s.state === "done";
                    const active = s.state === "active";
                    const err = s.state === "error";
                    const waiting = active && s.key === "awaiting_push";
                    const output = outputForStep(run, s.outputField);
                    const clickable = output != null;
                    return (
                      <button
                        type="button"
                        key={s.key}
                        disabled={!clickable}
                        onClick={() => clickable && setSelectedStage(s.key)}
                        className={`relative flex w-full gap-3.5 pb-[22px] text-left ${
                          i === steps.length - 1
                            ? "pb-0"
                            : "after:absolute after:left-[15px] after:top-[34px] after:bottom-0.5 after:w-0.5 after:bg-ink/10 after:content-['']"
                        } ${clickable ? "cursor-pointer" : "cursor-default"}`}
                      >
                        <div
                          className={`grid size-8 flex-none place-items-center rounded-full border-2 ${
                            done
                              ? "border-accent bg-accent-soft"
                              : err
                                ? "border-danger bg-danger-soft"
                                : waiting
                                  ? "border-warn bg-warn-soft"
                                  : active
                                    ? "border-info bg-info-soft"
                                    : "border-line-strong bg-surface"
                          }`}
                        >
                          {done ? (
                            <CheckIcon size={15} className="text-accent-ink" />
                          ) : waiting ? (
                            <ClockIcon size={15} className="animate-pulse text-warn-ink" />
                          ) : active ? (
                            <SpinnerIcon size={15} className="animate-spin text-info-ink" />
                          ) : err ? (
                            <span className="size-1.5 rounded-full bg-danger" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-line-strong" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 pt-1">
                          <div className="flex items-center gap-2">
                            <div
                              className={`text-[13.5px] font-semibold ${
                                waiting
                                  ? "text-warn-ink"
                                  : active
                                    ? "text-info-ink"
                                    : err
                                      ? "text-danger-ink"
                                      : ""
                              }`}
                            >
                              {s.title}
                            </div>
                            {clickable && (
                              <span className="text-[11px] font-semibold text-accent-ink">
                                view →
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-muted">
                            <span className="font-semibold text-ink/70">{s.agent}</span>
                            <span className="mx-1.5 text-faint">·</span>
                            <span className="font-mono">{s.key}</span>
                          </div>
                          {typeof (output as { summary?: unknown } | null)?.summary === "string" && (
                            <p className="mt-1 line-clamp-2 text-[12px] leading-[1.45] text-faint">
                              {(output as { summary: string }).summary}
                            </p>
                          )}
                          {typeof (output as { goal?: unknown } | null)?.goal === "string" && (
                            <p className="mt-1 line-clamp-2 text-[12px] leading-[1.45] text-faint">
                              {(output as { goal: string }).goal}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Terminal — per-run log viewer */}
              <div className="bg-dark">
                <div className="flex flex-wrap items-center gap-2 border-b border-dark-line bg-dark-raise px-4 py-2.5">
                  <div className="flex gap-1.5">
                    <span className="size-2.5 rounded-full bg-[oklch(73%_0.13_25)]" />
                    <span className="size-2.5 rounded-full bg-[oklch(78%_0.14_90)]" />
                    <span className="size-2.5 rounded-full bg-[oklch(72%_0.15_150)]" />
                  </div>
                  <span className="ml-2.5 font-mono text-[11.5px] tracking-[0.05em] text-ondark-dim">
                    run log
                  </span>
                  <label className="ml-3 flex min-w-[160px] flex-1 items-center gap-1.5 rounded-md border border-dark-line bg-dark px-2 py-1">
                    <SearchIcon size={13} className="text-ondark-dim" />
                    <input
                      type="text"
                      value={logQuery}
                      onChange={(e) => setLogQuery(e.target.value)}
                      placeholder="Filter events…"
                      className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-ondark outline-none placeholder:text-ondark-dim"
                    />
                  </label>
                  <span className="ml-auto flex items-center gap-1.5 font-mono text-[11.5px] text-ondark-dim">
                    {visibleEvents.length !== events.length
                      ? `${visibleEvents.length}/${events.length}`
                      : `${events.length} events`}
                    <span className="mx-1 text-ondark-dim/50">·</span>
                    {isLive ? (
                      <>
                        <span className="dot-live h-2 w-2" />
                        {connected ? "live" : "reconnecting"}
                      </>
                    ) : isDone ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-accent" />
                        complete
                      </>
                    ) : (
                      statusLabel
                    )}
                  </span>
                </div>
                {logStages.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-b border-dark-line px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setLogStage("all")}
                      className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${
                        logStage === "all"
                          ? "bg-ondark/15 text-ondark"
                          : "text-ondark-dim hover:text-ondark"
                      }`}
                    >
                      all
                    </button>
                    {logStages.map((stage) => (
                      <button
                        type="button"
                        key={stage}
                        onClick={() => setLogStage(stage)}
                        className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${
                          logStage === stage
                            ? "bg-ondark/15 text-ondark"
                            : "text-ondark-dim hover:text-ondark"
                        }`}
                      >
                        {stage}
                      </button>
                    ))}
                  </div>
                )}
                <div ref={termEl} className="h-[300px] overflow-y-auto px-4.5 py-4">
                  {events.length === 0 && (
                    <div className="font-mono text-[12.5px] text-ondark-dim">
                      Waiting for events…
                    </div>
                  )}
                  {events.length > 0 && visibleEvents.length === 0 && (
                    <div className="font-mono text-[12.5px] text-ondark-dim">
                      No events match this filter.
                    </div>
                  )}
                  {visibleEvents.map((l) => {
                    const cls = lineClass(l.stage, l.message);
                    const agent = agentNameForStage(l.stage);
                    return (
                      <div
                        key={String(l.id)}
                        className="flex gap-2.5 font-mono text-[12.5px] leading-[1.75] text-[oklch(86%_0.01_250)]"
                      >
                        <span className="min-w-[44px] flex-none text-ondark-dim">
                          {formatClock(l.created_at)}
                        </span>
                        <span className="flex-none text-ondark-dim">▸</span>
                        <span className={`${LINE_CLS[cls]} whitespace-pre-wrap break-words`}>
                          <span className="text-[oklch(70%_0.12_250)]">{agent}</span>
                          <span className="text-ondark-dim"> · [{l.stage}] </span>
                          {l.message}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Completion / failure */}
              {isDone && (
                <div className="border-t border-line p-5">
                  <div className="rounded-xl border border-accent-soft-line bg-accent-soft p-5">
                    <div className="mb-3.5 flex items-center gap-3">
                      <div className="grid size-10 flex-none place-items-center rounded-[10px] bg-accent-solid text-white">
                        <CheckIcon size={20} />
                      </div>
                      <div>
                        <div className="text-[16px] font-semibold tracking-tight">
                          Ready to review
                        </div>
                        <div className="font-mono text-[12.5px] text-muted">
                          {repoName} · {run.branch_name}
                          {run.pull_request?.number
                            ? ` · PR #${run.pull_request.number}`
                            : ""}
                        </div>
                      </div>
                    </div>
                    <div className="mb-3.5 grid grid-cols-3 gap-2.5">
                      {[
                        [String(files), "files changed"],
                        [`+${stats.add}`, "additions"],
                        [`−${stats.del}`, "deletions"],
                      ].map(([v, k]) => (
                        <div
                          key={k}
                          className="rounded-[9px] border border-accent-soft-line bg-surface p-2.5"
                        >
                          <b className="block font-mono text-[16px] font-semibold text-accent-ink">
                            {v}
                          </b>
                          <span className="text-[11.5px] text-muted">{k}</span>
                        </div>
                      ))}
                    </div>
                    {(diff?.files || run.files_touched || []).length > 0 && (
                      <div className="mb-1 rounded-[9px] border border-accent-soft-line bg-surface px-3 py-1">
                        {(diff?.files || run.files_touched || []).map((f) => (
                          <div
                            key={f}
                            className="flex gap-2.5 border-b border-line py-2 font-mono text-[12.5px] text-muted last:border-0"
                          >
                            {f}
                          </div>
                        ))}
                      </div>
                    )}
                    {run.pull_request?.url ? (
                      <a
                        className="btn btn-primary mt-4"
                        href={run.pull_request.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <PlayIcon size={16} />
                        Open pull request
                      </a>
                    ) : null}
                  </div>
                </div>
              )}

              {isFailed && (
                <div className="border-t border-line p-5">
                  <div className="rounded-xl border border-transparent bg-danger-soft p-5">
                    <div className="text-[16px] font-semibold tracking-tight text-danger-ink">
                      Run needs attention
                    </div>
                    <p className="mt-1.5 text-[13px] text-danger-ink/80">
                      {run.error || "The agent stopped before completing this issue."}
                      {run.checkpoint_stage || run.pm_output
                        ? " Saved progress will be reused — resume continues from the next incomplete stage."
                        : ""}
                    </p>
                    <button
                      className="btn btn-primary mt-4"
                      disabled={busy}
                      onClick={() => void retry()}
                    >
                      <PlayIcon size={16} />
                      {busy ? "Queuing…" : "Resume run"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Diff */}
          {isAwaiting && (
            <section className="mt-5 overflow-hidden rounded-[14px] border border-line bg-surface">
              <div className="border-b border-line px-5 py-3.5">
                <h3 className="text-[14px] font-semibold tracking-tight">Review before push</h3>
                <p className="mt-1 text-[13px] text-muted">
                  Inspect the diff below, then approve to push and open a PR, send the agent back
                  with notes, or discard without pushing.
                </p>
              </div>
              <div className="p-5">
                <textarea
                  value={changeComment}
                  onChange={(e) => setChangeComment(e.target.value)}
                  placeholder="Optional notes if you request changes…"
                  rows={3}
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-transparent focus:outline-2 focus:outline-accent"
                />
                <div className="mt-3 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void approvePush()}
                  >
                    <PlayIcon size={16} />
                    {busy ? "Working…" : "Approve push & open PR"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void requestChanges()}
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void discardPush()}
                  >
                    Discard
                  </button>
                </div>
              </div>
            </section>
          )}

          {(diff?.diff || "").trim() && (
            <section className="mt-5 overflow-hidden rounded-[14px] border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h3 className="text-[14px] font-semibold tracking-tight">Diff</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
                  Refresh
                </button>
              </div>
              <pre className="max-h-[420px] overflow-auto bg-dark p-4 font-mono text-[12px] leading-[1.6] text-ondark">
                {diff!.diff.split("\n").map((line, i) => {
                  let color = "text-ondark";
                  if (line.startsWith("+") && !line.startsWith("+++"))
                    color = "text-[oklch(74%_0.11_150)]";
                  else if (line.startsWith("-") && !line.startsWith("---"))
                    color = "text-[oklch(70%_0.18_25)]";
                  else if (line.startsWith("@@")) color = "text-[oklch(70%_0.12_250)]";
                  return (
                    <div key={i} className={color}>
                      {line || " "}
                    </div>
                  );
                })}
              </pre>
            </section>
          )}
        </div>
      </div>

      <AgentOutputDrawer
        open={!!selectedStage}
        stage={selectedStage}
        data={
          selectedStage
            ? outputForStep(run, AGENT_META[selectedStage]?.outputField)
            : null
        }
        onClose={() => setSelectedStage(null)}
      />
    </div>
  );
}
