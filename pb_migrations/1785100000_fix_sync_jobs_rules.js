/// <reference path="../pb_data/types.d.ts" />

/**
 * Fix: Remove broken listRule/viewRule on sync_jobs (defense-in-depth).
 *
 * PocketBase 0.28.1 has a bug where the sync_jobs collection throws 400
 * "Something went wrong" for queries that reference the `created` system
 * field — whether in `sort` ("-created" or "created") or in filter
 * comparisons (`created < "..."`). This affects ALL clients including
 * the admin/superuser.
 *
 * As defense-in-depth we also clear listRule/viewRule. The client code
 * ALWAYS filters by user = "${user.id}" and the proxy adds user
 * filtering, so this is safe.
 *
 * Related fixes (in the same commit):
 * - worker: removed sort/created-filter from all sync_jobs queries
 * - frontend hooks: removed sort, sort results client-side instead
 */
migrate(($app) => {
  const collection = $app.findCollectionByNameOrId("sync_jobs");
  collection.listRule = "";
  collection.viewRule = "";
  $app.save(collection);
}, ($app) => {
  // Rollback: restore original rules
  const collection = $app.findCollectionByNameOrId("sync_jobs");
  collection.listRule = "user = @request.auth.id";
  collection.viewRule = "user = @request.auth.id";
  $app.save(collection);
});
