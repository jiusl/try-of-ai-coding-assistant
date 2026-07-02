// src/server/middleware/rate-limiter.ts
// ====================================================
// 滑动窗口限流中间件 — 基于 bun:sqlite 持久化
// ====================================================

import { Database as BunDatabase } from "bun:sqlite"
import { jsonResponse } from "./json.js"

// -------------------------------------------------
// 类型定义
// -------------------------------------------------

export interface RateLimitRule {
  /** 窗口大小（秒） */
  windowSec: number
  /** 窗口内最大请求数 */
  maxRequests: number
}

export interface RateLimitConfig {
  /** 对每个 IP 的默认限制 */
  default: RateLimitRule
  /** 按路径前缀的精确限制（长前缀优先匹配） */
  pathRules: Record<string, RateLimitRule>
  /** 白名单 IP（不受限制） */
  whitelist: string[]
}

/** 限流记录 */
interface RateRecord {
  ip: string
  path_key: string
  window_start: number
  counter: number
}

// -------------------------------------------------
// 默认配置
// -------------------------------------------------

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  default: { windowSec: 60, maxRequests: 120 },
  pathRules: {
    "/api/chat/stream": { windowSec: 10, maxRequests: 5 },   // SSE 流：10s 最多 5 次
    "/api/chat": { windowSec: 10, maxRequests: 10 },          // 普通聊天
    "/api/users": { windowSec: 60, maxRequests: 20 },         // 用户管理
    "/api/seed": { windowSec: 300, maxRequests: 3 },          // 种子数据
  },
  whitelist: ["127.0.0.1", "::1", "localhost"],
}

// -------------------------------------------------
// 限流器实现
// -------------------------------------------------

export class RateLimiter {
  private db: BunDatabase
  private config: RateLimitConfig
  private cleanupTimer: Timer | null = null

  constructor(
    db: BunDatabase,
    config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
  ) {
    this.db = db
    this.config = config
    this.ensureTable()
    this.startCleanup()
  }

  /** 创建限流记录表 */
  private ensureTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _rate_limits (
        ip          TEXT NOT NULL,
        path_key    TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        counter     INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (ip, path_key, window_start)
      )
    `)
  }

  /** 定期清理过期记录 */
  private startCleanup(): void {
    const maxWindow = Math.max(
      this.config.default.windowSec,
      ...Object.values(this.config.pathRules).map((r) => r.windowSec),
    )
    // 每 5 分钟清理一次
    this.cleanupTimer = setInterval(() => {
      const cutoff = Math.floor(Date.now() / 1000) - maxWindow * 2
      this.db.run("DELETE FROM _rate_limits WHERE window_start < ?", [cutoff])
    }, 300_000)
  }

  /** 停止定时清理 */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /** 提取客户端 IP */
  static extractIP(request: Request): string {
    const forwarded = request.headers.get("X-Forwarded-For")
    if (forwarded && forwarded.length > 0) {
      return forwarded.split(",")[0]!.trim()
    }
    const realIP = request.headers.get("X-Real-IP")
    if (realIP) return realIP.trim()
    // Bun.serve hostname
    const hostname = (request as any).headers?.get?.("host") ?? "unknown"
    return hostname
  }

  /** 从路径中提取限流键（精确匹配最长前缀） */
  private getRule(pathname: string): RateLimitRule {
    // 按路径前缀长度降序排序，优先匹配更长前缀
    const entries = Object.entries(this.config.pathRules).sort(
      ([a], [b]) => b.length - a.length,
    )
    for (const [prefix, rule] of entries) {
      if (pathname.startsWith(prefix)) {
        return rule
      }
    }
    return this.config.default
  }

  /** 获取路径的限流键 */
  private getPathKey(pathname: string): string {
    const entries = Object.keys(this.config.pathRules).sort(
      (a, b) => b.length - a.length,
    )
    for (const prefix of entries) {
      if (pathname.startsWith(prefix)) {
        return prefix
      }
    }
    return "__default__"
  }

  /**
   * 检查是否允许请求，返回：
   *  - allowed: 是否允许
   *  - remaining: 剩余配额
   *  - reset: 窗口重置时间（Unix 秒）
   */
  check(ip: string, pathname: string): { allowed: boolean; remaining: number; reset: number } {
    // 白名单直接放行
    if (this.config.whitelist.includes(ip)) {
      return { allowed: true, remaining: -1, reset: 0 }
    }

    const rule = this.getRule(pathname)
    const pathKey = this.getPathKey(pathname)
    const nowSec = Math.floor(Date.now() / 1000)
    const windowStart = Math.floor(nowSec / rule.windowSec) * rule.windowSec
    const reset = windowStart + rule.windowSec

    // 原子 UPSERT
    this.db.run(
      `INSERT INTO _rate_limits (ip, path_key, window_start, counter)
       VALUES (?, ?, ?, 1)
       ON CONFLICT (ip, path_key, window_start) DO UPDATE SET counter = counter + 1`,
      [ip, pathKey, windowStart],
    )

    // 读取当前计数
    const row = this.db
      .query("SELECT counter FROM _rate_limits WHERE ip = ? AND path_key = ? AND window_start = ?")
      .get(ip, pathKey, windowStart) as RateRecord | undefined

    const count = row?.counter ?? 1
    const remaining = Math.max(0, rule.maxRequests - count)
    const allowed = count <= rule.maxRequests

    return { allowed, remaining, reset }
  }

  /** 获取当前限流状态（用于调试和指标） */
  status(ip: string, pathname: string): { limit: number; remaining: number; reset: number } {
    const rule = this.getRule(pathname)
    const { remaining, reset } = this.check(ip, pathname)
    return { limit: rule.maxRequests, remaining, reset }
  }
}

// -------------------------------------------------
// 全局单例
// -------------------------------------------------

let _defaultLimiter: RateLimiter | null = null

export function getRateLimiter(db: BunDatabase): RateLimiter {
  if (!_defaultLimiter) {
    _defaultLimiter = new RateLimiter(db)
  }
  return _defaultLimiter
}
