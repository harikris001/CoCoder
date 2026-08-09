import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  api,
  type LlmProviderId,
  type LlmSettings,
} from "../api/client";
import { TopbarShell } from "../components/Topbar";
import { useToast } from "../components/Toast";
import { CheckIcon, EyeIcon, EyeOffIcon } from "../components/icons";

/** Profile + GitHub stay local mock for now (no backend). */
const LS_MOCK = "cocoder.settings.mock.v1";

type ProfileSettings = { name: string; email: string; username: string };
type MockLocal = {
  profile: ProfileSettings;
  github: { token: string; connected: boolean };
};

const DEFAULT_MOCK: MockLocal = {
  profile: { name: "Aisha Khan", email: "aisha@cocoder.dev", username: "aishakhan" },
  github: { token: "", connected: false },
};

function loadMock(): MockLocal {
  try {
    const raw = localStorage.getItem(LS_MOCK);
    if (!raw) return DEFAULT_MOCK;
    const parsed = JSON.parse(raw) as Partial<MockLocal>;
    return {
      profile: { ...DEFAULT_MOCK.profile, ...parsed.profile },
      github: { ...DEFAULT_MOCK.github, ...parsed.github },
    };
  } catch {
    return DEFAULT_MOCK;
  }
}

function persistMock(mock: MockLocal) {
  try {
    localStorage.setItem(LS_MOCK, JSON.stringify(mock));
  } catch {
    // ignore
  }
}

