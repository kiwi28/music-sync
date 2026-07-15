/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const collection = new Collection({
      name: "worker_status",
      type: "base",
      system: false,
      schema: [
        { name: "last_poll_at", type: "date", required: false },
        { name: "pending_count", type: "number", required: false, min: 0 },
        { name: "running_count", type: "number", required: false, min: 0 },
        { name: "scheduler_last_check_at", type: "date", required: false },
        { name: "scheduler_next_check_at", type: "date", required: false },
        { name: "scheduler_sync_interval_minutes", type: "number", required: false, min: 0 },
        { name: "scheduler_check_interval_minutes", type: "number", required: false, min: 0 },
        { name: "scheduler_stale_playlist_count", type: "number", required: false, min: 0 },
      ],
      listRule: "",
      viewRule: "",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
    });
    return db.save(collection);
  },
  (db) => {
    return db.deleteCollection("worker_status");
  }
);
