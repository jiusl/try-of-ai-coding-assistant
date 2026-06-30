// src/server/errors.ts
// ====================================================
// 统一 API 错误码体系 — 零依赖，纯类型定义
// ====================================================

/**
 * API 错误码枚举
 *
 * 命名规范: 类别_具体原因
 * HTTP 状态码由各 handler 自行决定，错误码只描述语义
 */
export const ApiErrorCode = {
  // ── 通用 ──
  BAD_REQUEST:                  "BAD_REQUEST",
  NOT_FOUND:                    "NOT_FOUND",
  INTERNAL_ERROR:               "INTERNAL_ERROR",
  TIMEOUT:                      "TIMEOUT",
  RATE_LIMITED:                 "RATE_LIMITED",

  // ── 校验 ──
  VALIDATION_ERROR:             "VALIDATION_ERROR",
  MISSING_REQUIRED_FIELD:       "MISSING_REQUIRED_FIELD",
  INVALID_FORMAT:               "INVALID_FORMAT",
  VALUE_TOO_LONG:               "VALUE_TOO_LONG",

  // ── 认证 ──
  UNAUTHORIZED:                 "UNAUTHORIZED",
  FORBIDDEN:                    "FORBIDDEN",
  TOKEN_EXPIRED:                "TOKEN_EXPIRED",
  TOKEN_INVALID:                "TOKEN_INVALID",
  WEAK_PASSWORD:                "WEAK_PASSWORD",
  DUPLICATE_EMAIL:              "DUPLICATE_EMAIL",
  INVALID_CREDENTIALS:          "INVALID_CREDENTIALS",

  // ── 资源 ──
  SESSION_NOT_FOUND:            "SESSION_NOT_FOUND",
  AGENT_NOT_FOUND:              "AGENT_NOT_FOUND",
  USER_NOT_FOUND:               "USER_NOT_FOUND",
  USER_LIMIT_REACHED:           "USER_LIMIT_REACHED",

  // ── 聊天 ──
  CHAT_STREAM_ACTIVE:           "CHAT_STREAM_ACTIVE",
  CONFIRMATION_NOT_FOUND:       "CONFIRMATION_NOT_FOUND",
  MAX_ITERATIONS_EXCEEDED:      "MAX_ITERATIONS_EXCEEDED",

  // ── 配额/订阅 ──
  QUOTA_EXCEEDED:               "QUOTA_EXCEEDED",
  TIER_NOT_FOUND:               "TIER_NOT_FOUND",

  // ── License ──
  LICENSE_INVALID:              "LICENSE_INVALID",
  LICENSE_EXPIRED:              "LICENSE_EXPIRED",

  // ── WebSocket ──
  WS_CONNECTION_FAILED:         "WS_CONNECTION_FAILED",
  WS_MESSAGE_INVALID:           "WS_MESSAGE_INVALID",
} as const

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

// ====================================================
// 错误对象类型
// ====================================================

export interface ApiError {
  /** 机器可读错误码 */
  code: ApiErrorCode
  /** 人类可读错误消息 */
  message: string
  /** 可选的字段级错误详情 */
  details?: Record<string, string> | undefined
  /** 可选的 HTTP 状态码覆盖 */
  status?: number | undefined
}

// ====================================================
// 工厂函数
// ====================================================

/** 创建结构化错误对象 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, string>,
  status?: number,
): ApiError {
  return { code, message, ...(details ? { details } : {}), ...(status ? { status } : {}) }
}

// ====================================================
// 预设错误（常用场景快速使用）
// ====================================================

export const PresetErrors = {
  notFound:      (resource: string)      => apiError("NOT_FOUND", `${resource} 不存在`, undefined, 404),
  unauthorized:  (msg = "未登录")          => apiError("UNAUTHORIZED", msg, undefined, 401),
  forbidden:     (msg = "权限不足")         => apiError("FORBIDDEN", msg, undefined, 403),
  badRequest:    (msg: string)            => apiError("BAD_REQUEST", msg, undefined, 400),
  validation:    (msg: string, d?: Record<string, string>) => apiError("VALIDATION_ERROR", msg, d, 400),
  internal:      (msg = "服务器内部错误")   => apiError("INTERNAL_ERROR", msg, undefined, 500),
    rateLimited:   (retryAfter: number)     => apiError("RATE_LIMITED", "请求过于频繁，请稍后再试", undefined, 429),

    auth: {
      invalidCredentials:       apiError("INVALID_CREDENTIALS", "邮箱或密码错误", undefined, 401),
      duplicateEmail:           apiError("DUPLICATE_EMAIL", "该邮箱已注册", undefined, 400),
      weakPassword: (reason: string) => apiError("WEAK_PASSWORD", `密码强度不足: ${reason}`, undefined, 400),
      tokenInvalid:             apiError("TOKEN_INVALID", "令牌无效或已过期", undefined, 401),
      tokenExpired:             apiError("TOKEN_EXPIRED", "令牌已过期", undefined, 401),
    },

    session: {
      notFound:     (id: string) => apiError("SESSION_NOT_FOUND", `会话 ${id} 不存在`, undefined, 404),
    },

    agent: {
      notFound:     (id: string) => apiError("AGENT_NOT_FOUND", `Agent ${id} 不存在`, undefined, 404),
    },

    user: {
      notFound:     ()         => apiError("USER_NOT_FOUND", "用户不存在", undefined, 404),
      limitReached: (limit: number) => apiError("USER_LIMIT_REACHED", `用户数已达上限 (${limit} 人)，请升级 License`, undefined, 403),
    },

    chat: {
      streamActive:   apiError("CHAT_STREAM_ACTIVE", "已有活跃的流式请求", undefined, 409),
      confirmNotFound: apiError("CONFIRMATION_NOT_FOUND", "未找到待确认请求", undefined, 404),
    },

    license: {
      invalid: (reason: string) => apiError("LICENSE_INVALID", `License 无效: ${reason}`, undefined, 400),
    },

    ws: {
      connectionFailed: (reason: string) => apiError("WS_CONNECTION_FAILED", reason, undefined, 500),
    },
  }
// ====================================================
// 错误映射：将 Effect-TS 已标记错误转为结构化 ApiError
// ====================================================

/**
 * 将任意 error 转为 ApiError。
 * 支持识别：
 *  - ProviderError (API 调用失败)
 *  - SDKNotInstalledError (SDK 未安装)
 *  - AuthError (认证失败)
 *  - AgentNotFoundError
 *  - AgentExecutionError
 *  - MaxIterationsExceededError
 *  - NoToolsAvailableError
 *  - 其他 Error / 字符串
 *
 * 注意：此文件零依赖，通过名称匹配而非 import 类型（避免循环依赖）
 */
