// src/server/handlers/rbac.ts
// ====================================================
// RBAC 用户和角色管理 API
// ====================================================

import type { Router } from "../router.js"
import { rbac, type Permission } from "../../infra/rbac.js"
import { licenseService } from "../../infra/license.js"
import { auditLog } from "../../infra/audit-log.js"
import { jsonResponse, errorResponse, parseJsonBody } from "../middleware/index.js"

// -------------------------------------------------
// 辅助：从请求中提取用户 token
// -------------------------------------------------

function getAuthToken(ctx: { request: Request }): string | null {
  const authHeader = ctx.request.headers.get("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  return null
}

function getUserId(ctx: { request: Request }): string | null {
  const token = getAuthToken(ctx)
  if (!token) return null
  const user = rbac.getUserByToken(token)
  return user?.id ?? null
}

/** 检查权限中间件工厂 */
function requirePermission(perm: Permission) {
  return (ctx: { request: Request }, next: () => Response): Response => {
    const userId = getUserId(ctx)
    if (!userId) {
      return errorResponse("未授权: 请提供有效的 Bearer Token", 401)
    }
    const permissions = rbac.getUserPermissions(userId)
    if (!permissions.includes(perm) && !permissions.includes("admin:all")) {
      return errorResponse("权限不足", 403)
    }
    return next()
  }
}

// -------------------------------------------------
// 注册 RBAC 路由
// -------------------------------------------------

export function registerRbacRoutes(router: Router): void {

  // GET /api/users — 列出所有用户
  router.get("/api/users", (ctx) => {
    const userId = getUserId(ctx)
    if (!userId) return errorResponse("未授权: 请提供有效的 Bearer Token", 401)

    const permissions = rbac.getUserPermissions(userId)
    if (!permissions.includes("users:read") && !permissions.includes("admin:all")) {
      return errorResponse("权限不足", 403)
    }

    const users = rbac.listUsers()
    // 脱敏：不返回完整 apiToken
    const safe = users.map((u) => ({
      id: u.id,
      name: u.name,
      apiToken: u.apiToken.slice(0, 8) + "...",
      email: u.email,
      avatarUrl: u.avatarUrl,
      roles: u.roles,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }))
    return jsonResponse({ success: true, data: safe })
  })

  // POST /api/users — 创建用户
  router.post("/api/users", async (ctx) => {
    const userId = getUserId(ctx)
    if (!userId) return errorResponse("未授权", 401)

    const permissions = rbac.getUserPermissions(userId)
    if (!permissions.includes("users:write") && !permissions.includes("admin:all")) {
      return errorResponse("权限不足", 403)
    }

    // 检查 License 用户上限
    const userCount = rbac.getUserCount()
    const { ok, limit } = licenseService.checkUserLimit(userCount)
    if (!ok) {
      return errorResponse(`用户数已达上限 (${limit} 人)，请升级 License`, 403)
    }

    try {
      const body = await parseJsonBody<{ name: string; email?: string; roles?: string[] }>(ctx.request)
      if (!body.name || body.name.trim().length === 0) {
        return errorResponse("用户名不能为空", 400)
      }

      const user = rbac.createUser({
        name: body.name.trim(),
        ...(body.email ? { email: body.email } : {}),
        ...(body.roles ? { roles: body.roles } : {}),
      })

      auditLog.record({
        traceId: crypto.randomUUID(),
        action: "config_update",
        resource: `/api/users/${user.id}`,
        detail: `创建用户: ${user.name}`,
        userId,
      })

      return jsonResponse({ success: true, data: user }, 201)
    } catch (err) {
      return errorResponse(`创建用户失败: ${String(err)}`, 400)
    }
  })

  // DELETE /api/users/:id — 删除用户
  router.delete("/api/users/:id", (ctx) => {
    const userId = getUserId(ctx)
    if (!userId) return errorResponse("未授权", 401)

    const permissions = rbac.getUserPermissions(userId)
    if (!permissions.includes("users:delete") && !permissions.includes("admin:all")) {
      return errorResponse("权限不足", 403)
    }

    const targetId = ctx.params["id"]!
    if (targetId === userId) {
      return errorResponse("不能删除自己的账号", 400)
    }

    const deleted = rbac.deleteUser(targetId)
    if (!deleted) {
      return errorResponse("用户不存在", 404)
    }

    auditLog.record({
      traceId: crypto.randomUUID(),
      action: "config_update",
      resource: `/api/users/${targetId}`,
      detail: `删除用户`,
      userId,
    })

    return jsonResponse({ success: true, message: "用户已删除" })
  })

  // PUT /api/users/:id/roles — 更新用户角色
  router.put("/api/users/:id/roles", async (ctx) => {
    const execUserId = getUserId(ctx)
    if (!execUserId) return errorResponse("未授权", 401)

    const permissions = rbac.getUserPermissions(execUserId)
    if (!permissions.includes("users:write") && !permissions.includes("admin:all")) {
      return errorResponse("权限不足", 403)
    }

    const targetId = ctx.params["id"]!

    try {
      const body = await parseJsonBody<{ roles: string[] }>(ctx.request)
      if (!body.roles || body.roles.length === 0) {
        return errorResponse("角色列表不能为空", 400)
      }

      rbac.setUserRoles(targetId, body.roles)

      auditLog.record({
        traceId: crypto.randomUUID(),
        action: "config_update",
        resource: `/api/users/${targetId}/roles`,
        detail: `角色更新: [${body.roles.join(", ")}]`,
        userId: execUserId,
      })

      return jsonResponse({ success: true, message: "角色已更新" })
    } catch (err) {
      return errorResponse(`更新角色失败: ${String(err)}`, 400)
    }
  })

  // PUT /api/users/:id/token — 重新生成 API Token
  router.put("/api/users/:id/token", (ctx) => {
    const execUserId = getUserId(ctx)
    if (!execUserId) return errorResponse("未授权", 401)

    const permissions = rbac.getUserPermissions(execUserId)
    if (!permissions.includes("users:write") && !permissions.includes("admin:all")) {
      return errorResponse("权限不足", 403)
    }

    const targetId = ctx.params["id"]!
    const newToken = rbac.regenerateToken(targetId)
    if (!newToken) {
      return errorResponse("用户不存在", 404)
    }

    return jsonResponse({ success: true, data: { apiToken: newToken } })
  })

  // GET /api/roles — 列出所有角色
  router.get("/api/roles", (ctx) => {
    const userId = getUserId(ctx)
    if (!userId) return errorResponse("未授权", 401)

    const permissions = rbac.getUserPermissions(userId)
    if (!permissions.includes("roles:read") && !permissions.includes("admin:all")) {
      return errorResponse("权限不足", 403)
    }

    const roles = rbac.listRoles()
    return jsonResponse({ success: true, data: roles })
  })
}
