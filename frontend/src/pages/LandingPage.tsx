import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BoltIcon } from "../components/icons";

const LOG_SCRIPT: Array<[string, string]> = [
  ["act", "$ cocoder run --issue 482 --repo acme/api-gateway"],
  ["tool", "agent archer-14 ● spawned"],
  ["act", "read issue #482 · 3 comments"],
  ["act", "clone acme/api-gateway @ 62a91c8"],
  ["warn", "reproduce: go test ./... → 1 failing"],
  ["act", "locate handler → server/routes.go:212"],
  ["ok", "patch +18 −4 · server/routes.go"],
  ["ok", "patch +6 −2 · server/http.go"],
  ["act", "go vet ./... → clean"],
  ["ok", "go test ./... → 0 failures"],
  ["act", "push branch fix/482-timeout"],
  ["ok", "PR #524 created · ready for review"],
];

const LOG_CLS: Record<string, string> = {
  act: "text-ondark",
  tool: "text-[oklch(70%_0.12_250)]",
  ok: "text-ok",
  warn: "text-[oklch(78%_0.14_70)]",
};

export function LandingPage() {
  const [shown, setShown] = useState<Array<{ cls: string; text: string }>>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let line = 0;
    let idx = 0;
    let timer: number | undefined;
    let restart: number | undefined;

    const tick = () => {
      if (line >= LOG_SCRIPT.length) {
        // done with the script — hold, then restart
        restart = window.setTimeout(() => {
          setShown([]);
          line = 0;
          idx = 0;
          tick();
        }, 5200);
        return;
      }
      const [cls, text] = LOG_SCRIPT[line];
      setShown((prev) => {
        const copy = prev.slice();
        if (!copy[line]) copy.push({ cls, text: "" });
        copy[line] = { cls, text: text.slice(0, idx) };
        return copy;
      });
      idx++;
      if (idx > text.length) {
        line++;
        idx = 0;
        timer = window.setTimeout(tick, 220);
      } else {
        timer = window.setTimeout(tick, 14);
      }
    };
    tick();
    return () => {
      if (timer) window.clearTimeout(timer);
      if (restart) window.clearTimeout(restart);
    };
  }, []);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [shown]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Nav */}
      <nav className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-7 px-8 max-[860px]:px-5">
          <Link to="/" className="flex items-center gap-2.5 text-[16px] font-bold tracking-tight">
            <BoltIcon className="text-accent" size={22} strokeWidth={2} />
            CoCoder
          </Link>
          <div className="mr-auto hidden gap-[22px] max-[720px]:hidden">
            <a href="#how" className="text-[14px] text-muted transition-colors hover:text-ink">How it works</a>
            <Link to="/dashboard" className="text-[14px] text-muted transition-colors hover:text-ink">Dashboard</Link>
            <Link to="/repos" className="text-[14px] text-muted transition-colors hover:text-ink">Repositories</Link>
            <Link to="/issue" className="text-[14px] text-muted transition-colors hover:text-ink">Run demo</Link>
          </div>
          <Link to="/dashboard" className="btn btn-ghost ml-auto">Sign in</Link>
        </div>
      </nav>

      {/* Hero */}
      <header className="px-8 pb-16 pt-[88px] max-[860px]:px-5 max-[960px]:pt-14">
        <div className="mx-auto grid max-w-[1200px] grid-cols-[1.05fr_0.95fr] items-center gap-14 max-[960px]:grid-cols-1">
          <div>
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent-soft-line bg-accent-soft px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.09em] text-accent-ink">
              Autonomous coding agents
            </span>
            <h1 className="mb-5 max-w-[20ch] text-[44px] font-bold leading-[1.08] tracking-tight max-[720px]:text-[34px]">
              Close issues. Not tabs on a feed.
            </h1>
            <p className="mb-8 max-w-[52ch] text-[17px] leading-[1.6] text-muted">
              CoCoder watches your repositories, runs an agent on every task, and streams what it
              does back to you — progress, tool calls, and the finished pull request. This is what
              watching your team work should feel like.
            </p>
            <div className="flex flex-wrap gap-3.5">
              <Link to="/issue" className="btn btn-primary">Try a run</Link>
              <Link to="/repos" className="btn btn-ghost">Browse repos</Link>
            </div>
            <div className="mt-10 flex gap-6 border-t border-line pt-7">
              {[
                ["48", "repos connected"],
                ["2/6", "active runs"],
                ["#523", "PR opened today"],
              ].map(([v, k]) => (
                <span key={k} className="flex flex-col gap-0.5 text-xs text-faint">
                  <strong className="font-mono text-[18px] font-semibold text-ink">{v}</strong>
                  {k}
                </span>
              ))}
            </div>
          </div>

          {/* Console */}
          <div className="overflow-hidden rounded-[14px] border border-dark-line bg-dark shadow-[0_24px_60px_-24px_oklch(20%_0.1_250/0.45)]">
            <div className="flex items-center gap-2 border-b border-dark-line px-4 py-3">
              <span className="size-2.5 rounded-full bg-[oklch(64%_0.12_25)]" />
              <span className="size-2.5 rounded-full bg-[oklch(80%_0.14_90)]" />
              <span className="size-2.5 rounded-full bg-[oklch(72%_0.15_150)]" />
              <span className="ml-2.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-ondark-dim">
                run-8f2a91 · issue #482
              </span>
              <span className="ml-auto flex items-center gap-1.5 font-mono text-[11.5px] text-ok">
                <span className="dot-ok h-2 w-2" />
                running
              </span>
            </div>
            <div ref={bodyRef} className="h-[360px] overflow-y-auto px-4.5 py-4 font-mono text-[12.5px] leading-[1.75] text-ondark max-[720px]:h-[300px]">
              {shown.map((l, i) => (
                <div key={i} className={LOG_CLS[l.cls] || "text-ondark"}>
                  <span className="text-ondark-dim">{l.text}</span>
                  <span className="ml-1 inline-block h-3.5 w-[7px] animate-blink bg-ondark align-[-2px]" />
                </div>
              ))}
              {shown.length === 0 && <span className="ml-1 inline-block h-3.5 w-[7px] animate-blink bg-ondark" />}
            </div>
          </div>
        </div>
      </header>

      {/* How it works */}
      <section id="how" className="py-14">
        <div className="mx-auto max-w-[1200px] px-8 max-[860px]:px-5">
          <div className="mb-9 max-w-[560px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-soft-line bg-accent-soft px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.09em] text-accent-ink">
              The loop
            </span>
            <h2 className="mb-2.5 mt-3 text-[28px] font-semibold leading-tight tracking-tight">
              Three states you can read at a glance
            </h2>
            <p className="text-[15px] leading-[1.6] text-muted">
              Every run moves through the same visible pipeline — nothing is hidden until a status
              update drops in.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 max-[860px]:grid-cols-1">
            {[
              ["01", "Inspect", "The agent reads the issue, gathers the connected repo, and maps affected modules before touching a file.", "plan stages: read → diff → scope"],
              ["02", "Run", "Every tool call and file change streams live. You watch the agent work instead of waiting for \"done\".", "step-by-step: spinner + log tail"],
              ["03", "Review", "The output lands as a real object — a pull request with diff stats, changed files, and a summary to review.", "output: PR + diff + checklist"],
            ].map(([idx, title, body, flow]) => (
              <article key={idx} className="rounded-xl border border-line bg-surface p-6">
                <div className="font-mono text-[13px] text-accent-ink">{idx}</div>
                <h3 className="mb-2 mt-3.5 text-[17px] font-semibold tracking-tight">{title}</h3>
                <p className="m-0 text-[14px] leading-[1.6] text-muted">{body}</p>
                <div className="mt-4 border-t border-line pt-3.5 font-mono text-xs tracking-[0.02em] text-faint">{flow}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Closing band */}
      <section className="py-14">
        <div className="mx-auto max-w-[1200px] px-8 max-[860px]:px-5">
          <div className="flex items-center gap-9 rounded-2xl bg-dark p-10 text-ondark max-[860px]:flex-col max-[860px]:items-start max-[860px]:p-8">
            <div>
              <span className="inline-flex items-center rounded-full border border-dark-line bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.09em] text-ondark-dim">
                Stop polling timestamps
              </span>
              <h2 className="mb-3 mt-3 text-[26px] font-semibold leading-tight tracking-tight">
                The agent run, rendered as a process — not a list.
              </h2>
              <p className="mb-6 max-w-[46ch] text-[15px] leading-[1.6] text-ondark-dim">
                See where each run is, what it did last, and what it attempts next. The old output
                is still there, just structured into something a team can actually watch.
              </p>
              <Link to="/dashboard" className="btn btn-primary mt-1">Open the dashboard</Link>
            </div>
            <div className="ml-auto flex min-w-[320px] flex-col gap-2.5 font-mono max-[860px]:ml-0 max-[860px]:w-full max-[860px]:min-w-0">
              <div className="flex justify-between gap-4 border-b border-dark-line py-3 text-[13px] last:border-0">
                <span className="text-ondark-dim">acme/api-gateway</span>
                <b className="text-ok">PR #523 · merged</b>
              </div>
              <div className="flex justify-between gap-4 border-b border-dark-line py-3 text-[13px] last:border-0">
                <span className="text-ondark-dim">acme/mobile-app</span>
                <b className="text-[oklch(70%_0.12_250)]">running · step 4/6</b>
              </div>
              <div className="flex justify-between gap-4 border-b border-dark-line py-3 text-[13px] last:border-0">
                <span className="text-ondark-dim">acme/payments-core</span>
                <b className="text-ondark-dim">queued</b>
              </div>
              <div className="flex justify-between gap-4 border-b border-dark-line py-3 text-[13px] last:border-0">
                <span className="text-ondark-dim">acme/analytics-dash</span>
                <b className="text-err">tests failed · retry</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-12 border-t border-line py-9">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-8 text-[13px] text-faint max-[860px]:px-5">
          <span>CoCoder prototype · sample data</span>
          <span className="flex items-center gap-2 text-muted">
            <BoltIcon size={16} className="text-accent" />
            CoCoder
          </span>
        </div>
      </footer>
    </div>
  );
}