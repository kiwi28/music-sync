"use client";

import { ThemeProvider } from "next-themes";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import PocketBase, { type AuthRecord } from "pocketbase";
import { createBrowserClient } from "@/lib/pocketbase";
import type { UserConnection, Platform } from "@/lib/types";

// ── PocketBase Context ──

interface AuthContextValue {
  pb: PocketBase;
  user: AuthRecord | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, passwordConfirm: string) => Promise<void>;
  logout: () => void;
  connections: UserConnection[];
  refreshConnections: () => Promise<void>;
  connectedPlatforms: Platform[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <Providers>");
  return ctx;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [pb] = useState(() => createBrowserClient());
  const [user, setUser] = useState<AuthRecord | null>(pb.authStore.record);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [connectedPlatforms, setConnectedPlatforms] = useState<Platform[]>([]);

  // Listen for auth changes
  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((_token, record) => {
      setUser(record || null);
    });

    // Seed from stored cookie
    if (pb.authStore.isValid) {
      pb.collection("users")
        .authRefresh()
        .then(() => setLoading(false))
        .catch((err: unknown) => {
          // Only clear auth on explicit 401/403 — NOT on network errors or 503s.
          // Transient backend issues shouldn't log the user out.
          const status = (err as { status?: number })?.status;
          if (status === 401 || status === 403) {
            console.warn("[auth] Token rejected by server — clearing session");
            pb.authStore.clear();
          } else {
            console.warn("[auth] Could not refresh token (server may be unavailable):", (err as Error)?.message ?? err);
            // Keep the existing token — it may still be valid when the server recovers
          }
          setLoading(false);
        });
    } else {
      setLoading(false);
    }

    return unsubscribe;
  }, [pb]);

  const refreshConnections = useCallback(async () => {
    if (!pb.authStore.isValid) {
      setConnections([]);
      setConnectedPlatforms([]);
      return;
    }
    try {
      const records = await pb
        .collection("user_connections")
        .getFullList<UserConnection>({
          filter: `user = "${pb.authStore.record!.id}"`,
        });
      setConnections(records);
      setConnectedPlatforms(records.map((c) => c.platform as Platform));
    } catch {
      // User might not have access yet
    }
  }, [pb]);

  useEffect(() => {
    if (user) refreshConnections();
  }, [user, refreshConnections]);

  const login = useCallback(
    async (email: string, password: string) => {
      await pb.collection("users").authWithPassword(email, password);
    },
    [pb]
  );

  const register = useCallback(
    async (email: string, password: string, passwordConfirm: string) => {
      if (password !== passwordConfirm) {
        throw new Error("Passwords do not match");
      }
      await pb.collection("users").create({ email, password, passwordConfirm });
      await pb.collection("users").authWithPassword(email, password);
    },
    [pb]
  );

  const logout = useCallback(() => {
    pb.authStore.clear();
    setConnections([]);
    setConnectedPlatforms([]);
  }, [pb]);

  return (
    <AuthContext.Provider
      value={{
        pb,
        user,
        loading,
        login,
        register,
        logout,
        connections,
        refreshConnections,
        connectedPlatforms,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ── Combined Providers ──

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
