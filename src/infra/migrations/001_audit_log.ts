// src/infra/migrations/001_audit_log.ts
// ====================================================
// 审计日志表 — 记录操作轨迹
// ====================================================

import type { Migration } from "../migration.js"

export const auditLogMigration: Migration = {
  id: 1,
  name: "create_audit_log",
  up: `
    CREATE TABLE IF NOT EXISTS _audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id    TEXT NOT NULL,
      action      TEXT NOT NULL,
      resource    TEXT NOT NULL,
      detail      TEXT,
      user_id     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON _audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_trace_id ON _audit_log(trace_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON _audit_log(created_at);
  `,
  down: `DROP TABLE IF EXISTS _audit_log;`,
}
