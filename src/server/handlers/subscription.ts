// src/server/handlers/subscription.ts
// ====================================================
// 订阅管理 API — 管理员查看/修改用户等级，用户查看配额
// ====================================================

import type { Router } from "../router.js"
import { rbac } from "../../infra/rbac.js"
import { subscription } from "../../infra/subscription.js"
import { jsonResponse, errorResponse, parseJsonBody } from "../middleware/index.js"

// -------------------------------------------------
// 辅助：从请求中提取用户
// -------------------------------------------------

function getAuthToken(ctx: { request: Request }): string | null {
  const authHeader = ctx.request.headers.get("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  return null
}

function getAuthenticatedUser(ctx: { request: Request }) {
  const token = getAuthToken(ctx)
  if (!token) return null
  return rbac.getUserByToken(token)
}

function requireAdmin(ctx: { request: Request }): { userId: string } | Response {
  const user = getAuthenticatedUser(ctx)
  if (!user) {
    return errorResponse("未登录", 401)
  }
  // 检查管理员权限
  const perms = rbac.getUserPermissions(user.id)
  if (!perms.includes("admin:all") && !perms.includes("users:write")) {
    return errorResponse("权限不足：需要管理员权限", 403)
  }
  return { userId: user.id }
}

// -------------------------------------------------
// 注册路由
// -------------------------------------------------

export function registerSubscriptionRoutes(router: Router): void {

  // GET /api/subscription/tiers — 列出所有等级（公开）
  router.get("/api/subscription/tiers", (_ctx) => {
    try {
      const tiers = subscription.listTiers()
      return jsonResponse({ success: true, data: tiers })
    } catch (err) {
      return errorResponse(`获取等级列表失败: ${String(err)}`, 500)
    }
  })

  // GET /api/subscription/quota — 当前用户配额
  router.get("/api/subscription/quota", (ctx) => {
    const user = getAuthenticatedUser(ctx)
    if (!user) {
      return errorResponse("未登录", 401)
    }
    try {
      const remaining = subscription.getQuotaRemaining(user.id)
      const tierInfo = subscription.getUserTierInfo(user.id)
      return jsonResponse({
        success: true,
        data: {
          ...remaining,
          tierInfo,
        },
      })
    } catch (err) {
      return errorResponse(`获取配额失败: ${String(err)}`, 500)
    }
  })

  // GET /api/subscription/users/:userId/tier — 管理员查看用户等级
  router.get("/api/subscription/users/:userId/tier", (ctx) => {
    const admin = requireAdmin(ctx)
    if (admin instanceof Response) return admin

    const userId = (ctx as any).params?.userId
    if (!userId) {
      return errorResponse("缺少 userId", 400)
    }

    try {
      const user = rbac.getUserById(userId)
      if (!user) {
        return errorResponse("用户不存在", 404)
      }
      const tier = subscription.getUserTier(userId)
      const tierInfo = subscription.getUserTierInfo(userId)
      const remaining = subscription.getQuotaRemaining(userId)
      return jsonResponse({
        success: true,
        data: {
          user: { id: user.id, name: user.name, email: user.email },
          tier: { id: tier.id, name: tier.name },
          tierInfo,
          remaining,
        },
      })
    } catch (err) {
      return errorResponse(`获取用户等级失败: ${String(err)}`, 500)
    }
  })

  // PUT /api/subscription/users/:userId/tier — 管理员设置用户等级
  router.put("/api/subscription/users/:userId/tier", async (ctx) => {
    const admin = requireAdmin(ctx)
    if (admin instanceof Response) return admin

    const userId = (ctx as any).params?.userId
    if (!userId) {
      return errorResponse("缺少 userId", 400)
    }

    try {
      const body = await parseJsonBody<{
        tierId: string
        expiresAt?: string
      }>(ctx.request)

      if (!body.tierId) {
        return errorResponse("缺少 tierId", 400)
      }

      // 验证等级存在
      const tiers = subscription.listTiers()
      if (!tiers.find(t => t.id === body.tierId)) {
        return errorResponse(`等级 '${body.tierId}' 不存在`, 400)
      }

      subscription.setUserTier(userId, body.tierId, body.expiresAt)

      const tier = subscription.getUserTier(userId)
      const tierInfo = subscription.getUserTierInfo(userId)

      return jsonResponse({
        success: true,
        data: {
          userId,
          tier: { id: tier.id, name: tier.name },
          tierInfo,
          expiresAt: body.expiresAt ?? null,
        },
        message: "用户等级已更新",
      })
    } catch (err) {
      return errorResponse(`设置用户等级失败: ${String(err)}`, 500)
    }
  })

  // PUT /api/subscription/me/tier — 用户自主切换等级（开发阶段无支付验证）
  router.put("/api/subscription/me/tier", async (ctx) => {
    const user = getAuthenticatedUser(ctx)
    if (!user) {
      return errorResponse("未登录", 401)
    }

    try {
      const body = await parseJsonBody<{ tierId: string }>(ctx.request)
      if (!body.tierId) {
        return errorResponse("缺少 tierId", 400)
      }

      const tiers = subscription.listTiers()
      const targetTier = tiers.find(t => t.id === body.tierId)
      if (!targetTier) {
        return errorResponse(`等级 '${body.tierId}' 不存在，可用: ${tiers.map(t => t.id).join(", ")}`, 400)
      }

      subscription.setUserTier(user.id, body.tierId)

      const tier = subscription.getUserTier(user.id)
      const remaining = subscription.getQuotaRemaining(user.id)
      const tierInfo = subscription.getUserTierInfo(user.id)

      return jsonResponse({
        success: true,
        data: {
          tier: {
            id: tier.id,
            name: tier.name,
            dailyChats: tier.dailyChats,
            maxSessions: tier.maxSessions,
          },
          remaining,
          tierInfo,
        },
        message: `已切换至 ${tier.name}`,
      })
    } catch (err) {
      return errorResponse(`切换等级失败: ${String(err)}`, 500)
    }
  })
}
