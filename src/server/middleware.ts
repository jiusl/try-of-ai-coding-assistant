// src/server/middleware.ts
// ====================================================
// 中间件工具：CORS、安全头、JSON 解析、静态文件服务
// ====================================================

import type { RequestContext, RouteHandler } from "./types.js"
import type { ApiError, ApiErrorCode } from "./errors.js"
import { errorToApiError } from "./errors.js"
import { rbac } from "../infra/rbac.js"
import { existsSync } from "fs"

// -------------------------------------------------
// CORS 中间件
// -------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
}

/** 安全响应头 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' https://cdn.jsdelivr.net; " +
    "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.deepseek.com; " +
    "frame-src 'none'; " +
    "object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  // HSTS 仅在 HTTPS 下生效，通过环境变量控制
  ...(process.env.TRY_HSTS_ENABLE === "true"
    ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload" }
    : {}),
}

/** 合并安全头到已有 headers */
export function applySecurityHeaders(headers: Headers): Headers {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  }
  return headers
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

// -------------------------------------------------
// JSON 响应 / 请求辅助
// -------------------------------------------------

/** 创建 JSON 响应 */
export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  })
}

/** 创建错误 JSON 响应 */
export function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ success: false, error: message }, status)
}

/** 创建结构化 API 错误响应（使用统一错误码） */
export function apiErrorResponse(
  code: ApiErrorCode,
  message: string,
  status: number = 400,
  details?: Record<string, string>,
): Response {
  const body: { success: false; error: ApiError } = {
    success: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  }
  return jsonResponse(body, status)
}

/** 将任意错误转为结构化 API 错误响应 */
export function errorToStructuredResponse(err: unknown, fallbackStatus = 500): Response {
  const apiErr = errorToApiError(err)
  return jsonResponse(
    { success: false, error: apiErr },
    apiErr.status ?? fallbackStatus,
  )
}

/** 创建成功 JSON 响应 */
export function successResponse<T>(data: T, status: number = 200): Response {
  return jsonResponse({ success: true, data }, status)
}

/** 从请求中解析 JSON body */
export async function parseJsonBody<T = unknown>(request: Request): Promise<T> {
  let text: string
  try {
    text = await request.text()
  } catch (err) {
    throw new Error(`无法读取请求体: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!text || text.trim() === "") {
    throw new Error("请求体为空，请提供有效的 JSON 数据")
  }
  try {
    return JSON.parse(text) as T
  } catch (err) {
    const preview = text.length > 200 ? text.slice(0, 200) + "..." : text
    throw new Error(`JSON 解析失败: ${err instanceof Error ? err.message : String(err)}。请求体: ${preview}`)
  }
}

// -------------------------------------------------
// SSE (Server-Sent Events) 辅助
// -------------------------------------------------

/** 创建 SSE 流响应 */
export function createSSEResponse(): {
  response: Response
  send: (event: string, data: string) => void
  close: () => void
  /** 客户端是否仍然连接 */
  isConnected: () => boolean
} {
  let controller: ReadableStreamDefaultController | null = null
  let cancelled = false

  const stream = new ReadableStream({
    start(c) {
      controller = c
    },
    cancel() {
      cancelled = true
      controller = null
    },
  })

  const encoder = new TextEncoder()

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...CORS_HEADERS,
    },
  })

  function send(event: string, data: string) {
    if (controller) {
      try {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
      } catch {
        cancelled = true
        controller = null
      }
    }
  }

  function close() {
    if (controller) {
      try { controller.close() } catch { /* already closed */ }
      controller = null
    }
  }

  function isConnected() {
    return !cancelled && controller !== null
  }

  return { response, send, close, isConnected }
}

/** 关闭 SSE 流 */
export function createSSECloser(response: { response: Response; send: (event: string, data: string) => void }) {
  let closed = false
  return {
    send: response.send,
    close() {
      if (!closed) {
        closed = true
        response.send("done", JSON.stringify({}))
      }
    },
  }
}

// -------------------------------------------------
// 静态文件服务
// -------------------------------------------------

// 静态文件目录：编译模式用 binary 旁边的 web/，开发模式用 dist/web/
const DIST_WEB_DIR: string = (() => {
  const compiledDir = import.meta.dir + "/web/"
  if (existsSync(compiledDir)) return compiledDir
  return import.meta.dir + "/../../dist/web/"
})()

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

// -------------------------------------------------
// 认证辅助
// -------------------------------------------------

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

/** 返回 React 构建产物的静态文件，不存在则 null */
export async function serveStatic(pathname: string): Promise<Response | null> {
  // 规范化路径
  let filePath = pathname.replace(/^\/+/, "") || "index.html"
  
  // 安全检查：防止目录穿越
  if (filePath.includes("..")) return null

  const distPath = DIST_WEB_DIR + filePath
  const distFile = Bun.file(distPath)
  if (await distFile.exists()) {
    const ext = "." + (filePath.split(".").pop() ?? "")
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
    return new Response(distFile, {
      headers: { "Content-Type": contentType, ...CORS_HEADERS },
    })
  }

  return null
}
