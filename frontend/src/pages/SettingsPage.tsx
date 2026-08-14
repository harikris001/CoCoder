import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  api,
  type GitHubSettings,
  githubOAuthStartUrl,
  type LlmModelOption,
  type LlmProviderId,
  type LlmSettings,
} from "../api/client";
import { TopbarShell } from "../components/Topbar";
import { useToast } from "../components/Toast";
import { CheckIcon, EyeIcon, EyeOffIcon } from "../components/icons";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuth } from "../auth/AuthProvider";

const PROVIDERS: Array<{
  id: Exclude<LlmProviderId, "custom">;
  name: string;
  hint: string;
  monogram: string;
  color: string;
  placeholder: string;
  fallbackModel: string;
}> = [
  {
    id: "openai",
    name: "OpenAI",
    hint: "GPT & o-series",
    monogram: "O",
    color: "#0d1526",
    placeholder: "sk-…",
    fallbackModel: "gpt-4o",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    hint: "Claude models",
    monogram: "A",
    color: "#c15f3c",
    placeholder: "sk-ant-…",
    fallbackModel: "claude-sonnet-4-5",
  },
  {
    id: "google",
    name: "Google",
    hint: "Gemini models",
    monogram: "G",
    color: "#4285f4",
    placeholder: "AIza…",
    fallbackModel: "gemini-2.5-pro",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    hint: "Multi-model gateway",
    monogram: "R",
    color: "#6b4eff",
    placeholder: "sk-or-…",
    fallbackModel: "deepseek/deepseek-v4-flash",
  },
];

type DraftKeys = Record<LlmProviderId, { api_key: string; model: string; base_url: string }>;

function emptyDrafts(settings?: LlmSettings | null): DraftKeys {
  const d = (id: LlmProviderId, fallbackModel: string) => ({
    api_key: "",
    model: settings?.providers?.[id]?.model || fallbackModel,
    base_url: settings?.providers?.[id]?.base_url || "",
  });
  return {
    openai: d("openai", "gpt-4o"),
    anthropic: d("anthropic", "claude-sonnet-4-5"),
    google: d("google", "gemini-2.5-pro"),
    openrouter: d("openrouter", "deepseek/deepseek-v4-flash"),
    custom: d("custom", ""),
  };
}

function KeyField({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete || "off"}
        spellCheck={false}
        className="min-h-[44px] w-full rounded-lg border border-line bg-surface py-2 pl-3 pr-11 font-mono text-[13px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-canvas hover:text-ink"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide key" : "Show key"}
      >
        {visible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
      </button>
    </div>
  );
}

