// src/infra/migrations/004_license.ts
// ====================================================
// License 授权表
// ====================================================

import type { Migration } from "../migration.js"

export const licenseMigration: Migration = {
  id: 4,
  name: "create_license_table",
  up: `
    CREATE TABLE IF NOT EXISTS _license (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key   TEXT NOT NULL,
      licensee      TEXT,
      product       TEXT NOT NULL DEFAULT 'try',
      max_users     INTEGER DEFAULT 5,
      max_sessions  INTEGER DEFAULT 100,
      features      TEXT NOT NULL DEFAULT '{}',
      issued_at     TEXT NOT NULL,
      expires_at    TEXT,
      activated_at  TEXT,
      revoked_at    TEXT,
      status        TEXT NOT NULL DEFAULT 'inactive',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_license_key ON _license(license_key);
  `,
  down: `DROP TABLE IF EXISTS _license;`,
}
