import type { ReactNode } from "react";
import { AGENT_META } from "./agentMeta";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
        {title}
      </h4>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-[13px] text-muted">None</p>;
  return (
    <ul className="grid gap-1.5">
      {items.map((item, i) => (
        <li
          key={`${i}-${item.slice(0, 24)}`}
          className="relative rounded-lg border border-line bg-canvas px-3 py-2 pl-7 text-[13px] leading-[1.5] text-ink"
        >
          <span className="absolute left-2.5 top-[11px] size-1.5 rounded-full bg-accent" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
}

function GitOpsView({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      {typeof data.issue_type === "string" && (
        <Section title="Issue type">
          <p className="font-mono text-[13px] text-ink">{data.issue_type}</p>
        </Section>
      )}
      {typeof data.branch_name === "string" && (
        <Section title="Branch">
          <p className="font-mono text-[13px] text-ink">{data.branch_name}</p>
        </Section>
      )}
      {typeof data.pr_title === "string" && (
        <Section title="PR title">
          <p className="text-[14px] leading-[1.6] text-ink">{data.pr_title}</p>
        </Section>
      )}
      {typeof data.closes_keyword === "string" && (
        <Section title="Closes with">
          <p className="font-mono text-[13px] text-ink">{data.closes_keyword}</p>
        </Section>
      )}
      {typeof data.rationale === "string" && (
        <Section title="Rationale">
          <p className="text-[14px] leading-[1.6] text-ink">{data.rationale}</p>
        </Section>
      )}
    </>
  );
}

function PmView({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      {typeof data.goal === "string" && (
        <Section title="Goal">
          <p className="text-[14px] leading-[1.6] text-ink">{data.goal}</p>
        </Section>
      )}
      <Section title="Requirements">
        <BulletList items={asStringList(data.requirements)} />
      </Section>
      <Section title="Acceptance criteria">
        <BulletList items={asStringList(data.acceptance_criteria)} />
      </Section>
      <Section title="Constraints">
        <BulletList items={asStringList(data.constraints)} />
      </Section>
      <Section title="Open questions">
        <BulletList items={asStringList(data.open_questions)} />
      </Section>
    </>
  );
}

function ArchitectureView({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      <Section title="Files to modify">
        <BulletList items={asStringList(data.files_to_modify)} />
      </Section>
      <Section title="New files">
        <BulletList items={asStringList(data.new_files)} />
      </Section>
      <Section title="Risks">
        <BulletList items={asStringList(data.risks)} />
      </Section>
      <Section title="Dependencies">
        <BulletList items={asStringList(data.dependencies)} />
      </Section>
      <Section title="Architecture decisions">
        <BulletList items={asStringList(data.architecture_decisions)} />
      </Section>
    </>
  );
}

function PlannerView({ data }: { data: Record<string, unknown> }) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return (
    <>
      <Section title="Tasks">
        <div className="grid gap-2.5">
          {tasks.map((raw, i) => {
            const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
            return (
              <article
                key={String(t.id || i)}
                className="rounded-xl border border-line bg-canvas p-3.5"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-accent-ink">
                    {String(t.id || `t${i + 1}`)}
                  </span>
                  {typeof t.owner === "string" && (
                    <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">
                      {t.owner}
                    </span>
                  )}
                </div>
                <h5 className="text-[14px] font-semibold tracking-tight text-ink">
                  {String(t.title || "Task")}
                </h5>
                {typeof t.description === "string" && (
                  <p className="mt-1.5 text-[13px] leading-[1.55] text-muted">{t.description}</p>
                )}
                {Array.isArray(t.target_files) && t.target_files.length > 0 && (
                  <p className="mt-2 font-mono text-[11px] text-faint">
                    files · {t.target_files.map(String).join(", ")}
                  </p>
                )}
                {Array.isArray(t.depends_on) && t.depends_on.length > 0 && (
                  <p className="mt-2 font-mono text-[11px] text-faint">
                    depends on · {t.depends_on.map(String).join(", ")}
                  </p>
                )}
              </article>
            );
          })}
          {!tasks.length && <p className="text-[13px] text-muted">No tasks</p>}
        </div>
      </Section>
      {typeof data.notes === "string" && data.notes.trim() && (
        <Section title="Notes">
          <p className="text-[13px] leading-[1.55] text-muted">{data.notes}</p>
        </Section>
      )}
      {Array.isArray(data.notes) && (
        <Section title="Notes">
          <BulletList items={asStringList(data.notes)} />
        </Section>
      )}
    </>
  );
}

function TestView({ data }: { data: Record<string, unknown> }) {
  const passed = data.passed === true;
  const command = Array.isArray(data.command)
    ? data.command.map(String).join(" ")
    : typeof data.command === "string"
      ? data.command
      : "";
  const removed = asStringList(data.artifacts_removed);
  const created = asStringList(data.files_created);
  return (
    <>
      <Section title="Verdict">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
            passed
              ? "bg-accent-soft text-accent-ink"
              : "bg-danger-soft text-danger-ink"
          }`}
        >
          {passed ? "Passed" : "Failed"}
        </span>
      </Section>
      {command && (
        <Section title="Command">
          <p className="font-mono text-[13px] text-ink">{command}</p>
        </Section>
      )}
      {data.exit_code != null && (
        <Section title="Exit code">
          <p className="font-mono text-[13px] text-ink">{String(data.exit_code)}</p>
        </Section>
      )}
      {typeof data.summary === "string" && (
        <Section title="Summary">
          <p className="text-[14px] leading-[1.6] text-ink">{data.summary}</p>
        </Section>
      )}
      <Section title="Failing tests">
        <BulletList items={asStringList(data.failing_tests)} />
      </Section>
      <Section title="Bugs">
        <BulletList items={asStringList(data.bugs)} />
      </Section>
      <Section title="Temporary files (removed)">
        <BulletList items={removed.length ? removed : created} />
      </Section>
      {typeof data.notes === "string" && data.notes.trim() && (
        <Section title="Notes">
          <p className="text-[13px] leading-[1.55] text-muted">{data.notes}</p>
        </Section>
      )}
    </>
  );
}

function ReviewView({ data }: { data: Record<string, unknown> }) {
  const approved = data.approved === true;
  return (
    <>
      <Section title="Verdict">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
            approved
              ? "bg-accent-soft text-accent-ink"
              : "bg-danger-soft text-danger-ink"
          }`}
        >
          {approved ? "Approved" : "Changes requested"}
        </span>
      </Section>
      {typeof data.summary === "string" && (
        <Section title="Summary">
          <p className="text-[14px] leading-[1.6] text-ink">{data.summary}</p>
        </Section>
      )}
      <Section title="Issues">
        <BulletList items={asStringList(data.issues)} />
      </Section>
      <Section title="Suggestions">
        <BulletList items={asStringList(data.suggestions)} />
      </Section>
    </>
  );
}