function SavedPill({ mask }: { mask?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent-ink">
      <CheckIcon size={12} />
      Saved{mask ? ` · ${mask}` : ""}
    </span>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-[12.5px] text-muted">{description}</p> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function ModelPicker({
  provider,
  value,
  onChange,
  canFetch,
  apiKey,
  baseUrl,
  ariaLabel,
}: {
  provider: LlmProviderId;
  value: string;
  onChange: (model: string) => void;
  canFetch: boolean;
  apiKey?: string;
  baseUrl?: string;
  ariaLabel: string;
}) {
  const [models, setModels] = useState<LlmModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!canFetch) {
      setModels([]);
      setError(null);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listLlmModels(provider, {
        api_key: apiKey,
        base_url: baseUrl,
      });
      if (id !== requestId.current) return;
      setModels(res.models);
    } catch (e) {
      if (id !== requestId.current) return;
      setModels([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [apiKey, baseUrl, canFetch, provider]);

  // Auto-load from saved credentials only (empty apiKey means use server-side saved key).
  // Draft keys are applied when the user clicks Refresh.
  useEffect(() => {
    if (!canFetch) {
      setModels([]);
      setError(null);
      return;
    }
    if (apiKey) return;
    void load();
  }, [apiKey, baseUrl, canFetch, load, provider]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [models, query]);

  const selectedLabel = useMemo(() => {
    const hit = models.find((m) => m.id === value);
    if (hit && hit.name && hit.name !== hit.id) return `${hit.name} (${hit.id})`;
    return value || "Select a model";
  }, [models, value]);

  return (
    <div ref={rootRef} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-label={ariaLabel}
            aria-expanded={open}
            disabled={!canFetch && models.length === 0}
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 text-left text-[13px] text-ink disabled:cursor-default disabled:opacity-60"
          >
            <span className="truncate font-mono text-[12.5px]">{selectedLabel}</span>
            <span className="text-[11px] text-faint">{open ? "▲" : "▼"}</span>
          </button>
          {open && (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
              <div className="border-b border-line p-2">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  autoFocus
                  className="min-h-[36px] w-full rounded-md border border-line bg-canvas px-2.5 text-[12.5px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
                />
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {loading && (
                  <div className="px-3 py-2 text-[12.5px] text-faint">Loading models…</div>
                )}
                {!loading && error && (
                  <div className="px-3 py-2 text-[12.5px] text-danger-ink">{error}</div>
                )}
                {!loading && !error && filtered.length === 0 && (
                  <div className="px-3 py-2 text-[12.5px] text-faint">No models found</div>
                )}
                {!loading &&
                  filtered.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-canvas ${
                        m.id === value ? "bg-accent-soft" : ""
                      }`}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="font-mono text-[12.5px] text-ink">{m.id}</span>
                      {m.name && m.name !== m.id ? (
                        <span className="text-[11px] text-faint">{m.name}</span>
                      ) : null}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!canFetch || loading}
          onClick={() => void load()}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {!canFetch && (
        <p className="m-0 text-[12px] text-faint">
          Enter and save an API key to load available models, or type a model id below.
        </p>
      )}
      {canFetch && error && !open && (
        <p className="m-0 text-[12px] text-danger-ink">{error}</p>
      )}
      {canFetch && !error && !loading && (
        <p className="m-0 text-[12px] text-faint">{models.length} models available</p>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or type any model id"
        className="min-h-[40px] w-full rounded-lg border border-line bg-surface px-3 font-mono text-[12.5px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
      />
    </div>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [github, setGithub] = useState<GitHubSettings | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [githubBusy, setGithubBusy] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [drafts, setDrafts] = useState<DraftKeys>(() => emptyDrafts(null));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requirePushApproval, setRequirePushApproval] = useState(true);

  const applyLlm = useCallback((next: LlmSettings) => {
    setLlm(next);
    setDrafts(emptyDrafts(next));
  }, []);

  const loadLlm = useCallback(async () => {
    const next = await api.getLlmSettings();
    applyLlm(next);
  }, [applyLlm]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [, githubSettings, prefs] = await Promise.all([
          loadLlm(),
          api.getGithubSettings(),
          api.getPreferences(),
        ]);
        if (!cancelled) {
          setGithub(githubSettings);
          setRequirePushApproval(prefs.require_push_approval);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLlm]);

  async function testGithub() {
    const token = githubToken.trim();
    if (!token) {
      toast("Enter a GitHub token first");
      return;
    }
    setGithubBusy("test");
    try {
      const result = await api.testGithubToken(token);
      toast(result.ok ? result.message : `Failed: ${result.message}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setGithubBusy(null);
    }
  }

  async function saveGithubPat() {
    const token = githubToken.trim();
    if (!token) {
      toast("Enter a GitHub token first");
      return;
    }
    setGithubBusy("save");
    try {
      const next = await api.saveGithubPat(token);
      setGithub(next);
      setGithubToken("");
      toast(`GitHub connected as @${next.login || "user"}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setGithubBusy(null);
    }
  }

  async function clearGithubCredential() {
    setGithubBusy("clear");
    try {
      const next = github?.source === "oauth" ? await api.clearGithubOAuth() : await api.clearGithubPat();
      setGithub(next);
      toast("GitHub credential disconnected");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setGithubBusy(null);
    }
  }

  function patchDraft(id: LlmProviderId, patch: Partial<DraftKeys[LlmProviderId]>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function setActiveProvider(id: LlmProviderId) {
    setBusy("active");
    try {
      const next = await api.updateLlmSettings({ active_provider: id });
      applyLlm(next);
      toast(`Active provider → ${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveProvider(id: LlmProviderId) {
    const d = drafts[id];
    if (id === "custom") {
      if (!d.base_url.trim()) {
        toast("Enter a base URL first");
        return;
      }
      if (!d.api_key.trim() && !llm?.providers.custom.configured) {
        toast("Enter an API key first");
        return;
      }
    } else if (!d.api_key.trim() && !llm?.providers[id]?.configured) {
      toast("Enter an API key first");
      return;
    }

    setBusy(id);
    try {
      const patch: { api_key?: string; model?: string; base_url?: string } = {
        model: d.model.trim(),
      };
      if (d.api_key.trim()) patch.api_key = d.api_key.trim();
      if (id === "custom") patch.base_url = d.base_url.trim();

      const next = await api.updateLlmSettings({
        active_provider: id,
        [id]: patch,
      });
      applyLlm(next);
      toast(`${id} settings saved`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function testProvider(id: LlmProviderId) {
    const d = drafts[id];
    setBusy(`test-${id}`);
    try {
      const res = await api.testLlmSettings({
        provider: id,
        api_key: d.api_key.trim() || undefined,
        model: d.model.trim() || undefined,
        base_url: id === "custom" ? d.base_url.trim() || undefined : undefined,
      });
      toast(res.ok ? res.message : `Failed: ${res.message}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function clearByok() {
    setBusy("clear");
    try {
      const next = await api.clearLlmSettings();
      applyLlm(next);
      toast("BYOK cleared — falling back to server .env");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function savePushPreference(next: boolean) {
    const prev = requirePushApproval;
    setRequirePushApproval(next);
    setBusy("prefs");
    try {
      const saved = await api.updatePreferences({ require_push_approval: next });
      setRequirePushApproval(saved.require_push_approval);
      toast(saved.require_push_approval ? "Will wait for your review before push" : "Agent will push automatically");
    } catch (e) {
      setRequirePushApproval(prev);
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const active = llm?.active_provider || "openrouter";

  return (
    <div className="min-w-0">
      <TopbarShell
        crumb={
          <span className="text-[12.5px] text-muted">
            Home <span className="mx-1.5 text-faint">/</span> Settings
          </span>
        }
        title="Settings"
      />

      <div className="px-8 py-7 max-[720px]:px-4">
        <div className="mx-auto max-w-[880px]">
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-line bg-accent-soft px-4 py-3.5">
            <div className="grid size-8 flex-none place-items-center rounded-lg bg-surface text-accent-ink">
              <CheckIcon size={15} />
            </div>
            <p className="text-[12.5px] text-accent-ink">
              Bring your own keys. Model API keys are stored encrypted per account on the CoCoder
              server and never returned in full after save.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">
              {error}
            </div>
          )}

          <SectionCard
            title="Appearance"
            description="Choose light, dark, or match the operating system."
          >
            <ThemeToggle variant="segmented" />
          </SectionCard>

          <SectionCard
            title="Push & PRs"
            description="After the reviewer agent approves, either inspect the diff yourself or let CoCoder push and open the PR."
          >
            <div
              role="group"
              aria-label="Push approval"
              className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-canvas p-1"
            >
              <button
                type="button"
                aria-pressed={requirePushApproval}
                disabled={busy === "prefs"}
                onClick={() => void savePushPreference(true)}
                className={`flex min-h-[40px] items-center justify-center rounded-lg px-3 text-[13px] transition-colors ${
                  requirePushApproval
                    ? "bg-accent-soft font-semibold text-accent-ink"
                    : "text-muted hover:bg-surface hover:text-ink"
                }`}
              >
                Review before push
              </button>
              <button
                type="button"
                aria-pressed={!requirePushApproval}
                disabled={busy === "prefs"}
                onClick={() => void savePushPreference(false)}
                className={`flex min-h-[40px] items-center justify-center rounded-lg px-3 text-[13px] transition-colors ${
                  !requirePushApproval
                    ? "bg-accent-soft font-semibold text-accent-ink"
                    : "text-muted hover:bg-surface hover:text-ink"
                }`}
              >
                Push automatically
              </button>
            </div>
          </SectionCard>

          <SectionCard
            title="GitHub"
            description="Connect a personal access token or OAuth so CoCoder can clone repos and open PRs."
          >
            {/* github section preserved below via existing markup in file - wait, I need the rest */}
            <GitHubSection
              userEmail={user?.email}
              github={github}
              githubToken={githubToken}
              setGithubToken={setGithubToken}
              githubBusy={githubBusy}
              onTest={() => void testGithub()}
              onSave={() => void saveGithubPat()}
              onClear={() => void clearGithubCredential()}
            />
          </SectionCard>

          <SectionCard
            title="LLM providers"
            description="Pick a provider, save a key, then choose any model from that provider’s catalog."
          >
            {loading && <p className="text-[13px] text-muted">Loading settings…</p>}
            {!loading && llm && (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-3.5 py-3">
                  <div className="text-[12.5px] text-muted">
                    Source: <b className="text-ink">{llm.source}</b>
                    <span className="mx-2 text-faint">·</span>
                    Active model{" "}
                    <span className="font-mono text-ink">{llm.resolved_model || "—"}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!!busy}
                    onClick={() => void clearByok()}
                  >
                    {busy === "clear" ? "Clearing…" : "Clear BYOK"}
                  </button>
                </div>

                <div className="divide-y divide-line">
                  {PROVIDERS.map((p) => {
                    const status = llm.providers[p.id];
                    const draft = drafts[p.id];
                    const isActive = active === p.id;
                    const canFetch = Boolean(draft.api_key.trim() || status?.configured);
                    return (
                      <div key={p.id} className="py-4 first:pt-1 last:pb-1">
                        <div className="mb-3.5 flex items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="radio"
                              name="active-provider"
                              checked={isActive}
                              disabled={busy === "active"}
                              onChange={() => void setActiveProvider(p.id)}
                              className="accent-[var(--color-accent-solid)]"
                            />
                            <span className="sr-only">Set {p.name} active</span>
                          </label>
                          <div
                            className="grid size-9 flex-none place-items-center rounded-[10px] text-[13px] font-bold text-white"
                            style={{ background: p.color }}
                          >
                            {p.monogram}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13.5px] font-semibold">
                              {p.name}
                              {isActive && (
                                <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-accent-ink">
                                  active
                                </span>
                              )}
                            </div>
                            <div className="text-[12px] text-faint">{p.hint}</div>
                          </div>
                          {status?.configured ? (
                            <SavedPill mask={status.mask} />
                          ) : (
                            <span className="text-[12px] text-faint">Not connected</span>
                          )}
                        </div>
                        <div className="grid gap-2.5">
                          <KeyField
                            value={draft.api_key}
                            onChange={(v) => patchDraft(p.id, { api_key: v })}
                            placeholder={
                              status?.configured
                                ? `Leave blank to keep ${status.mask || "saved key"}`
                                : p.placeholder
                            }
                          />
                          <ModelPicker
                            provider={p.id}
                            value={draft.model}
                            onChange={(model) => patchDraft(p.id, { model })}
                            canFetch={canFetch}
                            apiKey={draft.api_key.trim() || undefined}
                            ariaLabel={`${p.name} model`}
                          />
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={!!busy}
                              onClick={() => void testProvider(p.id)}
                            >
                              {busy === `test-${p.id}` ? "Testing…" : "Test"}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={!!busy}
                              onClick={() => void saveProvider(p.id)}
                            >
                              {busy === p.id ? "Saving…" : "Save key"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Custom */}
                  <div className="py-4 last:pb-1">
                    <div className="mb-3.5 flex items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="active-provider"
                          checked={active === "custom"}
                          disabled={busy === "active"}
                          onChange={() => void setActiveProvider("custom")}
                          className="accent-[var(--color-accent-solid)]"
                        />
                        <span className="sr-only">Set custom active</span>
                      </label>
                      <div className="grid size-9 flex-none place-items-center rounded-[10px] bg-canvas text-[13px] font-bold text-muted ring-1 ring-line">
                        S
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold">
                          Self-hosted
                          {active === "custom" && (
                            <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-accent-ink">
                              active
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-faint">Any OpenAI-compatible endpoint</div>
                      </div>
                      {llm.providers.custom.configured ? (
                        <SavedPill mask={llm.providers.custom.mask} />
                      ) : (
                        <span className="text-[12px] text-faint">Not connected</span>
                      )}
                    </div>
                    <div className="grid gap-2.5">
                      <label className="block">
                        <span className="mb-1.5 block text-[12.5px] font-semibold">Base URL</span>
                        <input
                          type="text"
                          value={drafts.custom.base_url}
                          onChange={(e) => patchDraft("custom", { base_url: e.target.value })}
                          placeholder="https://…/v1"
                          className="min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 font-mono text-[13px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[12.5px] font-semibold">API key</span>
                        <KeyField
                          value={drafts.custom.api_key}
                          onChange={(v) => patchDraft("custom", { api_key: v })}
                          placeholder={
                            llm.providers.custom.configured
                              ? `Leave blank to keep ${llm.providers.custom.mask || "saved key"}`
                              : "sk-…"
                          }
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[12.5px] font-semibold">Model</span>
                        <ModelPicker
                          provider="custom"
                          value={drafts.custom.model}
                          onChange={(model) => patchDraft("custom", { model })}
                          canFetch={Boolean(
                            (drafts.custom.api_key.trim() || llm.providers.custom.configured) &&
                              drafts.custom.base_url.trim(),
                          )}
                          apiKey={drafts.custom.api_key.trim() || undefined}
                          baseUrl={drafts.custom.base_url.trim() || undefined}
                          ariaLabel="Custom model"
                        />
                      </label>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={!!busy}
                          onClick={() => void testProvider("custom")}
                        >
                          {busy === "test-custom" ? "Testing…" : "Test"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={!!busy}
                          onClick={() => void saveProvider("custom")}
                        >
                          {busy === "custom" ? "Saving…" : "Save key"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function GitHubSection({
  userEmail,
  github,
  githubToken,
  setGithubToken,
  githubBusy,
  onTest,
  onSave,
  onClear,
}: {
  userEmail?: string | null;
  github: GitHubSettings | null;
  githubToken: string;
  setGithubToken: (v: string) => void;
  githubBusy: string | null;
  onTest: () => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <div className="grid gap-3">
      {github?.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-3.5 py-3">
          <div className="text-[12.5px] text-muted">
            Connected as{" "}
            <b className="text-ink">@{github.login || "user"}</b>
            {github.source ? (
              <>
                <span className="mx-2 text-faint">·</span>
                via {github.source.toUpperCase()}
              </>
            ) : null}
            {github.mask ? (
              <>
                <span className="mx-2 text-faint">·</span>
                <span className="font-mono">{github.mask}</span>
              </>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!!githubBusy}
            onClick={onClear}
          >
            {githubBusy === "clear" ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">
          No GitHub credential connected{userEmail ? ` for ${userEmail}` : ""}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <a className="btn btn-ghost btn-sm" href={githubOAuthStartUrl()}>
          Connect with GitHub OAuth
        </a>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-semibold">Personal access token</span>
        <KeyField
          value={githubToken}
          onChange={setGithubToken}
          placeholder={github?.pat_configured ? `Leave blank or replace ${github.mask || "token"}` : "ghp_…"}
          autoComplete="off"
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-ghost btn-sm" disabled={!!githubBusy} onClick={onTest}>
          {githubBusy === "test" ? "Testing…" : "Test"}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!!githubBusy} onClick={onSave}>
          {githubBusy === "save" ? "Saving…" : "Save token"}
        </button>
      </div>
    </div>
  );
}
