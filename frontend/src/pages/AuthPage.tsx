import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { AuthLayout } from "../components/AuthLayout";
import { EyeIcon, EyeOffIcon, SpinnerIcon } from "../components/icons";

type AuthMode = "signin" | "signup";

function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold">{label}</span>
      <span className="relative block">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={8}
          className="min-h-[46px] w-full rounded-lg border border-line bg-surface px-3 pr-11 text-[14px] text-ink outline-none transition-colors focus:border-transparent focus:outline-2 focus:outline-accent"
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((current) => !current)}
          className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-canvas hover:text-ink"
        >
          {visible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        </button>
      </span>
    </label>
  );
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { signIn, signUp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (isSignup && !displayName.trim()) {
      setError("Enter your name.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (isSignup && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      if (isSignup) await signUp(normalizedEmail, displayName.trim(), password);
      else await signIn(normalizedEmail, password);
      navigate(safeReturnTo(params.get("returnTo")), { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-8">
        <div className="mb-5 flex items-center gap-1 rounded-lg border border-line bg-surface p-1 text-[13px]">
          <Link
            to={`/signin${location.search}`}
            className={`flex-1 rounded-md px-3 py-2 text-center transition-colors ${!isSignup ? "bg-accent-soft font-semibold text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            Sign in
          </Link>
          <Link
            to={`/signup${location.search}`}
            className={`flex-1 rounded-md px-3 py-2 text-center transition-colors ${isSignup ? "bg-accent-soft font-semibold text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            Create account
          </Link>
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight">
          {isSignup ? "Create your CoCoder account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-[14px] leading-[1.6] text-muted">
          {isSignup
            ? "Set up your workspace and start watching agents close issues."
            : "Sign in to continue to your agent workspace."}
        </p>
      </div>

      <form className="space-y-4" onSubmit={submit} noValidate>
        {isSignup && (
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              className="min-h-[46px] w-full rounded-lg border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-colors focus:border-transparent focus:outline-2 focus:outline-accent"
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="min-h-[46px] w-full rounded-lg border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-colors focus:border-transparent focus:outline-2 focus:outline-accent"
          />
        </label>
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete={isSignup ? "new-password" : "current-password"}
        />
        {isSignup && (
          <PasswordField
            label="Confirm password"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
          />
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-danger-soft bg-danger-soft px-3 py-2.5 text-[13px] leading-[1.5] text-danger-ink">
            {error}
          </div>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary w-full">
          {busy && <SpinnerIcon size={16} className="animate-spin" />}
          {isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-7 text-center text-[12px] leading-[1.6] text-faint">
        {isSignup
          ? "By creating an account, you agree to use CoCoder responsibly."
          : "Need an account? "}
        {!isSignup && (
          <Link to={`/signup${location.search}`} className="font-semibold text-accent-ink hover:underline">
            Create one
          </Link>
        )}
      </p>
    </AuthLayout>
  );
}

export function SignInPage() {
  return <AuthPage mode="signin" />;
}

export function SignUpPage() {
  return <AuthPage mode="signup" />;
}
