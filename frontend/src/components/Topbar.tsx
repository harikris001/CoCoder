import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SearchIcon } from "./icons";

export function Crumb({
  items,
  current,
}: {
  items?: Array<{ href: string; label: string }>;
  current: string;
}) {
  return (
    <div className="text-[12.5px] text-muted">
      <Link to="/" className="hover:text-ink hover:underline">
        Home
      </Link>
      {items?.map((i) => (
        <span key={i.href}>
          <span className="mx-1.5 text-faint">/</span>
          <Link to={i.href} className="hover:text-ink hover:underline">
            {i.label}
          </Link>
        </span>
      ))}
      <span className="mx-1.5 text-faint">/</span>
      {current}
    </div>
  );
}

export function TopbarShell({
  crumb,
  title,
  titleSuffix,
  actions,
}: {
  crumb?: ReactNode;
  title: ReactNode;
  titleSuffix?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex min-h-[68px] items-center gap-5 border-b border-line bg-canvas px-8 max-[768px]:px-4">
      <div>
        {crumb && <div>{crumb}</div>}
        <h1 className="mt-0.5 flex items-center gap-3 text-[18px] font-semibold tracking-tight">
          {title}
          {titleSuffix}
        </h1>
      </div>
      {actions && (
        <div className="ml-auto flex flex-wrap items-center gap-2.5">{actions}</div>
      )}
    </header>
  );
}

export function SearchBox({
  placeholder = "Search…",
  value,
  onChange,
}: {
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex min-h-[44px] w-[280px] items-center gap-2 rounded-lg border border-line bg-surface px-3 max-[860px]:w-[200px] max-[720px]:hidden">
      <SearchIcon size={16} className="text-faint" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
      />
    </label>
  );
}