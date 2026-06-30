// src/infra/subscription.ts
// ====================================================
// 用户分级订阅服务 — 等级管理 + 配额检查 + 用量追踪
//
// 安全: License 等级是天花板，数据库中的等级不能超越它
// ====================================================

import { Database as BunDatabase } from "bun:sqlite"
import { logger } from "./logger.js"
import { licenseService } from "./license.js"

// -------------------------------------------------
// 类型定义
// -------------------------------------------------

/** 等级定义 */
export interface SubscriptionTier {
  id: string
  name: string
  dailyChats: number | null       // null = 无限
  dailyTokens: number | null      // null = 无限
  maxSessions: number | null      // null = 无限
  sortOrder: number
}

/** 用户等级信息（含过期） */
export interface UserTier {
  tierId: string
  tierName: string
  startedAt: string
  expiresAt: string | null
  isExpired: boolean
}

/** 配额检查结果 */
export interface QuotaCheckResult {
  allowed: boolean
  reason?: string | undefined
  remaining?: number | undefined
  limit?: number | undefined
  resetAt?: string | undefined   // ISO 日期，次日 00:00:00
}

/** 剩余配额详情 */
export interface QuotaRemaining {
  tierId: string
  tierName: string
  dailyChats: { used: number; limit: number | null; remaining: number | null }
  maxSessions: { current: number; limit: number | null; remaining: number | null }
  /** 配额用尽时的重置时间（北京时间次日 00:00），仅 dailyChats/maxSessions 任一耗尽时有值 */
  resetAt?: string | undefined
}

/** 用量查询参数 */
export type UsageAction = "chat" | "session"

// -------------------------------------------------
// 数据库行映射
// -------------------------------------------------

interface TierRow {
  id: string
  name: string
  daily_chats: number | null
  daily_tokens: number | null
  max_sessions: number | null
  features: string
  sort_order: number
}

interface UserTierRow {
  tier_id: string
  tier_name: string
  started_at: string
  expires_at: string | null
}

interface UsageRow {
  chat_count: number
}

interface SessionCountRow {
  cnt: number
}

// -------------------------------------------------
// 默认等级定义
// -------------------------------------------------

export const DEFAULT_TIERS: SubscriptionTier[] = [
  {
    id: "free",
    name: "免费版",
    dailyChats: 20,
    dailyTokens: null,
    maxSessions: 3,
    sortOrder: 0,
  },
  {
    id: "pro",
    name: "专业版",
    dailyChats: 200,
    dailyTokens: null,
    maxSessions: 50,
    sortOrder: 1,
  },
  {
    id: "enterprise",
    name: "企业版",
    dailyChats: null,
    dailyTokens: null,
    maxSessions: null,
    sortOrder: 2,
  },
]

// -------------------------------------------------
// 等级优先级（用于封顶比较）
// -------------------------------------------------

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, enterprise: 2 }

/**
 * 用 License 等级封顶数据库等级
 * 即使用户篡改数据库给自己设 enterprise，若 License 是 free 就只能用 free
 */
function capByLicense(dbTier: SubscriptionTier): SubscriptionTier {
  const licenseTier = licenseService.getTier()
  const licenseRank = TIER_RANK[licenseTier] ?? 0
  const dbRank = TIER_RANK[dbTier.id] ?? 0

  if (dbRank <= licenseRank) return dbTier // 数据库等级 ≤ License，放行

  // 数据库等级超过 License → 封顶
  const capped = DEFAULT_TIERS.find(t => t.id === licenseTier) ?? DEFAULT_TIERS[0]!
  logger.warn(`用户等级被 License 封顶: ${dbTier.id} → ${capped.id}`)
  return capped
}

function getDbPath(): string {
  return process.env.TRY_DB_PATH ?? "./try.db"
}

const BJ_OFFSET_MS = 8 * 3600000 // 北京时间偏移(毫秒)

/**
 * 获取北京时间 (UTC+8) 当天的日期字符串
 * 使用纯 UTC 算术，不依赖本地时区
 */
