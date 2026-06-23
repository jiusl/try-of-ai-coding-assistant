// src/server/middleware.ts
// ====================================================
// 中间件工具：CORS、JSON 解析、静态文件服务
// ====================================================

import type { RequestContext, RouteHandler } from "./types.js"

// -------------------------------------------------
// CORS 中间件
// -------------------------------------------------

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

/** 创建成功 JSON 响应 */
export function successResponse<T>(data: T, status: number = 200): Response {
  return jsonResponse({ success: true, data }, status)
}

/** 从请求中解析 JSON body */
export async function parseJsonBody<T = unknown>(request: Request): Promise<T> {
  const text = await request.text()
  return JSON.parse(text) as T
}

// -------------------------------------------------
// SSE (Server-Sent Events) 辅助
// -------------------------------------------------

/** 创建 SSE 流响应 */
export function createSSEResponse(): { response: Response; send: (event: string, data: string) => void; close: () => void } {
  let controller: ReadableStreamDefaultController | null = null

  const stream = new ReadableStream({
    start(c) {
      controller = c
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
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
    }
  }

  function close() {
    if (controller) {
      try { controller.close() } catch { /* already closed */ }
      controller = null
    }
  }

  return { response, send, close }
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

const STATIC_DIR = import.meta.dir + "/static/"

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

/** 尝试返回静态文件，若失败则返回 null */
export async function serveStatic(pathname: string): Promise<Response | null> {
  // 规范化路径
  let filePath = pathname.replace(/^\/+/, "") || "index.html"
  
  // 安全检查：防止目录穿越
  if (filePath.includes("..")) return null

  const fullPath = STATIC_DIR + filePath
  const file = Bun.file(fullPath)
  
  const exists = await file.exists()
  if (!exists) return null

  const ext = "." + (filePath.split(".").pop() ?? "")
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream"

  return new Response(file, {
    headers: { "Content-Type": contentType, ...CORS_HEADERS },
  })
}
