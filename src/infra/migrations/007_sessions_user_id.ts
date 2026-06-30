// src/infra/migrations/007_sessions_user_id.ts
// ====================================================
// 会话表添加 user_id 列 — 支持按用户隔离配额
// ====================================================

import type { Migration } from "../migration.js"

export const sessionsUserMigration: Migration = {
  id: 7,
  name: "add_user_id_to_sessions",
  up: (db) => {
    // 检查 user_id 列是否已存在（新鲜 DB 由 session.ts CREATE TABLE 自带）
    const cols = db.query("PRAGMA table_info('sessions')").all() as { name: string }[]
    if (cols.some(c => c.name === "user_id")) return
    db.exec("ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy'")
  },
}
