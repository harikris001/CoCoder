import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  BoltIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GridIcon,
  IssueIcon,
  LogoutIcon,
  RepoIcon,
  SettingsIcon,
} from "./icons";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: GridIcon },
  { to: "/repos", label: "Repositories", icon: RepoIcon },
  { to: "/issue", label: "Issues", icon: IssueIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const LS_KEY = "cocoder.sidebar.collapsed";

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(LS_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);
  return [collapsed, toggle] as const;
}

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [collapsed, toggle] = useCollapsed();

  const profileName = user?.display_name || user?.email || "CoCoder user";
  const profileEmail = user?.email || "";

  const initials =
    profileName
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "CO";

  return (
    <div className="flex min-h-screen bg-canvas font-sans text-ink">
      <aside
        className={`sticky top-0 flex h-screen flex-col border-r border-line bg-surface p-4 text-[13.5px] transition-[width] duration-200 ease-out ${
          collapsed
            ? "relative z-40 w-[68px]"
            : "relative z-40 w-60"
        }`}
      >
        {/* Collapse toggle — floats on the right edge */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-5 z-50 grid size-[30px] place-items-center rounded-full border border-line bg-surface text-muted shadow-sm transition-colors hover:bg-canvas hover:text-ink"
        >
          {collapsed ? (
            <ChevronRightIcon size={15} />
          ) : (
            <ChevronLeftIcon size={15} />
          )}
        </button>

        {/* Brand */}
        <div
          className={`mb-6 flex items-center gap-2.5 ${
            collapsed ? "justify-center" : "px-2"
          }`}
        >
          <BoltIcon className="text-accent" size={22} strokeWidth={2} />
          {!collapsed && (
            <>
              <span>CoCoder</span>
              <span className="ml-auto rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                v0.1
              </span>
            </>
          )}
        </div>

        <nav
          className={`space-y-1 ${collapsed ? "flex flex-col items-center" : ""}`}
        >
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                collapsed
                  ? `flex w-full flex-col items-center justify-center gap-1 rounded-lg py-2 transition-colors ${
                      isActive
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "text-muted hover:bg-canvas hover:text-ink"
                    }`
                  : `flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${
                      isActive
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "text-muted hover:bg-canvas hover:text-ink"
                    }`
              }
            >
              <Icon size={18} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto">
          {!collapsed && (
            <div className="px-2 pb-2 text-[11px] uppercase tracking-[0.07em] text-faint">
              plan · scale
            </div>
          )}
          <div
            className={
              collapsed
                ? "flex flex-col items-center gap-2.5 rounded-xl border border-line p-2"
                : "flex items-center gap-2.5 rounded-xl border border-line p-2.5"
            }
          >
            <div className="grid size-8 flex-none place-items-center rounded-full bg-ink text-xs font-bold text-surface">
              {initials}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{profileName}</div>
                  <div className="truncate text-xs text-muted">{profileEmail}</div>
                </div>
                <button
                  type="button"
                  aria-label="Sign out"
                  title="Sign out"
                  onClick={() => {
                    void signOut().catch(() => undefined).finally(() => navigate("/"));
                  }}
                  className="ml-auto grid size-8 place-items-center rounded-md text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <LogoutIcon size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
