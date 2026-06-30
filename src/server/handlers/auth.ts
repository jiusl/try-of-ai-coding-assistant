// src/server/handlers/auth.ts
// ====================================================
// 认证 API — 登录 / 注册 / 登出 / 刷新 / 修改密码
// ====================================================

import type { Router } from "../router.js"
import { authService, AuthError } from "../../infra/auth.js"
import { rbac } from "../../infra/rbac.js"
import { licenseService } from "../../infra/license.js"
import { subscription } from "../../infra/subscription.js"
import { logger } from "../../infra/logger.js"
import { jsonResponse, errorResponse, parseJsonBody } from "../middleware.js"

// -------------------------------------------------
// 辅助：从请求中提取用户信息
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

// -------------------------------------------------
// 注册路由
// -------------------------------------------------

export function registerAuthRoutes(router: Router): void {

  // POST /api/auth/register — 用户注册
  router.post("/api/auth/register", async (ctx) => {
    try {
      const body = await parseJsonBody<{
        name: string
        email: string
        password: string
      }>(ctx.request)

      if (!body.name?.trim()) {
        return errorResponse("用户名不能为空", 400)
      }
      if (!body.email?.trim() || !body.email.includes("@")) {
        return errorResponse("请输入有效的邮箱地址", 400)
      }
      if (!body.password) {
        return errorResponse("密码不能为空", 400)
      }

      // License 用户上限检查
      const userCount = rbac.getUserCount()
      const { ok, limit } = licenseService.checkUserLimit(userCount)
      if (!ok) {
        return errorResponse(`用户数已达上限 (${limit} 人)，请升级 License`, 403)
      }

      const user = authService.register({
        name: body.name.trim(),
        email: body.email.trim().toLowerCase(),
        password: body.password,
      })

      // 新用户默认分配免费等级
      try {
        subscription.setUserTier(user.id, "free")
      } catch (tierErr) {
        logger.warn(`为用户 ${user.id} 设置默认等级失败`, { error: String(tierErr) })
      }

      // 注册后自动登录，返回和 login 一致的结构（前端需要 tokens）
      const loginResult = authService.login({ email: body.email.trim().toLowerCase(), password: body.password })

      return jsonResponse({
        success: true,
        data: {
          user: {
            id: loginResult.user.id,
            name: loginResult.user.name,
            email: loginResult.user.email,
            roles: loginResult.user.roles,
          },
          tokens: {
            accessToken: loginResult.tokens.accessToken,
            refreshToken: loginResult.tokens.refreshToken,
            expiresAt: loginResult.tokens.expiresAt,
          },
        },
        message: "注册成功",
      }, 201)
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse(err.message, 400)
      }
      return errorResponse(`注册失败: ${String(err)}`, 500)
    }
  })

  // POST /api/auth/login — 用户登录
  router.post("/api/auth/login", async (ctx) => {
    try {
      const body = await parseJsonBody<{
        email: string
        password: string
      }>(ctx.request)

      if (!body.email?.trim()) {
        return errorResponse("请输入邮箱地址", 400)
      }
      if (!body.password) {
        return errorResponse("请输入密码", 400)
      }

      const result = authService.login({
        email: body.email.trim().toLowerCase(),
        password: body.password,
      })

      return jsonResponse({
        success: true,
        data: {
          user: {
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            roles: result.user.roles,
          },
          tokens: {
            accessToken: result.tokens.accessToken,
            refreshToken: result.tokens.refreshToken,
            expiresAt: result.tokens.expiresAt,
          },
        },
        message: "登录成功",
      })
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse(err.message, 401)
      }
      return errorResponse(`登录失败: ${String(err)}`, 500)
    }
  })

  // POST /api/auth/logout — 用户登出
  router.post("/api/auth/logout", (ctx) => {
    const token = getAuthToken(ctx)
    if (!token) {
      return errorResponse("未登录", 401)
    }

    try {
      authService.logout(token)
      return jsonResponse({ success: true, message: "已登出" })
    } catch (err) {
      return errorResponse(`登出失败: ${String(err)}`, 500)
    }
  })

  // POST /api/auth/refresh — 刷新访问令牌
  router.post("/api/auth/refresh", async (ctx) => {
    try {
      const body = await parseJsonBody<{ refreshToken: string }>(ctx.request)
      if (!body.refreshToken) {
        return errorResponse("刷新令牌不能为空", 400)
      }

      const tokens = authService.refreshToken(body.refreshToken)
      return jsonResponse({
        success: true,
        data: tokens,
        message: "令牌刷新成功",
      })
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse(err.message, 401)
      }
      return errorResponse(`刷新失败: ${String(err)}`, 500)
    }
  })

  // GET /api/auth/me — 获取当前用户信息
  router.get("/api/auth/me", (ctx) => {
    const user = getAuthenticatedUser(ctx)
    if (!user) {
      return errorResponse("未登录", 401)
    }

    const hasPwd = authService.hasPassword(user.id)

    return jsonResponse({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        hasPassword: hasPwd,
        createdAt: user.createdAt,
      },
    })
  })

  // PUT /api/auth/password — 修改密码
  router.put("/api/auth/password", async (ctx) => {
    const user = getAuthenticatedUser(ctx)
    if (!user) {
      return errorResponse("未登录", 401)
    }

    try {
      const body = await parseJsonBody<{
        oldPassword: string
        newPassword: string
      }>(ctx.request)

      if (!body.oldPassword || !body.newPassword) {
        return errorResponse("原密码和新密码都不能为空", 400)
      }

      authService.changePassword(user.id, body.oldPassword, body.newPassword)
      return jsonResponse({ success: true, message: "密码修改成功，请重新登录" })
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse(err.message, 400)
      }
      return errorResponse(`修改密码失败: ${String(err)}`, 500)
    }
  })
}
