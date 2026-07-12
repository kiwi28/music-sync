import { cookies } from "next/headers";

const FLASH_COOKIE = "flash";
const MAX_AGE = 60; // 1 minute — enough for the redirect round-trip

export interface FlashMessage {
  type: "error" | "success";
  message: string;
  /** The route this flash is intended for. Only consumed on this path. */
  route: string;
}

/**
 * Set a flash message cookie before a redirect.
 * Server-side only — call from API routes or server components.
 *
 * The cookie is short-lived (60s) and non-httpOnly so the client can
 * read it on the next page load. It contains no secrets — just a
 * human-readable message, a type key, and a target route.
 */
export async function setFlash(message: FlashMessage): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(FLASH_COOKIE, JSON.stringify(message), {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

/**
 * Read and consume the flash message on the client, but ONLY if the
 * current route matches the flash's intended target. Returns null
 * otherwise (the flash persists for the next matching route).
 *
 * Call this in a useEffect on pages that should display post-redirect
 * messages (settings, login, etc.).
 */
export function consumeFlash(): FlashMessage | null {
  if (typeof document === "undefined") return null;

  const match = document.cookie.match(/(?:^|;\s*)flash=([^;]*)/);
  if (!match) return null;

  let parsed: FlashMessage;
  try {
    parsed = JSON.parse(decodeURIComponent(match[1])) as FlashMessage;
  } catch {
    // Malformed cookie — clear it
    document.cookie = "flash=; Max-Age=0; Path=/";
    return null;
  }

  // Only consume if this is the intended route
  if (parsed.route !== window.location.pathname) return null;

  // Expire the cookie immediately — one-time read
  document.cookie = "flash=; Max-Age=0; Path=/";
  return parsed;
}
