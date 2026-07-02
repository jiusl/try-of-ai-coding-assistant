// src/server/handlers/metrics.ts
// ====================================================
// Prometheus 指标、审计日志、License、种子数据 API
// ====================================================

import type { Router } from "../router.js"
import { metrics } from "../../infra/metrics.js"
import { auditLog } from "../../infra/audit-log.js"
import { licenseService } from "../../infra/license.js"
import { seedService } from "../../infra/seed.js"
import { jsonResponse, errorResponse, parseJsonBody } from "../middleware/index.js"

// -------------------------------------------------
// 注册指标和审计路由
// -------------------------------------------------

export function registerMetricsRoutes(router: Router): void {

  // ==================== 指标 ====================

  // GET /api/metrics — Prometheus 文本格式指标
  router.get("/api/metrics", (_ctx) => {
    const text = metrics.exportPrometheusText()
    return new Response(text, {
      headers: { "Content-Type": "text/plain; version=0.0.4" },
    })
  })

  // GET /api/metrics/json — JSON 格式指标（调试用）
  router.get("/api/metrics/json", (_ctx) => {
    return jsonResponse(metrics.exportJSON())
  })

  // ==================== 审计日志 ====================

  // GET /api/audit-log — 审计日志查询
  router.get("/api/audit-log", (ctx) => {
    const action = ctx.query.get("action") ?? undefined
    const traceId = ctx.query.get("traceId") ?? undefined
    const limit = parseInt(ctx.query.get("limit") ?? "100")
    const offset = parseInt(ctx.query.get("offset") ?? "0")

    const records = auditLog.query({
      action: action as any,
      ...(traceId ? { traceId } : {}),
      limit,
      offset,
    })

    return jsonResponse({
      success: true,
      data: records,
      pagination: { limit, offset },
    })
  })

  // GET /api/audit-log/stats — 审计日志统计
  router.get("/api/audit-log/stats", (_ctx) => {
    const stats = auditLog.stats()
    return jsonResponse({
      success: true,
      data: stats,
    })
  })

  // ==================== License ====================

  // GET /api/license — 获取 License 信息
  router.get("/api/license", (_ctx) => {
    const license = licenseService.getCurrent()
    if (!license) {
      return jsonResponse({
        success: true,
        data: {
          id: 0,
          licenseKey: "community-free",
          licensee: "社区版",
          product: "try",
          maxUsers: 1,
          maxSessions: 5,
          features: {},
          issuedAt: new Date().toISOString(),
          expiresAt: null,
          status: "active",
        },
      })
    }
    // 脱敏：隐藏完整 licenseKey
    const safe = {
      ...license,
      licenseKey: license.licenseKey.slice(0, 8) + "..." + license.licenseKey.slice(-4),
    }
    return jsonResponse({ success: true, data: safe })
  })

  // GET /api/license/features — 获取功能开关
  router.get("/api/license/features", (_ctx) => {
    const features = licenseService.getFeatures()
    return jsonResponse({ success: true, data: features })
  })

  // POST /api/license/activate — 激活 License
  router.post("/api/license/activate", async (ctx) => {
    try {
      const body = await parseJsonBody<{ licenseKey: string; licensee?: string }>(ctx.request)
      if (!body.licenseKey || body.licenseKey.trim().length === 0) {
        return errorResponse("License Key 不能为空", 400)
      }

      const result = licenseService.activate(body.licenseKey.trim(), body.licensee)
      if (!result.valid) {
        return errorResponse(result.reason ?? "激活失败", 400)
      }

      return jsonResponse({ success: true, data: result.info, message: "License 激活成功" })
    } catch (err) {
      return errorResponse(`激活失败: ${String(err)}`, 400)
    }
  })

  // ==================== 种子数据 ====================

  // POST /api/seed — 生成演示数据
  router.post("/api/seed", async (ctx) => {
    try {
      const body = await parseJsonBody<{
        sessionCount?: number
        messagesPerSession?: number
        clearFirst?: boolean
      }>(ctx.request).catch(() => ({} as Record<string, never>))

      const result = seedService.seed({
        sessionCount: (body as any).sessionCount ?? 5,
        messagesPerSession: (body as any).messagesPerSession ?? 6,
        clearFirst: (body as any).clearFirst ?? false,
      })

      return jsonResponse({
        success: true,
        data: result,
        message: `成功生成 ${result.sessions} 个会话, ${result.messages} 条消息, ${result.users} 个用户`,
      }, 201)
    } catch (err) {
      return errorResponse(`生成种子数据失败: ${String(err)}`, 500)
    }
  })

  // DELETE /api/seed — 清空所有数据
  router.delete("/api/seed", (_ctx) => {
    try {
      seedService.clear()
      return jsonResponse({ success: true, message: "所有数据已清空" })
    } catch (err) {
      return errorResponse(`清空数据失败: ${String(err)}`, 500)
    }
  })
}