export function errorToApiError(err: unknown): ApiError {
  // ---- ProviderError ----
  if (isTaggedError(err, "ProviderError")) {
    const e = err as { provider: string; statusCode?: number; message: string }
    const code = statusToErrorCode(e.statusCode)
    const details: Record<string, string> = { provider: e.provider }
    if (e.statusCode !== undefined) details.statusCode = String(e.statusCode)
    return {
      code,
      message: `${e.provider} API 调用失败: ${e.message}`,
      details,
      status: providerStatusToHttp(e.statusCode),
    }
  }

  // ---- SDKNotInstalledError ----
  if (isTaggedError(err, "SDKNotInstalled")) {
    const e = err as { provider: string; installCommand: string; message: string }
    return {
      code: "INTERNAL_ERROR",
      message: e.message,
      details: { provider: e.provider, installCommand: e.installCommand },
      status: 500,
    }
  }

  // ---- AuthError ----
  if (isTaggedError(err, "AuthError")) {
    const e = err as { provider: string; message: string }
    return {
      code: "UNAUTHORIZED",
      message: `${e.provider} 认证失败: ${e.message}`,
      details: { provider: e.provider },
      status: 401,
    }
  }

  // ---- AgentNotFoundError ----
  if (isTaggedError(err, "AgentNotFound")) {
    const e = err as { agentId: string; availableIds?: string; message: string }
    const details: Record<string, string> = { agentId: e.agentId }
    if (e.availableIds) details.availableIds = e.availableIds
    return {
      code: "AGENT_NOT_FOUND",
      message: e.message,
      details,
      status: 404,
    }
  }

  // ---- AgentExecutionError ----
  if (isTaggedError(err, "AgentExecution")) {
    const e = err as { agentId: string; message: string }
    return {
      code: "INTERNAL_ERROR",
      message: `Agent "${e.agentId}" 执行失败: ${e.message}`,
      details: { agentId: e.agentId },
      status: 500,
    }
  }

  // ---- MaxIterationsExceededError ----
  if (isTaggedError(err, "MaxIterationsExceeded")) {
    const e = err as { maxIterations: number; message: string }
    return {
      code: "MAX_ITERATIONS_EXCEEDED",
      message: e.message,
      details: { maxIterations: String(e.maxIterations) },
      status: 422,
    }
  }

  // ---- NoToolsAvailableError ----
  if (isTaggedError(err, "NoToolsAvailable")) {
    const e = err as { agentId: string; message: string }
    return {
      code: "INTERNAL_ERROR",
      message: e.message,
      details: { agentId: e.agentId },
      status: 500,
    }
  }

  // ---- AgentTimeoutError ----
  if (isTaggedError(err, "AgentTimeout")) {
    const e = err as { agentId: string; operation: string; timeoutSeconds: number; message: string }
    return {
      code: "TIMEOUT",
      message: e.message,
      details: { agentId: e.agentId, operation: e.operation, timeoutSeconds: String(e.timeoutSeconds) },
      status: 504,
    }
  }

  // ---- TimeoutException (Effect 原生超时) ----
  if (isTaggedError(err, "TimeoutException")) {
    return {
      code: "TIMEOUT",
      message: "操作超时，请检查网络连接或简化任务后重试",
      status: 504,
    }
  }

  // ---- Error 类型 ----
  if (err instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: err.message || "未知错误",
      status: 500,
    }
  }

  // ---- 字符串 ----
  return {
    code: "INTERNAL_ERROR",
    message: String(err),
    status: 500,
  }
}

/** 检查是否为 TaggedError */
function isTaggedError(err: unknown, tag: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "_tag" in err &&
    (err as Record<string, unknown>)._tag === tag
  )
}

/** HTTP 状态码 → 错误码 */
function statusToErrorCode(statusCode?: number): ApiErrorCode {
  if (statusCode === 401 || statusCode === 403) return "UNAUTHORIZED"
  if (statusCode === 404) return "NOT_FOUND"
  if (statusCode === 429) return "RATE_LIMITED"
  if (statusCode && statusCode >= 500) return "INTERNAL_ERROR"
  return "INTERNAL_ERROR"
}

/** Provider 状态码 → HTTP 状态码 */
function providerStatusToHttp(statusCode?: number): number {
  if (statusCode === 401 || statusCode === 403) return 502 // 上游认证失败 → Bad Gateway
  if (statusCode === 429) return 429
  if (statusCode && statusCode >= 500) return 502
  return 500
}
// ====================================================

export const STATUS_TO_ERROR_CODE: Record<number, ApiErrorCode> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CHAT_STREAM_ACTIVE",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "INTERNAL_ERROR",
  504: "TIMEOUT",
}
