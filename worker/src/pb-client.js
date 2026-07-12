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
 * Re-authenticates if the existing session is expired.
 */
export async function getAdminClient() {
  if (pb && pb.authStore.isValid) {
    return pb;
  }

  pb = new PocketBase(PB_URL);

  // pb.admins.authWithPassword hits /api/collections/_superusers/auth-with-password
  await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
  console.log("[pb-client] Authenticated as superuser");

  return pb;
}
