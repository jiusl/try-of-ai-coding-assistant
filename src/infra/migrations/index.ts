// src/infra/migrations/index.ts
// ====================================================
// 迁移清单 — 按 ID 收集所有迁移
// ====================================================

import type { Migration } from "../migration.js"
import { auditLogMigration } from "./001_audit_log.js"
import { metricsMigration } from "./002_metrics.js"
import { rbacMigration } from "./003_rbac.js"
import { licenseMigration } from "./004_license.js"
import { authMigration } from "./005_auth.js"
import { subscriptionMigration } from "./006_subscription.js"
import { sessionsUserMigration } from "./007_sessions_user_id.js"
import { projectsMigration } from "./008_projects.js"

/** 所有迁移，按 ID 升序排列 */
export const allMigrations: Migration[] = [
  auditLogMigration,
  metricsMigration,
  rbacMigration,
  licenseMigration,
  authMigration,
  subscriptionMigration,
  sessionsUserMigration,
  projectsMigration,
]
