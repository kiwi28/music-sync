import "server-only";

import { cookies } from "next/headers";
import type { FlashMessage } from "./flash";

const FLASH_COOKIE = "flash";
const MAX_AGE = 60; // 1 minute — enough for the redirect round-trip

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
