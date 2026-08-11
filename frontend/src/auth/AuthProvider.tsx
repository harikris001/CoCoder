import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, api, type User } from "../api/client";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (email: string, displayName: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    api.getCurrentUser()
      .then((next) => {
        if (!cancelled) {
          setUser(next);
          setStatus("authenticated");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.error("Unable to restore authentication session", error);
        }
        setUser(null);
        setStatus("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(email: string, password: string) {
    const next = await api.signIn({ email, password });
    setUser(next);
    setStatus("authenticated");
    return next;
  }

  async function signUp(email: string, displayName: string, password: string) {
    const next = await api.signUp({ email, display_name: displayName, password });
    setUser(next);
    setStatus("authenticated");
    return next;
  }

  async function signOut() {
    try {
      await api.signOut();
    } finally {
      setUser(null);
      setStatus("unauthenticated");
    }
  }

  return (
    <AuthContext.Provider value={{ user, status, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
