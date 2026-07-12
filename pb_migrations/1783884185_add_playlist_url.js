/// <reference path="../pb_data/types.d.ts" />

migrate(($app) => {
  const playlists = $app.findCollectionByNameOrId("playlists");

  // Add url field (public URL pasted by the user)
  playlists.fields.push({
    name: "url",
    type: "text",
    required: true,
    max: 500,
  });

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
