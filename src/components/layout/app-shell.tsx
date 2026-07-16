"use client";

import { useAuth } from "./providers";
import { Sidebar } from "./sidebar";
import { ToastProvider } from "./toast-provider";
import { LoginPage } from "@/components/auth/login-page";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="ml-56 flex-1 overflow-y-auto px-8 py-6">{children}</main>
      </div>
    </ToastProvider>
  );
}
