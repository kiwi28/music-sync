/// <reference path="../pb_data/types.d.ts" />

/**
 * Sets access rules on all collections so authenticated users can
 * create, read, update, and delete their OWN records.
 *
 * Without these rules, the migration 1783699975 correctly adds the
 * data fields, but the PocketBase API still returns 403/404 on any
 * write because createRule/updateRule/deleteRule default to null.
 */
migrate((app) => {
  const collections = [
    "user_connections",
    "playlists",
    "tracks",
    "playlist_tracks",
    "sync_jobs",
  ];

  for (const name of collections) {
    const col = app.findCollectionByNameOrId(name);

    // All collections: owner can CRUD their own records
    col.listRule = "user = @request.auth.id";
    col.viewRule = "user = @request.auth.id";
    col.createRule = "@request.auth.id != ''";
    col.updateRule = "user = @request.auth.id";
    col.deleteRule = "user = @request.auth.id";

    app.save(col);
  }
}, (app) => {
  // Rollback: reset all rules to null
  const collections = [
    "user_connections",
    "playlists",
    "tracks",
    "playlist_tracks",
    "sync_jobs",
  ];

  for (const name of collections) {
    const col = app.findCollectionByNameOrId(name);
    col.listRule = null;
    col.viewRule = null;
    col.createRule = null;
    col.updateRule = null;
    col.deleteRule = null;
    app.save(col);
  }
});
