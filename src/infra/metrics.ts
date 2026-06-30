// src/infra/metrics.ts
// ====================================================
// Prometheus 指标 — 计数器 + 直方图
// ====================================================

import { Database as BunDatabase } from "bun:sqlite"
import { logger } from "./logger.js"

// -------------------------------------------------
// 指标名称常量
// -------------------------------------------------

export const Metrics = {
  HTTP_REQUESTS_TOTAL: "http_requests_total",
  HTTP_REQUEST_DURATION_MS: "http_request_duration_ms",
  HTTP_ERRORS_TOTAL: "http_errors_total",
  TOOL_CALLS_TOTAL: "tool_calls_total",
  ACTIVE_SESSIONS: "active_sessions",
  CHAT_MESSAGES_TOTAL: "chat_messages_total",
} as const

// -------------------------------------------------
// 标签类型
// -------------------------------------------------

export interface MetricLabels {
  [key: string]: string
}

function labelsToJSON(labels: MetricLabels): string {
  return JSON.stringify(labels)
}

// -------------------------------------------------
// 指标服务
// -------------------------------------------------

function getDbPath(): string {
  return process.env.TRY_DB_PATH ?? "./try.db"
}

class MetricsService {
  /**
   * 递增计数器
   */
  incrementCounter(name: string, labels: MetricLabels = {}): void {
    try {
      const db = new BunDatabase(getDbPath())
      const key = `${name}:${labelsToJSON(labels)}`
      db.run(
        `INSERT INTO _metrics_counters (name, value, labels, updated_at) 
         VALUES (?, 1, ?, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET 
           value = value + 1,
           updated_at = datetime('now')`,
        [name, labelsToJSON(labels)]
      )
      db.close()
    } catch (err) {
      logger.warn("指标记录失败 (counter)", { error: String(err), name })
    }
  }

  /**
   * 记录直方图观测值
   */
  observeHistogram(name: string, value: number, labels: MetricLabels = {}): void {
    try {
      const db = new BunDatabase(getDbPath())
      db.run(
        `INSERT INTO _metrics_histograms (name, value, labels) VALUES (?, ?, ?)`,
        [name, value, labelsToJSON(labels)]
      )
      db.close()
    } catch (err) {
      logger.warn("指标记录失败 (histogram)", { error: String(err), name })
    }
  }

  /**
   * 设置仪表值（如活跃会话数）
   */
  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    try {
      const db = new BunDatabase(getDbPath())
      db.run(
        `INSERT INTO _metrics_counters (name, value, labels, updated_at) 
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET 
           value = ?,
           updated_at = datetime('now')`,
        [name, value, labelsToJSON(labels), value]
      )
      db.close()
    } catch (err) {
      logger.warn("指标记录失败 (gauge)", { error: String(err), name })
    }
  }

  /**
   * 获取计数器值
   */
  getCounter(name: string): number {
    try {
      const db = new BunDatabase(getDbPath())
      const row = db.query("SELECT value FROM _metrics_counters WHERE name = ?").get(name) as { value: number } | undefined
      db.close()
      return row?.value ?? 0
    } catch {
      return 0
    }
  }

  /**
   * 获取直方图统计
   */
  getHistogramStats(name: string): {
    count: number
    sum: number
    avg: number
    p50: number
    p90: number
    p99: number
  } {
    try {
      const db = new BunDatabase(getDbPath())
      const values = db.query(
        "SELECT value FROM _metrics_histograms WHERE name = ? ORDER BY value ASC"
      ).all(name) as { value: number }[]

      if (values.length === 0) {
        return { count: 0, sum: 0, avg: 0, p50: 0, p90: 0, p99: 0 }
      }

      const nums = values.map(v => v.value)
      const sum = nums.reduce((a, b) => a + b, 0)
      const count = nums.length

      const percentile = (p: number): number => {
        const idx = Math.ceil(p / 100 * count) - 1
        return nums[Math.max(0, Math.min(idx, count - 1))]!
      }

      db.close()
      return {
        count,
        sum,
        avg: sum / count,
        p50: percentile(50),
        p90: percentile(90),
        p99: percentile(99),
      }
    } catch {
      return { count: 0, sum: 0, avg: 0, p50: 0, p90: 0, p99: 0 }
    }
  }

  /**
   * 导出 Prometheus 文本格式
   */
  exportPrometheusText(): string {
    const lines: string[] = []

    try {
      const db = new BunDatabase(getDbPath())

      // 计数器
      const counters = db.query(
        "SELECT name, value, labels FROM _metrics_counters"
      ).all() as { name: string; value: number; labels: string }[]

      for (const c of counters) {
        const labels = JSON.parse(c.labels) as MetricLabels
        const labelStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",")
        const metricLine = labelStr
          ? `${c.name}{${labelStr}} ${c.value}`
          : `${c.name} ${c.value}`
        lines.push(`# HELP ${c.name} Counter metric`)
        lines.push(`# TYPE ${c.name} counter`)
        lines.push(metricLine)
      }

      // 直方图：按 name 分组统计
      const histNames = db.query(
        "SELECT DISTINCT name FROM _metrics_histograms"
      ).all() as { name: string }[]

      for (const { name } of histNames) {
        const stats = this.getHistogramStats(name)
        lines.push(`# HELP ${name} Histogram metric`)
        lines.push(`# TYPE ${name} histogram`)
        lines.push(`${name}_count ${stats.count}`)
        lines.push(`${name}_sum ${stats.sum}`)
        lines.push(`${name}_bucket{le="+Inf"} ${stats.count}`)
      }

      db.close()
    } catch (err) {
      logger.warn("Prometheus 指标导出失败", { error: String(err) })
    }

    return lines.join("\n") + "\n"
  }

  /**
   * 导出 JSON 格式（用于 API 调试）
   */
  exportJSON(): Record<string, unknown> {
    return {
      http: {
        requestsTotal: this.getCounter(Metrics.HTTP_REQUESTS_TOTAL),
        errorsTotal: this.getCounter(Metrics.HTTP_ERRORS_TOTAL),
        latencyMs: this.getHistogramStats(Metrics.HTTP_REQUEST_DURATION_MS),
      },
      chat: {
        messagesTotal: this.getCounter(Metrics.CHAT_MESSAGES_TOTAL),
      },
      tools: {
        callsTotal: this.getCounter(Metrics.TOOL_CALLS_TOTAL),
      },
      sessions: {
        active: this.getCounter(Metrics.ACTIVE_SESSIONS),
      },
      timestamp: new Date().toISOString(),
    }
  }
}

/** 全局指标服务单例 */
export const metrics = new MetricsService()
