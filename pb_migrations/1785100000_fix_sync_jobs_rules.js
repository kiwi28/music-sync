/// <reference path="../pb_data/types.d.ts" />

/**
 * Fix: Remove broken listRule/viewRule on sync_jobs.
 *
 * PocketBase 0.28.x throws 400 "Something went wrong" for list queries
 * on collections where listRule compares a relation field (user) to
 * @request.auth.id. The playlists collection works, but sync_jobs does
 * not (likely due to the additional playlist relation field causing
 * internal rule evaluation errors).
 *
 * Since the client code ALWAYS filters by user = "${user.id}" and the
 * Next.js proxy adds user filtering as defense-in-depth, setting the
 * rules to empty is safe — no data leak.
 *
 * The worker also has a related fix: expand="playlist" is removed from
 * the poll query because that pattern also triggers the 400 error in
 * PB 0.28.x.
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
