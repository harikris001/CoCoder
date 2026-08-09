import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

function AuthLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas text-sm text-muted">
      Restoring your session…
    </div>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <AuthLoading />;
  if (status === "unauthenticated") {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/signin?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <>{children}</>;
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <AuthLoading />;
  if (status === "authenticated") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