function GenericView({ data }: { data: unknown }) {
  return (
    <pre className="overflow-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[12px] leading-[1.55] text-muted">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export function AgentOutputView({
  stage,
  data,
}: {
  stage: string;
  data: unknown;
}) {
  if (data == null) {
    return (
      <p className="text-[13px] text-muted">
        No structured output for this step yet.
      </p>
    );
  }
  const obj = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  if (!obj) return <GenericView data={data} />;

  switch (stage) {
    case "branch":
      return <GitOpsView data={obj} />;
    case "pm":
      return <PmView data={obj} />;
    case "architecture":
      return <ArchitectureView data={obj} />;
    case "planner":
      return <PlannerView data={obj} />;
    case "test":
      return <TestView data={obj} />;
    case "review":
      return <ReviewView data={obj} />;
    default:
      return <GenericView data={data} />;
  }
}

export function AgentOutputDrawer({
  open,
  stage,
  data,
  onClose,
}: {
  open: boolean;
  stage: string | null;
  data: unknown;
  onClose: () => void;
}) {
  if (!open || !stage) return null;
  const meta = AGENT_META[stage] || { agent: stage, title: stage };

  return (
    <div
      className="fixed inset-0 z-70 flex justify-end bg-ink/35"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="flex h-full w-full max-w-[520px] flex-col border-l border-line bg-surface shadow-xl">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-ink">
              {meta.agent}
            </div>
            <h3 className="mt-1 text-[17px] font-semibold tracking-tight">{meta.title}</h3>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <AgentOutputView stage={stage} data={data} />
        </div>
      </aside>
    </div>
  );
}
