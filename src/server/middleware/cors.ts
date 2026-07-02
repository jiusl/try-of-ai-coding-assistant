// src/server/middleware/cors.ts
// ====================================================
// CORS 中间件
// ====================================================

import type { RequestContext, RouteHandler } from "../types.js"

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
}

/** 为 Response 添加 CORS 头 */
export function withCORS(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** 处理 OPTIONS 预检请求 */
export function handleCORS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

/** 包装 handler，自动处理 CORS 和 OPTIONS */
export function withCorsWrapper(handler: RouteHandler): RouteHandler {
  return async (ctx: RequestContext) => {
    if (ctx.request.method === "OPTIONS") {
      return handleCORS()
    }
    const response = await handler(ctx)
    return withCORS(response)
  }
}

/** CORS headers 常量（供其他模块如 json/sse/static 复用） */
export { CORS_HEADERS }
