type AgentKey = "pm" | "architecture" | "planner" | "develop" | "test" | "review";

export type AgentOutputs = {
  gitops_output?: Record<string, unknown> | null;
  pm_output?: Record<string, unknown> | null;
  architecture_output?: Record<string, unknown> | null;
  planner_output?: Record<string, unknown> | null;
  test_output?: Record<string, unknown> | null;
  review_output?: Record<string, unknown> | null;
};

export const AGENT_META: Record<
  string,
  { key: AgentKey | string; agent: string; title: string; outputField?: keyof AgentOutputs }
> = {
  clone: { key: "clone", agent: "GitHub Ops", title: "Clone repo" },
  branch: {
    key: "branch",
    agent: "GitHub Ops",
    title: "Classify issue and branch",
    outputField: "gitops_output",
  },
  index: { key: "index", agent: "Indexer", title: "Index codebase" },
  pm: { key: "pm", agent: "PM Agent", title: "Analyze issue", outputField: "pm_output" },
  architecture: {
    key: "architecture",
    agent: "Architecture Agent",
    title: "Map changes",
    outputField: "architecture_output",
  },
  planner: {
    key: "planner",
    agent: "Task Planner",
    title: "Plan tasks",
    outputField: "planner_output",
  },
  develop: { key: "develop", agent: "Developer Agent", title: "Implement fix" },
  test: {
    key: "test",
    agent: "Tester Agent",
    title: "Run tests",
    outputField: "test_output",
  },
  review: {
    key: "review",
    agent: "Reviewer Agent",
    title: "Review changes",
    outputField: "review_output",
  },
  gitops: { key: "gitops", agent: "GitHub Ops", title: "Open pull request" },
  awaiting_push: { key: "awaiting_push", agent: "You", title: "Review before push" },
  discarded: { key: "discarded", agent: "You", title: "Discarded" },
  checkpoint: { key: "checkpoint", agent: "Orchestrator", title: "Checkpoint" },
  queued: { key: "queued", agent: "Orchestrator", title: "Queued" },
  done: { key: "done", agent: "Orchestrator", title: "Complete" },
  failed: { key: "failed", agent: "Orchestrator", title: "Failed" },
  needs_human: { key: "needs_human", agent: "Orchestrator", title: "Needs review" },
};

export function agentNameForStage(stage: string): string {
  return AGENT_META[stage]?.agent || stage;
}
