import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";

/**
 * Create a browser-side PocketBase client.
 * Singleton pattern — reused across the client app.
 *
 * Uses NEXT_PUBLIC_POCKETBASE_URL so it works client-side.
 * Auth tokens are stored in a cookie managed by PocketBase's authStore.
 */
let browserClient: PocketBase | null = null;

export function createBrowserClient(): PocketBase {
  if (browserClient) return browserClient;

  browserClient = new PocketBase(PB_URL);

  // Auto-refresh auth cookie on changes
  browserClient.authStore.onChange(() => {
    const cookie = browserClient!.authStore.exportToCookie({
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
    });
    document.cookie = cookie;
  });

  return browserClient;
}

/** Token refresh margin in seconds — refresh if expiring within 5 minutes */
const TOKEN_REFRESH_MARGIN = 300;

/**
 * Check if an access token is expired or about to expire.
 * Works on both client and server.
 */
export function isTokenExpired(expiresAt: string | Date): boolean {
  const expiry = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return Date.now() > expiry.getTime() - TOKEN_REFRESH_MARGIN * 1000;
}
