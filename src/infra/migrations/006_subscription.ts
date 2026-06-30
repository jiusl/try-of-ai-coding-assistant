// src/infra/migrations/006_subscription.ts
// ====================================================
// 用户分级订阅系统 — 等级定义 + 用户用量追踪
// ====================================================

import type { Migration } from "../migration.js"

export const subscriptionMigration: Migration = {
  id: 6,
  name: "create_subscription_system",
  up: `
    -- 等级定义表
    CREATE TABLE IF NOT EXISTS subscription_tiers (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      daily_chats   INTEGER,
      daily_tokens  INTEGER,
      max_sessions  INTEGER,
      features      TEXT NOT NULL DEFAULT '{}',
      sort_order    INTEGER NOT NULL DEFAULT 0
    );

    -- 用户等级关联表
    CREATE TABLE IF NOT EXISTS user_tiers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      tier_id       TEXT NOT NULL,
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at    TEXT,
      UNIQUE(user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (tier_id) REFERENCES subscription_tiers(id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_tiers_user ON user_tiers(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_tiers_tier ON user_tiers(tier_id);

    -- 用户用量表（按日聚合）
    CREATE TABLE IF NOT EXISTS user_usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      usage_date    TEXT NOT NULL,
      chat_count    INTEGER NOT NULL DEFAULT 0,
      token_count   INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, usage_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_usage_user_date ON user_usage(user_id, usage_date);

    -- 预置免费等级
    INSERT OR IGNORE INTO subscription_tiers (id, name, daily_chats, daily_tokens, max_sessions, features, sort_order)
    VALUES ('free', '免费版', 20, 10000, 3, '{"delegate":false,"custom_skills":false,"advanced_tools":false}', 0);

    -- 预置专业版等级
    INSERT OR IGNORE INTO subscription_tiers (id, name, daily_chats, daily_tokens, max_sessions, features, sort_order)
    VALUES ('pro', '专业版', 200, 50000, 50, '{"delegate":true,"custom_skills":true,"advanced_tools":true}', 1);

    -- 预置企业版等级（无限）
    INSERT OR IGNORE INTO subscription_tiers (id, name, daily_chats, daily_tokens, max_sessions, features, sort_order)
    VALUES ('enterprise', '企业版', NULL, NULL, NULL, '{"delegate":true,"custom_skills":true,"advanced_tools":true}', 2);
  `,
  down: `
    DROP TABLE IF EXISTS user_usage;
    DROP TABLE IF EXISTS user_tiers;
    DROP TABLE IF EXISTS subscription_tiers;
  `,
}
