"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useAuth } from "@/components/layout/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { registerSchema, loginSchema } from "@/lib/validators";
import { consumeFlash } from "@/lib/flash";
import { ZodError } from "zod";

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Consume any flash message set by server-side redirects (e.g. expired
  // session during Spotify OAuth callback).
  useEffect(() => {
    const flash = consumeFlash();
    if (flash) {
      setServerError(flash.message);
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setServerError(null);

    try {
      if (mode === "register") {
        const data = registerSchema.parse({ email, password, passwordConfirm });
        setSubmitting(true);
        await register(data.email, data.password, data.passwordConfirm);
      } else {
        const data = loginSchema.parse({ email, password });
        setSubmitting(true);
        await login(data.email, data.password);
      }
    } catch (err) {
      if (err instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          const field = issue.path[0] as string;
          fieldErrors[field] = issue.message;
        }
        setErrors(fieldErrors);
      } else if (err instanceof Error) {
        setServerError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-lg font-black text-black">
            MS
          </div>
          <h1 className="text-xl font-bold tracking-tight">Music Sync</h1>
          <p className="mt-1 text-sm text-white/40">
            Cross-platform playlist synchronization
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{mode === "login" ? "Sign in" : "Create account"}</CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Sign in to manage your music library"
                : "Create an account to get started"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {serverError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {serverError}
                </div>
              )}

              <Input
                id="email"
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
              />

              <Input
                id="password"
                label="Password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
              />

              {mode === "register" && (
                <Input
                  id="passwordConfirm"
                  label="Confirm Password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  error={errors.passwordConfirm}
                />
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting
                  ? "Loading…"
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-white/40">
              {mode === "login" ? (
                <>
                  No account?{" "}
                  <button
                    type="button"
                    onClick={() => { setMode("register"); setErrors({}); setServerError(null); }}
                    className="font-medium text-white/70 underline underline-offset-4 hover:text-white"
                  >
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => { setMode("login"); setErrors({}); setServerError(null); }}
                    className="font-medium text-white/70 underline underline-offset-4 hover:text-white"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
