/// <reference path="../pb_data/types.d.ts" />

/**
 * Adds all missing data fields to the stub collections.
 *
 * The original migrations (1783699878–1783699971) only created
 * collections with a bare "id" primary key and no data fields,
 * causing PocketBase to return "Missing collection context" on any query.
 *
 * This migration adds the fields the application actually uses.
 */
migrate((app) => {
  // ═══════════════════════════════════════════
  // user_connections
  // ═══════════════════════════════════════════
  const userConnections = app.findCollectionByNameOrId("user_connections");

  userConnections.fields.add({
    name: "user",
    type: "relation",
    required: true,
    options: {
      collectionId: "_pb_users_auth_",
      cascadeDelete: true,
      maxSelect: 1,
      displayFields: [],
    },
  });

  userConnections.fields.add({
    name: "platform",
    type: "text",
    required: true,
    options: { min: null, max: 50, pattern: "" },
  });

  userConnections.fields.add({
    name: "access_token",
    type: "text",
    required: false,
    options: { min: null, max: null, pattern: "" },
  });

  userConnections.fields.add({
    name: "refresh_token",
    type: "text",
    required: false,
    options: { min: null, max: null, pattern: "" },
  });

  userConnections.fields.add({
    name: "token_expires_at",
    type: "date",
    required: false,
    options: { min: null, max: null },
  });

  userConnections.fields.add({
    name: "platform_user_id",
    type: "text",
    required: false,
    options: { min: null, max: null, pattern: "" },
  });

  userConnections.fields.add({
    name: "platform_username",
    type: "text",
    required: false,
    options: { min: null, max: null, pattern: "" },
  });

  // Set list/view rules so the owner can see their own connections
  userConnections.listRule = "user = @request.auth.id";
  userConnections.viewRule = "user = @request.auth.id";

  app.save(userConnections);

  // ═══════════════════════════════════════════
  // playlists
  // ═══════════════════════════════════════════
  const playlists = app.findCollectionByNameOrId("playlists");

  playlists.fields.add({
    name: "user",
    type: "relation",
    required: true,
    options: {
      collectionId: "_pb_users_auth_",
      cascadeDelete: true,
      maxSelect: 1,
      displayFields: [],
    },
  });

  playlists.fields.add({
    name: "name",
    type: "text",
    required: true,
    options: { min: null, max: 200, pattern: "" },
  });

  playlists.fields.add({
    name: "description",
    type: "text",
    required: false,
    options: { min: null, max: null, pattern: "" },
  });

  playlists.fields.add({
    name: "platform",
    type: "text",
    required: true,
    options: { min: null, max: 50, pattern: "" },
  });

  playlists.fields.add({
    name: "platform_id",
    type: "text",
    required: true,
    options: { min: null, max: 100, pattern: "" },
  });

  playlists.fields.add({
    name: "track_count",
    type: "number",
    required: false,
    options: { min: 0, max: null, onlyInt: true },
  });

  playlists.fields.add({
    name: "last_synced",
    type: "date",
    required: false,
    options: { min: null, max: null },
  });

  playlists.fields.add({
    name: "cover_url",
    type: "url",
    required: false,
    options: { exceptDomains: [], onlyDomains: [] },
  });

  playlists.fields.add({
    name: "is_public",
    type: "bool",
    required: false,
  });

  playlists.listRule = "user = @request.auth.id";
  playlists.viewRule = "user = @request.auth.id";

  app.save(playlists);

  // ═══════════════════════════════════════════
  // tracks
  // ═══════════════════════════════════════════
  const tracks = app.findCollectionByNameOrId("tracks");

  tracks.fields.add({
    name: "title",
    type: "text",
    required: true,
    options: { min: null, max: 300, pattern: "" },
  });

  tracks.fields.add({
    name: "artist",
    type: "text",
    required: true,
    options: { min: null, max: 500, pattern: "" },
  });

  tracks.fields.add({
    name: "album",
    type: "text",
    required: false,
    options: { min: null, max: 500, pattern: "" },
  });

  tracks.fields.add({
    name: "platform",
    type: "text",
    required: true,
    options: { min: null, max: 50, pattern: "" },
  });

  tracks.fields.add({
    name: "platform_id",
    type: "text",
    required: true,
    options: { min: null, max: 100, pattern: "" },
  });

  tracks.fields.add({
    name: "duration_ms",
    type: "number",
    required: false,
    options: { min: 0, max: null, onlyInt: true },
  });

  tracks.fields.add({
    name: "isrc",
    type: "text",
    required: false,
    options: { min: null, max: 20, pattern: "" },
  });

  tracks.fields.add({
    name: "cover_url",
    type: "url",
    required: false,
    options: { exceptDomains: [], onlyDomains: [] },
  });

  app.save(tracks);

  // ═══════════════════════════════════════════
  // playlist_tracks (join table)
  // ═══════════════════════════════════════════
  const playlistTracks = app.findCollectionByNameOrId("playlist_tracks");

  playlistTracks.fields.add({
    name: "playlist",
    type: "relation",
    required: true,
    options: {
      collectionId: app.findCollectionByNameOrId("playlists").id,
      cascadeDelete: true,
      maxSelect: 1,
      displayFields: [],
    },
  });

  playlistTracks.fields.add({
    name: "track",
    type: "relation",
    required: true,
    options: {
      collectionId: app.findCollectionByNameOrId("tracks").id,
      cascadeDelete: true,
      maxSelect: 1,
      displayFields: [],
    },
  });

  playlistTracks.fields.add({
    name: "position",
    type: "number",
    required: true,
    options: { min: 0, max: null, onlyInt: true },
  });

  playlistTracks.fields.add({
    name: "added_at",
    type: "date",
    required: false,
    options: { min: null, max: null },
  });

  app.save(playlistTracks);

  // ═══════════════════════════════════════════
  // sync_jobs
  // ═══════════════════════════════════════════
  const syncJobs = app.findCollectionByNameOrId("sync_jobs");

  syncJobs.fields.add({
    name: "user",
    type: "relation",
    required: true,
    options: {
      collectionId: "_pb_users_auth_",
      cascadeDelete: true,
      maxSelect: 1,
      displayFields: [],
    },
  });

  syncJobs.fields.add({
    name: "playlist",
    type: "relation",
    required: true,
    options: {
      collectionId: app.findCollectionByNameOrId("playlists").id,
      cascadeDelete: true,
      maxSelect: 1,
      displayFields: [],
    },
  });

  syncJobs.fields.add({
    name: "status",
    type: "select",
    required: true,
    options: {
      maxSelect: 1,
      values: ["pending", "running", "completed", "failed"],
    },
  });

  syncJobs.fields.add({
    name: "started_at",
    type: "date",
    required: false,
    options: { min: null, max: null },
  });

  syncJobs.fields.add({
    name: "completed_at",
    type: "date",
    required: false,
    options: { min: null, max: null },
  });

  syncJobs.fields.add({
    name: "tracks_added",
    type: "number",
    required: false,
    options: { min: 0, max: null, onlyInt: true },
  });

  syncJobs.fields.add({
    name: "tracks_removed",
    type: "number",
    required: false,
    options: { min: 0, max: null, onlyInt: true },
  });

  syncJobs.fields.add({
    name: "error",
    type: "text",
    required: false,
    options: { min: null, max: null, pattern: "" },
  });

  syncJobs.fields.add({
    name: "log",
    type: "text",
    required: false,
    options: { min: null, max: null, pattern: "" },
  });

  syncJobs.listRule = "user = @request.auth.id";
  syncJobs.viewRule = "user = @request.auth.id";

  app.save(syncJobs);
}, (app) => {
  // Rollback: drop all added fields (PocketBase handles field removal)
  // In practice this is a no-op — downgrading past this point would
  // require rebuilding the collections from scratch.
});
