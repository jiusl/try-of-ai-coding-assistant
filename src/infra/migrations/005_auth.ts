// src/infra/migrations/005_auth.ts
// ====================================================
// 认证系统 — 密码哈希 + 刷新令牌
// ====================================================

import type { Migration } from "../migration.js"

export const authMigration: Migration = {
  id: 5,
  name: "create_auth_system",
  up: `
    -- 为 users 表添加密码字段
    ALTER TABLE users ADD COLUMN password_hash TEXT;

    -- 认证刷新令牌表
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      token      TEXT UNIQUE NOT NULL,
      type       TEXT NOT NULL DEFAULT 'refresh',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
  `,
  down: `
    DROP TABLE IF EXISTS auth_tokens;
    -- SQLite 不支持 ALTER TABLE DROP COLUMN，回滚时不删除 password_hash
    -- 如需完全清理，需重建 users 表（风险较高，这里选择保留）
  `,
}
