"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginPage } from "@/components/auth/login-page";
import { useAuth } from "@/components/layout/providers";

/**
 * /login — standalone login page route.
 *
 * When the user is already authenticated, redirect to the dashboard.
 * Otherwise show the login form. The AppShell also gates on auth, but
 * this page handles the case where the user lands on /login directly
 * while already logged in.
 */
export default function LoginRoutePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    );
  }

  return <LoginPage />;
}
