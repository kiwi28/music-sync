// Track deduplication logic.
// Before creating a new Track record, check if an equivalent track already
// exists. Checks in priority order:
//   1. ISRC (international standard recording code — most reliable)
//   2. platform + platform_id (e.g. Spotify track ID)
//   3. title + artist + platform (fuzzy match)

import { getAdminClient } from "./pb-client.js";
import { escapeFilter } from "./utils.js";

/**
 * Find an existing track in PocketBase that matches the given metadata.
 * Returns the track record if found, or null.
 *
 * @param {object} pb - Authenticated PocketBase client
 * @param {object} params
 * @param {string} [params.isrc]
 * @param {string} params.title
 * @param {string} params.artist
 * @param {string} params.platform
 * @param {string} [params.platformId]
 * @returns {Promise<object|null>}
 */
export async function findExistingTrack(pb, { isrc, title, artist, platform, platformId }) {
  // 1. Try ISRC — the gold standard for audio track identity
  if (isrc) {
    const result = await pb.collection("tracks").getList(1, 1, {
      filter: `isrc = "${escapeFilter(isrc)}"`,
    });
    if (result.totalItems > 0) return result.items[0];
  }

  // 2. Try platform + platform_id (e.g. spotify:track:abc123)
  if (platformId) {
    const result = await pb.collection("tracks").getList(1, 1, {
      filter: `platform = "${platform}" && platform_id = "${escapeFilter(platformId)}"`,
    });
    if (result.totalItems > 0) return result.items[0];
  }

  // 3. Fall back to title + artist + platform (fuzzy ~ match)
  const result = await pb.collection("tracks").getList(1, 1, {
    filter: `title ~ "${escapeFilter(title)}" && artist ~ "${escapeFilter(artist)}" && platform = "${platform}"`,
  });
  if (result.totalItems > 0) return result.items[0];

  return null;
}
