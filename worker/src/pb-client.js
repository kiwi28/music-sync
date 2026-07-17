// PocketBase admin client — singleton, used by the worker for all API calls.
// The worker authenticates as the PocketBase superuser so it can read/write
// records across all user accounts without collection-rule restrictions.

import PocketBase from "pocketbase";

const PB_URL = process.env.POCKETBASE_URL || "http://pocketbase:8090";
const PB_ADMIN_EMAIL =
  process.env.PB_SUPERUSER_EMAIL || "admin@musicsync.local";
const PB_ADMIN_PASSWORD =
  process.env.PB_SUPERUSER_PASSWORD || "change-me";

/** @type {PocketBase | null} */
let pb = null;

/**
 * Return an authenticated PocketBase admin client.
 * Re-authenticates if the existing session is expired or has become invalid
 * (e.g. because PocketBase restarted and regenerated its JWT signing key).
 *
 * The SDK's authStore.isValid only checks JWT expiry — it does not verify that
 * the token's signature is still accepted by the server. When PocketBase
 * restarts without a fixed PB_ENCRYPTION_KEY, it generates a new signing key,
 * silently invalidating all existing admin tokens. We detect this by making a
 * lightweight probe request before returning the cached client.
 */
export async function getAdminClient() {
  if (pb && pb.authStore.isValid) {
    // Verify the token is still accepted by the server — isValid() only
    // checks expiry, not signature validity. If PocketBase restarted without
    // a fixed PB_ENCRYPTION_KEY, the JWT signing key changed and our cached
    // token is cryptographically invalid.
    try {
      await pb.admins.authRefresh();
      return pb;
    } catch (err) {
      // Distinguish between network errors (PocketBase not ready) and actual
      // auth failures (token rejected after server restart with new key).
      if (err?.status === 401) {
        console.log(
          "[pb-client] Cached token rejected (401) — re-authenticating...",
        );
      } else {
        console.log(
          "[pb-client] Token probe failed (status %d, may be network) — re-authenticating...",
          err?.status || 0,
        );
      }
      pb.authStore.clear();
      pb = null;
    }
  }

  pb = new PocketBase(PB_URL);

  // pb.admins.authWithPassword hits /api/collections/_superusers/auth-with-password
  await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
  console.log("[pb-client] Authenticated as superuser");

  return pb;
}

/**
 * Wrap a PocketBase API call with automatic re-authentication on 401.
 * Long-running downloads (30+ min) may cause the admin token to expire
 * before track records are created. This wrapper catches 401 errors,
 * re-authenticates, and retries the operation once.
 *
 * @template T
 * @param {() => Promise<T>} fn - A function that calls PocketBase APIs
 * @returns {Promise<T>}
 */
export async function withReauth(fn) {
  try {
    return await fn();
  } catch (err) {
    // PocketBase ClientResponseError has status and response on the error object
    if (err && typeof err === "object" && /** @type {any} */ (err).status === 401) {
      console.log("[pb-client] Token expired mid-operation — re-authenticating...");
      // Force re-auth on next getAdminClient call
      if (pb) pb.authStore.clear();
      pb = null;
      await getAdminClient();
      // Retry once with fresh token
      return await fn();
    }
    throw err;
  }
}
