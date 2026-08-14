import type { ThemePreference } from "../theme/ThemeProvider";
import { useTheme } from "../theme/ThemeProvider";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const OPTIONS: Array<{
  id: ThemePreference;
  label: string;
  Icon: typeof SunIcon;
}> = [
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
  { id: "system", label: "System", Icon: MonitorIcon },
];

function optionClass(active: boolean) {
  return active
    ? "bg-accent-soft font-semibold text-accent-ink"
    : "text-muted hover:bg-canvas hover:text-ink";
}

export function ThemeToggle({
  variant = "bar",
}: {
  variant?: "bar" | "segmented";
}) {
  const { preference, setPreference } = useTheme();

  if (variant === "segmented") {
    return (
      <div
        role="group"
        aria-label="Color theme"
        className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas p-1"
      >
        {OPTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={preference === id}
            onClick={() => setPreference(id)}
            className={`flex min-h-[40px] items-center justify-center gap-2 rounded-lg text-[13px] transition-colors ${optionClass(preference === id)}`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5"
    >
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={preference === id}
          onClick={() => setPreference(id)}
          className={`grid size-8 flex-1 place-items-center rounded-md transition-colors ${optionClass(preference === id)}`}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