function today(): string {
  const bjNow = Date.now() + BJ_OFFSET_MS
  const bjTodayStart = Math.floor(bjNow / 86400000) * 86400000
  return new Date(bjTodayStart - BJ_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 获取北京时间次日 00:00:00 的 UTC ISO 时间戳
 * 使用纯 UTC 算术，不依赖本地时区
 */
function tomorrowReset(): string {
  const bjNow = Date.now() + BJ_OFFSET_MS
  const bjTodayStart = Math.floor(bjNow / 86400000) * 86400000
  const bjTomorrowStart = bjTodayStart + 86400000
  return new Date(bjTomorrowStart - BJ_OFFSET_MS).toISOString()
}

function rowToTier(row: TierRow): SubscriptionTier {
  return {
    id: row.id,
    name: row.name,
    dailyChats: row.daily_chats,
    dailyTokens: row.daily_tokens,
    maxSessions: row.max_sessions,
    sortOrder: row.sort_order,
  }
}

// -------------------------------------------------
// SubscriptionService
// -------------------------------------------------

class SubscriptionService {
  /**
   * 初始化预置等级（幂等）
   */
  initialize(): void {
    const db = new BunDatabase(getDbPath())
    try {
      for (const tier of DEFAULT_TIERS) {
        db.run(
          `INSERT OR IGNORE INTO subscription_tiers (id, name, daily_chats, daily_tokens, max_sessions, features, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [tier.id, tier.name, tier.dailyChats, tier.dailyTokens, tier.maxSessions, "{}", tier.sortOrder]
        )
      }
      logger.info("Subscription 初始化完成", { tiers: DEFAULT_TIERS.length })
    } catch (err) {
      logger.error("Subscription 初始化失败", { error: String(err) })
    } finally {
      db.close()
    }
  }

  // -------------------------------------------------
  // 等级管理
  // -------------------------------------------------

  /**
   * 获取用户的当前等级（被 License 封顶）
   */
  getUserTier(userId: string): SubscriptionTier {
    const db = new BunDatabase(getDbPath())
    try {
      const row = db.query(`
        SELECT t.id, t.name, t.daily_chats, t.daily_tokens, t.max_sessions, t.features, t.sort_order
        FROM user_tiers ut
        JOIN subscription_tiers t ON ut.tier_id = t.id
        WHERE ut.user_id = ?
        AND (ut.expires_at IS NULL OR ut.expires_at > datetime('now'))
      `).get(userId) as TierRow | undefined

      const dbTier = row
        ? rowToTier(row)
        : (() => {
            const freeRow = db.query(
              "SELECT * FROM subscription_tiers WHERE id = 'free'"
            ).get() as TierRow | undefined
            return freeRow ? rowToTier(freeRow) : DEFAULT_TIERS[0]!
          })()

      return capByLicense(dbTier)
    } finally {
      db.close()
    }
  }

  /**
   * 获取用户等级详情（含过期信息）
   */
  getUserTierInfo(userId: string): UserTier | null {
    const db = new BunDatabase(getDbPath())
    try {
      const row = db.query(`
        SELECT t.id as tier_id, t.name as tier_name, ut.started_at, ut.expires_at
        FROM user_tiers ut
        JOIN subscription_tiers t ON ut.tier_id = t.id
        WHERE ut.user_id = ?
      `).get(userId) as UserTierRow | undefined

      if (!row) return null

      return {
        tierId: row.tier_id,
        tierName: row.tier_name,
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        isExpired: row.expires_at !== null && row.expires_at <= new Date().toISOString(),
      }
    } finally {
      db.close()
    }
  }

  /**
   * 为用户设置等级（管理员操作）
   */
  setUserTier(userId: string, tierId: string, expiresAt?: string): void {
    const db = new BunDatabase(getDbPath())
    try {
      // 验证等级存在
      const tier = db.query("SELECT id FROM subscription_tiers WHERE id = ?").get(tierId)
      if (!tier) {
        throw new Error(`等级 '${tierId}' 不存在`)
      }

      db.run(
        `INSERT INTO user_tiers (user_id, tier_id, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET tier_id = excluded.tier_id, expires_at = excluded.expires_at`,
        [userId, tierId, expiresAt ?? null]
      )
      logger.info(`用户等级已更新`, { userId, tierId, expiresAt: expiresAt ?? "永久" })
    } catch (err) {
      logger.error("设置用户等级失败", { userId, tierId, error: String(err) })
      throw err
    } finally {
      db.close()
    }
  }

  /**
   * 列出所有等级（被 License 封顶）
   */
  listTiers(): SubscriptionTier[] {
    const db = new BunDatabase(getDbPath())
    try {
      const rows = db.query(
        "SELECT * FROM subscription_tiers ORDER BY sort_order ASC"
      ).all() as TierRow[]
      const capped = rows.map(rowToTier).map(capByLicense)
      // 去重：capByLicense 可能将高等级裁剪为已存在的低等级（如 enterprise → pro）
      const seen = new Set<string>()
      return capped.filter(t => seen.has(t.id) ? false : (seen.add(t.id), true))
    } finally {
      db.close()
    }
  }

  // -------------------------------------------------
  // 配额检查
  // -------------------------------------------------

  /**
   * 检查用户是否可以执行操作
   */
  checkQuota(userId: string, action: UsageAction): QuotaCheckResult {
    const tier = this.getUserTier(userId)
    const date = today()

    // 获取今日用量
    const db = new BunDatabase(getDbPath())
    try {
      const usage = db.query(
        "SELECT chat_count FROM user_usage WHERE user_id = ? AND usage_date = ?"
      ).get(userId, date) as UsageRow | undefined

      const used = usage?.chat_count ?? 0

      if (action === "chat") {
        const limit = tier.dailyChats
        if (limit !== null && used >= limit) {
          return {
            allowed: false,
            reason: `日对话次数已用完 (${used}/${limit})`,
            remaining: 0,
            limit,
            resetAt: tomorrowReset(),
          }
        }
        return {
          allowed: true,
          remaining: limit !== null ? limit - used - 1 : undefined,
          limit: limit ?? undefined,
        }
      }

      if (action === "session") {
        const limit = tier.maxSessions
        // 按用户统计活跃会话数（排除已删除）
        const sessionCount = (db.query(
          "SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ? AND status != 'deleted'"
        ).get(userId) as SessionCountRow | undefined)?.cnt ?? 0

        if (limit !== null && sessionCount >= limit) {
          return {
            allowed: false,
            reason: `会话数已达上限 (${sessionCount}/${limit})`,
            remaining: 0,
            limit,
          }
        }
        return {
          allowed: true,
          remaining: limit !== null ? limit - sessionCount - 1 : undefined,
          limit: limit ?? undefined,
        }
      }

      return { allowed: true }
    } finally {
      db.close()
    }
  }

  /**
   * 获取用户剩余配额详情
   */
  getQuotaRemaining(userId: string): QuotaRemaining {
    const tier = this.getUserTier(userId)
    const date = today()

    const db = new BunDatabase(getDbPath())
    try {
      const usage = db.query(
        "SELECT chat_count FROM user_usage WHERE user_id = ? AND usage_date = ?"
      ).get(userId, date) as { chat_count: number } | undefined

      const sessionCount = (db.query(
        "SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ? AND status != 'deleted'"
      ).get(userId) as SessionCountRow | undefined)?.cnt ?? 0

      const chatUsed = usage?.chat_count ?? 0
      const chatExhausted = tier.dailyChats !== null && chatUsed >= tier.dailyChats
      const sessionExhausted = tier.maxSessions !== null && sessionCount >= tier.maxSessions

      return {
        tierId: tier.id,
        tierName: tier.name,
        dailyChats: {
          used: chatUsed,
          limit: tier.dailyChats,
          remaining: tier.dailyChats !== null ? Math.max(0, tier.dailyChats - chatUsed) : null,
        },
        maxSessions: {
          current: sessionCount,
          limit: tier.maxSessions,
          remaining: tier.maxSessions !== null ? Math.max(0, tier.maxSessions - sessionCount) : null,
        },
        ...(chatExhausted || sessionExhausted ? { resetAt: tomorrowReset() } : {}),
      }
    } finally {
      db.close()
    }
  }

  /**
   * 记录用量（幂等 upsert，仅记录 chat_count）
   */
  recordUsage(userId: string, chatCount: number): void {
    const date = today()
    const db = new BunDatabase(getDbPath())
    try {
      db.run(
        `INSERT INTO user_usage (user_id, usage_date, chat_count, token_count)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(user_id, usage_date) DO UPDATE SET
           chat_count = chat_count + excluded.chat_count`,
        [userId, date, chatCount]
      )
    } catch (err) {
      logger.error("记录用量失败", { userId, error: String(err) })
    } finally {
      db.close()
    }
  }
}

// -------------------------------------------------
// 单例导出
// -------------------------------------------------

export const subscription = new SubscriptionService()
