// src/server/middleware/json.ts
// ====================================================
// JSON 响应 / 请求辅助
// ====================================================

import type { ApiError, ApiErrorCode } from "../errors.js"
import { errorToApiError } from "../errors.js"
import { CORS_HEADERS } from "./cors.js"

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
