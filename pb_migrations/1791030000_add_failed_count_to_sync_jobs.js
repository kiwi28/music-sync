/// <reference path="../pb_data/types.d.ts" />

// Add failed_count field to sync_jobs so the UI can display
// per-job failure stats without parsing the log text.
migrate(($app) => {
  $app.findCollectionByNameOrId("sync_jobs").fields.add(
    new Field({
      name: "failed_count",
      type: "number",
      required: false,
      min: 0,
      onlyInt: true,
      presentable: true,
    })
  );
  $app.save($app.findCollectionByNameOrId("sync_jobs"));
}, ($app) => {
  const collection = $app.findCollectionByNameOrId("sync_jobs");
  const field = collection.fields.find((f) => f.name === "failed_count");
  if (field) {
    collection.fields.remove(field);
    $app.save(collection);
  }
});
