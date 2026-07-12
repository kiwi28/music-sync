/// <reference path="../pb_data/types.d.ts" />

migrate(($app) => {
  const playlists = $app.findCollectionByNameOrId("playlists");

  // Add url field (public URL pasted by the user).
  // NOT required at the DB level — existing records imported via Spotify API
  // won't have a URL. The app enforces it for new playlists created via the dialog.
  //
  // Use addMarshaledJSON instead of push() — the Go JSVM runtime in PocketBase
  // 0.28+ cannot auto-convert plain JS objects to core.Field via push().
  playlists.fields.addMarshaledJSON(JSON.stringify({
    name: "url",
    type: "text",
    required: false,
    max: 500,
  }));

  // Make platform_id optional — it's now extracted from the URL when possible,
  // but not all URL patterns may yield a clean ID
  const platformIdField = playlists.fields.find((f) => f.name === "platform_id");
  if (platformIdField) {
    platformIdField.required = false;
  }

  $app.save(playlists);
}, ($app) => {
  const playlists = $app.findCollectionByNameOrId("playlists");

  // Remove url field
  playlists.fields = playlists.fields.filter((f) => f.name !== "url");

  // Make platform_id required again
  const platformIdField = playlists.fields.find((f) => f.name === "platform_id");
  if (platformIdField) {
    platformIdField.required = true;
  }

  $app.save(playlists);
});
