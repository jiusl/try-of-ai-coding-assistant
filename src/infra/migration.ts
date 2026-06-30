// src/infra/migration.ts
// ====================================================
// 数据库迁移系统 — 版本化管理 SQLite schema
// ====================================================

import { Database as BunDatabase } from "bun:sqlite"
import { logger } from "./logger.js"

// -------------------------------------------------
// 类型定义
// -------------------------------------------------

/** 单次迁移定义 */
export interface Migration {
  /** 迁移编号（唯一，建议时间戳或递增数字） */
  id: number
  /** 迁移名称（描述性） */
  name: string
  /** 向上迁移 SQL，或接收 db 的函数用于需要逻辑判断的场景 */
  up: string | ((db: BunDatabase) => void)
  /** 向下回滚 SQL（可选） */
  down?: string
}

/** 迁移记录（来自 _migrations 表） */
interface MigrationRecord {
  id: number
  name: string
  applied_at: string
}

/** 迁移结果 */
export interface MigrationResult {
  applied: Migration[]
  skipped: Migration[]
  errors: { migration: Migration; error: string }[]
}

// -------------------------------------------------
// 核心函数
// -------------------------------------------------

/** 确保 _migrations 表存在 */
function ensureMigrationsTable(db: BunDatabase): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

/** 获取已应用的迁移 */
function getAppliedMigrations(db: BunDatabase): MigrationRecord[] {
  ensureMigrationsTable(db)
  return db.query("SELECT id, name, applied_at FROM _migrations ORDER BY id ASC").all() as MigrationRecord[]
}

/** 应用单次迁移 */
function applyMigration(db: BunDatabase, migration: Migration): void {
  logger.info(`迁移: 应用 #${migration.id} ${migration.name}`)
  if (typeof migration.up === "function") {
    migration.up(db)
  } else {
    db.exec(migration.up)
  }
  db.run("INSERT INTO _migrations (id, name) VALUES (?, ?)", [migration.id, migration.name])
  logger.info(`迁移: 完成 #${migration.id} ${migration.name}`)
}

/** 回滚单次迁移 */
function rollbackMigration(db: BunDatabase, migration: Migration): void {
  if (!migration.down) {
    logger.warn(`迁移 #${migration.id} ${migration.name} 没有 down 脚本，跳过回滚`)
    return
  }
  logger.info(`迁移: 回滚 #${migration.id} ${migration.name}`)
  if (typeof migration.down === "function") {
    migration.down(db)
  } else {
    db.exec(migration.down)
  }
  db.run("DELETE FROM _migrations WHERE id = ?", [migration.id])
  logger.info(`迁移: 回滚完成 #${migration.id}`)
}

// -------------------------------------------------
// 公开 API
// -------------------------------------------------

/**
 * 运行所有未应用的迁移
 * @param db SQLite 数据库实例
 * @param migrations 按 id 排序的迁移列表
 */
export function runMigrations(
  db: BunDatabase,
  migrations: Migration[]
): MigrationResult {
  const result: MigrationResult = { applied: [], skipped: [], errors: [] }

  if (migrations.length === 0) {
    logger.info("迁移: 无待执行的迁移")
    return result
  }

  // 按 id 排序
  const sorted = [...migrations].sort((a, b) => a.id - b.id)
  const applied = getAppliedMigrations(db)
  const appliedIds = new Set(applied.map((r) => r.id))

  for (const migration of sorted) {
    if (appliedIds.has(migration.id)) {
      result.skipped.push(migration)
      continue
    }

    try {
      applyMigration(db, migration)
      result.applied.push(migration)
    } catch (err) {
      const errorMsg = String(err)
      logger.error(`迁移失败 #${migration.id} ${migration.name}`, { error: errorMsg })
      result.errors.push({ migration, error: errorMsg })
      // 失败则终止后续迁移
      break
    }
  }

  logger.info(`迁移完成: 应用 ${result.applied.length}, 跳过 ${result.skipped.length}, 失败 ${result.errors.length}`)
  return result
}

/**
 * 回滚最近 N 次迁移
 * @param db SQLite 数据库实例
 * @param migrations 完整迁移列表
 * @param steps 回滚步数，默认 1
 */
export function rollbackMigrations(
  db: BunDatabase,
  migrations: Migration[],
  steps: number = 1
): MigrationResult {
  const result: MigrationResult = { applied: [], skipped: [], errors: [] }

  const appliedRecords = getAppliedMigrations(db)
  if (appliedRecords.length === 0) {
    logger.info("回滚: 无已应用的迁移")
    return result
  }

  const migrationMap = new Map(migrations.map((m) => [m.id, m]))
  const toRollback = appliedRecords.slice(-steps)

  for (const record of toRollback) {
    const migration = migrationMap.get(record.id)
    if (!migration) {
      logger.warn(`回滚: 找不到迁移定义 #${record.id}`)
      continue
    }

    try {
      rollbackMigration(db, migration)
      result.applied.push(migration)
    } catch (err) {
      const errorMsg = String(err)
      logger.error(`回滚失败 #${migration.id} ${migration.name}`, { error: errorMsg })
      result.errors.push({ migration, error: errorMsg })
      break
    }
  }

  logger.info(`回滚完成: 回滚 ${result.applied.length}, 失败 ${result.errors.length}`)
  return result
}

/**
 * 获取当前迁移状态
 */
export function migrationStatus(
  db: BunDatabase,
  migrations: Migration[]
): { applied: MigrationRecord[]; pending: Migration[] } {
  const appliedRecords = getAppliedMigrations(db)
  const appliedIds = new Set(appliedRecords.map((r) => r.id))
  const sorted = [...migrations].sort((a, b) => a.id - b.id)
  const pending = sorted.filter((m) => !appliedIds.has(m.id))

  return { applied: appliedRecords, pending }
}
