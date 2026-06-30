// src/infra/migrations/002_metrics.ts
// ====================================================
// 指标计数器表 — Prometheus 指标持久化
// ====================================================

import type { Migration } from "../migration.js"

export const metricsMigration: Migration = {
  id: 2,
  name: "create_metrics_counters",
  up: `
    CREATE TABLE IF NOT EXISTS _metrics_counters (
      name        TEXT PRIMARY KEY,
      value       INTEGER NOT NULL DEFAULT 0,
      labels      TEXT DEFAULT '{}',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _metrics_histograms (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      value       REAL NOT NULL,
      labels      TEXT DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_histograms_name ON _metrics_histograms(name);
    CREATE INDEX IF NOT EXISTS idx_metrics_histograms_created_at ON _metrics_histograms(created_at);
  `,
  down: `
    DROP TABLE IF EXISTS _metrics_histograms;
    DROP TABLE IF EXISTS _metrics_counters;
  `,
}
