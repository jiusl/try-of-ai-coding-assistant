// src/infra/migrations/003_rbac.ts
// ====================================================
// RBAC 用户与角色表
// ====================================================

import type { Migration } from "../migration.js"

export const rbacMigration: Migration = {
  id: 3,
  name: "create_rbac_tables",
  up: `
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      api_token  TEXT UNIQUE NOT NULL,
      email      TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 角色定义表
    CREATE TABLE IF NOT EXISTS roles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 用户-角色关联表
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      granted_by TEXT,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);
    CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
  `,
  down: `
    DROP TABLE IF EXISTS user_roles;
    DROP TABLE IF EXISTS roles;
    DROP TABLE IF EXISTS users;
  `,
}
