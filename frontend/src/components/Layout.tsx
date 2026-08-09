import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  BoltIcon,
  GridIcon,
  IssueIcon,
  LogoutIcon,
  RepoIcon,
  SettingsIcon,
} from "./icons";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: GridIcon },
  { to: "/repos", label: "Repositories", icon: RepoIcon },
  { to: "/issue", label: "Issue view", icon: IssueIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-screen lg:grid-cols-[248px_1fr]">
      <aside className="flex flex-col bg-surface px-4 py-5 lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-line">
        <NavLink to="/" className="flex items-center gap-2.5 px-2 pb-4 text-[16px] font-bold tracking-tight">
          <BoltIcon className="text-accent" size={20} strokeWidth={2} />
          CoCoder
        </NavLink>

        <nav className="flex flex-col lg:flex-1">
          <div className="px-2 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-faint">
            Workspace
          </div>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `my-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-[11px] text-[14px] transition-colors ${
                  isActive
                    ? "bg-accent-soft font-semibold text-accent-ink"
                    : "text-muted hover:bg-canvas hover:text-ink"
                }`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto">
          <div className="px-2 pb-2 text-[11px] uppercase tracking-[0.07em] text-faint">
            plan · scale
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-line p-2.5">
            <div className="grid size-8 flex-none place-items-center rounded-full bg-ink text-xs font-bold text-surface">
              AK
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">Aisha Khan</div>
              <div className="truncate text-xs text-muted">aisha@cocoder.dev</div>
            </div>
            <button
              type="button"
              aria-label="Sign out"
              onClick={() => navigate("/")}
              className="ml-auto grid size-8 place-items-center rounded-md text-faint transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <LogoutIcon size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0">{children}</main>
    </div>
  );
}