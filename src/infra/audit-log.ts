// src/infra/audit-log.ts
// ====================================================
// 审计日志 — 记录系统操作轨迹
// ====================================================

import { Database as BunDatabase } from "bun:sqlite"
import { logger } from "./logger.js"

// -------------------------------------------------
// 类型定义
// -------------------------------------------------

export type AuditAction =
  | "chat_message"
  | "session_create"
  | "session_delete"
  | "session_update"
  | "session_access"
  | "config_access"
  | "config_update"
  | "agent_access"
  | "tool_call"
  | "file_edit"
  | "bash_command"
  | "health_check"
  | "ready_check"
  | "api_request"

export interface AuditEntry {
  traceId: string
  action: AuditAction
  resource: string
  detail?: string
  userId?: string
}

export interface AuditRecord extends AuditEntry {
  id: number
  createdAt: string
}

export interface AuditLogOptions {
  /** 分页查询条数 */
  limit?: number
  /** 分页偏移 */
  offset?: number
  /** 按 action 过滤 */
  action?: AuditAction
  /** 按 traceId 过滤 */
  traceId?: string
}

// -------------------------------------------------
// 审计日志服务
// -------------------------------------------------

function getDbPath(): string {
  return process.env.TRY_DB_PATH ?? "./try.db"
}

class AuditLogService {
  /**
   * 记录一条审计日志
   */
  record(entry: AuditEntry): void {
    try {
      const db = new BunDatabase(getDbPath())
      db.run(
        `INSERT INTO _audit_log (trace_id, action, resource, detail, user_id) VALUES (?, ?, ?, ?, ?)`,
        [entry.traceId, entry.action, entry.resource, entry.detail ?? null, entry.userId ?? null]
      )
      db.close()
    } catch (err) {
      logger.warn("审计日志写入失败", { error: String(err), entry })
    }
  }

  /**
   * 查询审计日志
   */
  query(options: AuditLogOptions = {}): AuditRecord[] {
    const db = new BunDatabase(getDbPath())
    try {
      const conditions: string[] = []
      const params: unknown[] = []

      if (options.action) {
        conditions.push("action = ?")
        params.push(options.action)
      }
      if (options.traceId) {
        conditions.push("trace_id = ?")
        params.push(options.traceId)
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
      const limit = options.limit ?? 100
      const offset = options.offset ?? 0

      const stmt = db.prepare(
        `SELECT id, trace_id as traceId, action, resource, detail, user_id as userId, created_at as createdAt 
         FROM _audit_log ${where} 
         ORDER BY id DESC 
         LIMIT ? OFFSET ?`
      )
      // bind 参数: 先 bind 过滤条件, 再 bind limit/offset
      const allParams = [...params, limit, offset]
      return stmt.all(...allParams as [number, number]) as AuditRecord[]
    } finally {
      db.close()
    }
  }

  /**
   * 统计操作数量
   */
  stats(): { action: string; count: number }[] {
    const db = new BunDatabase(getDbPath())
    try {
      return db
        .query(`SELECT action, COUNT(*) as count FROM _audit_log GROUP BY action ORDER BY count DESC`)
        .all() as { action: string; count: number }[]
    } finally {
      db.close()
    }
  }

  /**
   * 清理过期日志（保留最近 N 天）
   */
  purge(days: number = 30): number {
    const db = new BunDatabase(getDbPath())
    try {
      const result = db.run(
        `DELETE FROM _audit_log WHERE created_at < datetime('now', ? || ' days')`,
        [`-${days}`]
      )
      logger.info(`审计日志清理完成: 删除 ${result.changes} 条记录`)
      return result.changes
    } finally {
      db.close()
    }
  }
}

/** 全局审计日志单例 */
export const auditLog = new AuditLogService()
