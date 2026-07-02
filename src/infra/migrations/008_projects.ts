// src/infra/migrations/008_projects.ts
// ====================================================
// 项目系统 — projects 表 + sessions 添加 project_id
// ====================================================

import type { Migration } from "../migration.js"
import { defaultWorkspace } from "../workspace.js"

export const projectsMigration: Migration = {
  id: 8,
  name: "create_projects_table_and_link_sessions",
  up: (db) => {
    // ── 创建 projects 表 ──
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        path             TEXT NOT NULL,
        last_activated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    // ── 插入默认项目 ──
    const now = new Date().toISOString()
    const defaultPath = defaultWorkspace()
    const exists = db.query("SELECT id FROM projects WHERE id = '__default__'").get()
    if (!exists) {
      db.run(
        "INSERT INTO projects (id, name, path, last_activated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ["__default__", "默认项目", defaultPath, now, now, now]
      )
    }

    // ── sessions 加 project_id 列 ──
    const cols = db.query("PRAGMA table_info('sessions')").all() as { name: string }[]
    if (!cols.some(c => c.name === "project_id")) {
      db.exec("ALTER TABLE sessions ADD COLUMN project_id TEXT NOT NULL DEFAULT '__default__'")
    }

    // ── 索引 ──
    db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id)")
    db.exec("CREATE INDEX IF NOT EXISTS idx_projects_last_activated_at ON projects(last_activated_at)")
  },
}
