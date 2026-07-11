/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // ── user_connections ──
  const userConnections = new Collection({
    name: "user_connections",
    type: "base",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "@request.auth.id != ''",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
    fields: [
      { name: "user", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", cascadeDelete: true, maxSelect: 1 } },
      { name: "platform", type: "text", required: true, options: { max: 50 } },
      { name: "access_token", type: "text", required: false },
      { name: "refresh_token", type: "text", required: false },
      { name: "token_expires_at", type: "date", required: false },
      { name: "platform_user_id", type: "text", required: false },
      { name: "platform_username", type: "text", required: false },
    ],
  });
  app.save(userConnections);

  // ── playlists ──
  const playlists = new Collection({
    name: "playlists",
    type: "base",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "@request.auth.id != ''",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
    fields: [
      { name: "user", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", cascadeDelete: true, maxSelect: 1 } },
      { name: "name", type: "text", required: true, options: { max: 200 } },
      { name: "description", type: "text", required: false },
      { name: "platform", type: "text", required: true, options: { max: 50 } },
      { name: "platform_id", type: "text", required: true, options: { max: 100 } },
      { name: "track_count", type: "number", required: false, options: { min: 0, onlyInt: true } },
      { name: "last_synced", type: "date", required: false },
      { name: "cover_url", type: "url", required: false },
      { name: "is_public", type: "bool", required: false },
    ],
  });
  app.save(playlists);

  // ── tracks ──
  const tracks = new Collection({
    name: "tracks",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      { name: "title", type: "text", required: true, options: { max: 300 } },
      { name: "artist", type: "text", required: true, options: { max: 500 } },
      { name: "album", type: "text", required: false, options: { max: 500 } },
      { name: "platform", type: "text", required: true, options: { max: 50 } },
      { name: "platform_id", type: "text", required: true, options: { max: 100 } },
      { name: "duration_ms", type: "number", required: false, options: { min: 0, onlyInt: true } },
      { name: "isrc", type: "text", required: false, options: { max: 20 } },
      { name: "cover_url", type: "url", required: false },
    ],
  });
  app.save(tracks);

  // ── playlist_tracks ──
  const playlistTracks = new Collection({
    name: "playlist_tracks",
    type: "base",
    listRule: "playlist.user = @request.auth.id",
    viewRule: "playlist.user = @request.auth.id",
    createRule: "@request.auth.id != ''",
    updateRule: "playlist.user = @request.auth.id",
    deleteRule: "playlist.user = @request.auth.id",
    fields: [
      { name: "playlist", type: "relation", required: true, options: { collectionId: playlists.id, cascadeDelete: true, maxSelect: 1 } },
      { name: "track", type: "relation", required: true, options: { collectionId: tracks.id, cascadeDelete: false, maxSelect: 1 } },
      { name: "position", type: "number", required: true, options: { min: 0, onlyInt: true } },
      { name: "added_at", type: "date", required: false },
    ],
  });
  app.save(playlistTracks);

  // ── sync_jobs ──
  const syncJobs = new Collection({
    name: "sync_jobs",
    type: "base",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "@request.auth.id != ''",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
    fields: [
      { name: "user", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", cascadeDelete: true, maxSelect: 1 } },
      { name: "playlist", type: "relation", required: true, options: { collectionId: playlists.id, cascadeDelete: true, maxSelect: 1 } },
      { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["pending", "running", "completed", "failed"] } },
      { name: "started_at", type: "date", required: false },
      { name: "completed_at", type: "date", required: false },
      { name: "tracks_added", type: "number", required: false, options: { min: 0, onlyInt: true } },
      { name: "tracks_removed", type: "number", required: false, options: { min: 0, onlyInt: true } },
      { name: "error", type: "text", required: false },
      { name: "log", type: "text", required: false },
    ],
  });
  app.save(syncJobs);
}, (app) => {
  for (const name of ["sync_jobs", "playlist_tracks", "tracks", "playlists", "user_connections"]) {
    const col = app.findCollectionByNameOrId(name);
    app.delete(col);
  }
});
