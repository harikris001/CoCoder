import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({
  size = 18,
  strokeWidth = 1.8,
  children,
  ...rest
}: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const BoltIcon = (p: P) => (
  <Svg {...p}>
    <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z" />
  </Svg>
);

export const GridIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

export const RepoIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 6a2 2 0 0 1 2-2h12v17H6a2 2 0 0 1-2-2V6z" />
    <path d="M8 4v17M12 10h4M12 13h4" />
  </Svg>
);

export const IssueIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 1 3.5 6.6L4 20l1.4-3.3" />
  </Svg>
);

export const LogsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Svg>
);

export const SettingsIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);

export const SearchIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4-4" />
  </Svg>
);

export const PlusIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const SyncIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
  </Svg>
);

export const CopyIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const LogoutIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);

export const CheckIcon = (p: P) => (
  <Svg {...p} strokeWidth={2.4}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const PlayIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M5 3l14 9-14 9V3z" />
  </Svg>
);

export const SpinnerIcon = (p: P) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M21 12a9 9 0 1 1-6.2-8.6" />
  </Svg>
);

export const OpenIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M7 17 17 7M7 7h10v10" />
  </Svg>
);

export const CommentIcon = (p: P) => (
  <Svg {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
);

export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </Svg>
);

export const BrowseIcon = LogsIcon;

export const CaretDownIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const EyeIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const ChevronLeftIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const ChevronRightIcon = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const EyeOffIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <path d="m1 1 22 22" />
  </Svg>
);

export const SunIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </Svg>
);

export const MoonIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.8}>
    <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
  </Svg>
);

export const MonitorIcon = (p: P) => (
  <Svg {...p} strokeWidth={1.8}>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Svg>
);