const PROVIDERS: Array<{
  id: Exclude<LlmProviderId, "custom">;
  name: string;
  hint: string;
  monogram: string;
  color: string;
  models: string[];
  placeholder: string;
}> = [
  {
    id: "openai",
    name: "OpenAI",
    hint: "GPT & o-series",
    monogram: "O",
    color: "#0d1526",
    models: ["gpt-4o", "gpt-4.1", "o3-mini"],
    placeholder: "sk-…",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    hint: "Claude models",
    monogram: "A",
    color: "#c15f3c",
    models: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
    placeholder: "sk-ant-…",
  },
  {
    id: "google",
    name: "Google",
    hint: "Gemini models",
    monogram: "G",
    color: "#4285f4",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    placeholder: "AIza…",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    hint: "Multi-model gateway",
    monogram: "R",
    color: "#6b4eff",
    models: [
      "deepseek/deepseek-v4-flash",
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4.5",
      "google/gemini-2.5-pro",
    ],
    placeholder: "sk-or-…",
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
        autoComplete={autoComplete ?? "off"}
        spellCheck={false}
        className="min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 pr-10 text-[13px] font-mono text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
      />
      <button
        type="button"
        aria-label={visible ? "Hide key" : "Show key"}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors hover:bg-canvas hover:text-ink"
      >
        {visible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
      </button>
    </div>
  );
}

function SectionCard({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1 max-w-[560px] text-[12.5px] text-muted">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function SavedPill({ mask }: { mask?: string | null }) {
  return (
    <span className="pill pill-ok">
      <CheckIcon size={12} />
      {mask ? `Saved ${mask}` : "Saved"}
    </span>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const [mock, setMock] = useState<MockLocal>(DEFAULT_MOCK);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [drafts, setDrafts] = useState<DraftKeys>(() => emptyDrafts(null));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyLlm = useCallback((next: LlmSettings) => {
    setLlm(next);
    setDrafts(emptyDrafts(next));
  }, []);

  const loadLlm = useCallback(async () => {
    const next = await api.getLlmSettings();
    applyLlm(next);
  }, [applyLlm]);

  useEffect(() => {
    setMock(loadMock());
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadLlm();
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

  const updateMock = (next: MockLocal) => {
    setMock(next);
    persistMock(next);
  };

  const setProfile = (patch: Partial<ProfileSettings>) =>
    updateMock({ ...mock, profile: { ...mock.profile, ...patch } });

  function handleTestGithub() {
    const token = mock.github.token.trim();
    if (!token) {
      toast("Enter a GitHub token first");
      return;
    }
    const looksValid =
      /^ghp_/.test(token) || /^gho_/.test(token) || /^github_pat_/.test(token) || token.length >= 30;
    updateMock({ ...mock, github: { ...mock.github, connected: looksValid } });
    toast(looksValid ? "GitHub connected (local mock)" : "That token doesn't look valid");
  }

  function handleGithubSave() {
    if (!mock.github.token.trim()) {
      toast("Enter a GitHub token to save");
      return;
    }
    updateMock({ ...mock, github: { ...mock.github, connected: true } });
    toast("GitHub token saved locally (not wired to server yet)");
  }

  function handleDisconnect() {
    updateMock({ ...mock, github: { token: "", connected: false } });
    toast("GitHub disconnected");
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
              Bring your own keys. Model API keys are stored encrypted on the CoCoder server and
              never returned in full after save. Profile remains a local preview for now.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">
              {error}
            </div>
          )}

          {/* Profile — static / local mock */}
          <SectionCard
            title="Profile"
            description="Who CoCoder addresses commits and PRs from. (Preview only — not wired to the server yet.)"
            aside={
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  updateMock(mock);
                  toast("Profile saved locally");
                }}
              >
                Save profile
              </button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-[96px_1fr]">
              <div className="flex flex-col items-center gap-2">
                <div className="grid size-20 place-items-center rounded-full bg-ink text-[26px] font-bold text-surface">
                  {mock.profile.name
                    .split(" ")
                    .map((s) => s[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <span className="text-[12px] text-faint">avatar</span>
              </div>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[12.5px] font-semibold">Display name</span>
                    <input
                      type="text"
                      value={mock.profile.name}
                      onChange={(e) => setProfile({ name: e.target.value })}
                      className="min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12.5px] font-semibold">Email</span>
                    <input
                      type="email"
                      value={mock.profile.email}
                      onChange={(e) => setProfile({ email: e.target.value })}
                      className="min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
                    />
                  </label>
                </div>
                <label className="block max-w-[240px]">
                  <span className="mb-1.5 block text-[12.5px] font-semibold">Username</span>
                  <div className="flex min-h-[44px] items-center overflow-hidden rounded-lg border border-line bg-surface">
                    <span className="pl-3 text-[13px] text-faint">@</span>
                    <input
                      type="text"
                      value={mock.profile.username}
                      onChange={(e) => setProfile({ username: e.target.value })}
                      className="min-h-[44px] min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-ink outline-none"
                    />
                  </div>
                </label>
              </div>
            </div>
          </SectionCard>

          <div className="h-4" />

          {/* GitHub — still local mock */}
          <SectionCard
            title="GitHub"
            description="CoCoder uses this token to open PRs from runs and read private repositories. (Local preview — server still uses GITHUB_TOKEN from .env.)"
            aside={
              mock.github.connected ? (
                <span className="pill pill-ok">Connected</span>
              ) : (
                <span className="pill pill-queued">Not connected</span>
              )
            }
          >
            <label className="mb-3.5 block">
              <span className="mb-1.5 block text-[12.5px] font-semibold">Personal access token</span>
              <KeyField
                value={mock.github.token}
                onChange={(v) =>
                  updateMock({ ...mock, github: { ...mock.github, token: v, connected: false } })
                }
                placeholder="ghp_… or github_pat_…"
                autoComplete="new-password"
              />
              <span className="mt-1.5 block font-mono text-[11.5px] text-faint">
                scopes: repo, read:org · fine-grained tokens with Contents + Pull requests
              </span>
            </label>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleTestGithub}>
                Test connection
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleGithubSave}>
                Save token
              </button>
              {mock.github.connected && (
                <button type="button" className="btn btn-ghost btn-sm text-danger-ink" onClick={handleDisconnect}>
                  Disconnect
                </button>
              )}
            </div>
          </SectionCard>

          <div className="h-4" />

          {/* LLM BYOK */}
          <SectionCard
            title="Model providers"
            description="Bring your own key for OpenAI, Anthropic, Google, OpenRouter, or a custom OpenAI-compatible endpoint. Only the active provider drives runs."
            aside={<span className="pill pill-ok">Bring your own key</span>}
          >
            {loading && <p className="text-[13px] text-muted">Loading provider settings…</p>}
            {!loading && llm && (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-[12.5px] text-muted">
                  <span>
                    Active: <b className="text-ink">{active}</b>
                  </span>
                  <span className="text-faint">·</span>
                  <span>
                    Source: <b className="text-ink">{llm.source}</b>
                  </span>
                  <span className="text-faint">·</span>
                  <span className="font-mono text-ink">{llm.resolved_model || "—"}</span>
                  <button
                    type="button"
                    className="ml-auto text-[12.5px] font-semibold text-danger-ink hover:underline disabled:opacity-50"
                    disabled={busy === "clear"}
                    onClick={() => void clearByok()}
                  >
                    Clear BYOK
                  </button>
                </div>

                <div className="divide-y divide-line">
                  {PROVIDERS.map((p) => {
                    const status = llm.providers[p.id];
                    const draft = drafts[p.id];
                    const isActive = active === p.id;
                    return (
                      <div key={p.id} className="py-4 first:pt-1 last:pb-1">
                        <div className="flex flex-col gap-3.5">
                          <div className="flex items-center gap-3">
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
                              style={{ backgroundColor: p.color }}
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
                          <div className="grid grid-cols-[minmax(0,1fr)_200px] items-start gap-2.5 max-[640px]:grid-cols-1">
                            <KeyField
                              value={draft.api_key}
                              onChange={(v) => patchDraft(p.id, { api_key: v })}
                              placeholder={
                                status?.configured
                                  ? `Leave blank to keep ${status.mask || "saved key"}`
                                  : p.placeholder
                              }
                            />
                            <select
                              aria-label={`${p.name} model`}
                              value={draft.model}
                              onChange={(e) => patchDraft(p.id, { model: e.target.value })}
                              className="min-h-[44px] cursor-pointer rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink"
                            >
                              {!p.models.includes(draft.model) && draft.model && (
                                <option value={draft.model}>{draft.model}</option>
                              )}
                              {p.models.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </div>
                          {p.id === "openrouter" && (
                            <input
                              type="text"
                              value={draft.model}
                              onChange={(e) => patchDraft(p.id, { model: e.target.value })}
                              placeholder="Or type any OpenRouter model slug"
                              className="min-h-[40px] w-full rounded-lg border border-line bg-surface px-3 font-mono text-[12.5px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
                            />
                          )}
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
                    <div className="grid gap-2.5 sm:grid-cols-2">
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
                        <span className="mb-1.5 block text-[12.5px] font-semibold">Model</span>
                        <input
                          type="text"
                          value={drafts.custom.model}
                          onChange={(e) => patchDraft("custom", { model: e.target.value })}
                          placeholder="e.g. llama-3.1-70b"
                          className="min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 font-mono text-[13px] text-ink outline-none focus:border-transparent focus:outline-2 focus:outline-accent"
                        />
                      </label>
                    </div>
                    <label className="mt-2.5 block">
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
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
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
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
