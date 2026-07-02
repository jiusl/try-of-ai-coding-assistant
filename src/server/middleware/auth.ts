// src/server/middleware/auth.ts
// ====================================================
// 认证中间件
// ====================================================

import { rbac } from "../../infra/rbac.js"
import { apiErrorResponse } from "./json.js"

/** 从请求中提取 Bearer Token 并验证用户身份，未认证返回 401 */
export function requireAuth(ctx: { request: Request }): { userId: string; userName: string } | Response {
  const authHeader = ctx.request.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return apiErrorResponse("UNAUTHORIZED", "请先登录", 401)
  }
  const token = authHeader.slice(7)
  const user = rbac.getUserByToken(token)
  if (!user) {
    return apiErrorResponse("UNAUTHORIZED", "登录已过期，请重新登录", 401)
  }
  return { userId: user.id, userName: user.name }
}
