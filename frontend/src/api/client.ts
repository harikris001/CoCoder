export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

export const WS_BASE = API_BASE.replace(/^http/, "ws");
export const githubOAuthStartUrl = () => `${API_BASE}/settings/github/oauth/start`;

export type User = {
  id: number;
  email: string;
  display_name: string;
  username: string;
  created_at: string;
};

export type GitHubSettings = {
  configured: boolean;
  source?: "pat" | "oauth" | "env" | null;
  login?: string | null;
  mask?: string | null;
  scopes: string[];
  expires_at?: string | null;
  pat_configured: boolean;
  oauth_configured: boolean;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type Repo = {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  clone_url: string;
  default_branch: string;
  workspace_path: string;
  index_status: string;
  index_stats?: Record<string, unknown> | null;
  last_indexed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type IndexStatus = {
  repo_id: number;
  status: string;
  stats?: Record<string, unknown> | null;
  last_indexed_at?: string | null;
  recent_jobs: Array<Record<string, unknown>>;
};

export type RunSummary = {
  id: number;
  repo_id: number;
  issue_number: number;
  issue_title: string;
  branch_name: string;
  status: string;
  stage: string;
  created_at: string;
  updated_at: string;
  pr_url?: string | null;
  repo_full_name?: string | null;
};

export type RunEvent = {
  id: number;
  stage: string;
  message: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

export type PullRequest = {
  id: number;
  number?: number | null;
  url?: string | null;
  title: string;
  body?: string | null;
  state: string;
  created_at: string;
};

export type RunDetail = RunSummary & {
  issue_body?: string | null;
  issue_url?: string | null;
  error?: string | null;
  pm_output?: Record<string, unknown> | null;
  architecture_output?: Record<string, unknown> | null;
  planner_output?: Record<string, unknown> | null;
  review_output?: Record<string, unknown> | null;
  files_touched?: string[] | null;
  completed_task_ids?: string[] | null;
  checkpoint_stage?: string | null;
  execution_seconds?: number;
  attempt_started_at?: string | null;
  retry_count: number;
  finished_at?: string | null;
  pull_request?: PullRequest | null;
  events: RunEvent[];
};

export type DiffOut = {
  run_id: number;
  branch_name: string;
  diff: string;
  files: string[];
};

export type UserPreferences = {
  require_push_approval: boolean;
};

export type LlmProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "custom";

export type LlmProviderStatus = {
  configured: boolean;
  mask?: string | null;
  model: string;
  base_url?: string;
};

export type LlmSettings = {
  active_provider: LlmProviderId;
  source: "byok" | "env";
  resolved_model: string;
  providers: Record<LlmProviderId, LlmProviderStatus>;
};

export type LlmProviderUpdate = {
  api_key?: string;
  model?: string;
  base_url?: string;
};

export type LlmSettingsUpdate = {
  active_provider?: LlmProviderId;
  openai?: LlmProviderUpdate;
  anthropic?: LlmProviderUpdate;
  google?: LlmProviderUpdate;
  openrouter?: LlmProviderUpdate;
  custom?: LlmProviderUpdate;
};

export type LlmModelOption = {
  id: string;
  name: string;
};

export type LlmModelsResponse = {
  provider: LlmProviderId;
  models: LlmModelOption[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers, ...rest } = init || {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { detail?: string | Array<{ msg?: string }> };
      if (typeof parsed.detail === "string") message = parsed.detail;
      else if (Array.isArray(parsed.detail)) {
        message = parsed.detail.map((item) => item.msg || "Invalid value").join("; ");
      }
    } catch {
      // Keep the plain response when it is not JSON.
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getCurrentUser: () => request<User>("/auth/me"),
  signUp: (body: { email: string; display_name: string; password: string }) =>
    request<User>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  signIn: (body: { email: string; password: string }) =>
    request<User>("/auth/signin", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  signOut: () =>
    request<{ status: string }>("/auth/signout", {
      method: "POST",
    }),
  getGithubSettings: () => request<GitHubSettings>("/settings/github"),
  testGithubToken: (token: string) =>
    request<{ ok: boolean; message: string; login?: string | null; scopes: string[] }>(
      "/settings/github/test",
      { method: "POST", body: JSON.stringify({ token }) },
    ),
  saveGithubPat: (token: string) =>
    request<GitHubSettings>("/settings/github/pat", {
      method: "PUT",
      body: JSON.stringify({ token }),
    }),
  clearGithubPat: () =>
    request<GitHubSettings>("/settings/github/pat", { method: "DELETE" }),
  clearGithubOAuth: () =>
    request<GitHubSettings>("/settings/github/oauth", { method: "DELETE" }),
  health: () => request<{ status: string }>("/health"),
  listRepos: () => request<Repo[]>("/repos"),
  getRepo: (id: number) => request<Repo>(`/repos/${id}`),
  registerRepo: (body: {
    owner: string;
    name: string;
    clone_url?: string;
    default_branch?: string;
  }) =>
    request<Repo>("/repos", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  indexStatus: (id: number) => request<IndexStatus>(`/repos/${id}/index/status`),
  reindex: (id: number) =>
    request<{ status: string }>(`/repos/${id}/reindex`, { method: "POST" }),
  syncIssues: (id: number, limit = 10) =>
    request<{
      status: string;
      repo_id: number;
      created: Array<{ issue_number: number; run_id: number; title: string }>;
      skipped: Array<{ issue_number: number; reason: string }>;
      fetched: number;
    }>(`/repos/${id}/issues/sync?limit=${limit}`, { method: "POST" }),
  runIssue: (id: number, issueNumber: number) =>
    request<{ status: string; run_id: number; issue_number: number }>(
      `/repos/${id}/issues/${issueNumber}/run`,
      { method: "POST" },
    ),
  listRuns: (params?: { repo_id?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.repo_id != null) q.set("repo_id", String(params.repo_id));
    if (params?.status) q.set("status", params.status);
    const suffix = q.toString() ? `?${q}` : "";
    return request<RunSummary[]>(`/runs${suffix}`);
  },
  getRun: (id: number) => request<RunDetail>(`/runs/${id}`),
  getDiff: (id: number) => request<DiffOut>(`/runs/${id}/diff`),
  retryRun: (id: number) =>
    request<{ status: string; run_id: number; resume_stage?: string }>(`/runs/${id}/retry`, {
      method: "POST",
    }),
  approveRun: (id: number) =>
    request<{ status: string; run_id: number; phase?: string }>(`/runs/${id}/approve`, {
      method: "POST",
    }),
  requestRunChanges: (id: number, comment?: string) =>
    request<{ status: string; run_id: number; resume_stage?: string }>(
      `/runs/${id}/request-changes`,
      {
        method: "POST",
        body: JSON.stringify({ comment: comment || undefined }),
      },
    ),
  discardRun: (id: number) =>
    request<{ status: string; run_id: number }>(`/runs/${id}/discard`, { method: "POST" }),
  getPreferences: () => request<UserPreferences>("/settings/preferences"),
  updatePreferences: (body: UserPreferences) =>
    request<UserPreferences>("/settings/preferences", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getLlmSettings: () => request<LlmSettings>("/settings/llm"),
  updateLlmSettings: (body: LlmSettingsUpdate) =>
    request<LlmSettings>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  clearLlmSettings: () =>
    request<LlmSettings>("/settings/llm", { method: "DELETE" }),
  testLlmSettings: (body: {
    provider: LlmProviderId;
    api_key?: string;
    model?: string;
    base_url?: string;
  }) =>
    request<{ ok: boolean; message: string }>("/settings/llm/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listLlmModels: (
    provider: LlmProviderId,
    opts?: { api_key?: string; base_url?: string },
  ) => {
    const body: {
      provider: LlmProviderId;
      api_key?: string;
      base_url?: string;
    } = { provider };
    if (opts?.api_key?.trim()) body.api_key = opts.api_key.trim();
    if (opts?.base_url?.trim()) body.base_url = opts.base_url.trim();
    return request<LlmModelsResponse>("/settings/llm/models", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};
