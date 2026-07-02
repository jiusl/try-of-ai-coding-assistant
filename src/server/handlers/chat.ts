// src/server/handlers/chat.ts
// ====================================================
// 聊天 API 处理器 — 支持 SSE 流式推送
// ====================================================

import { Effect, Cause } from "effect"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { AgentServiceTag } from "../../agent/index.js"
import { Session } from "../../session/session.js"
import { ConfirmationStore } from "../../tool/confirmation.js"
import type { ExecutionState, ConfirmRequest } from "../../agent/types.js"
import {
  createSSEResponse,
  errorResponse,
  successResponse,
  parseJsonBody,
  apiErrorResponse,
  requireAuth,
  errorToStructuredResponse,
} from "../middleware/index.js"
import { errorToApiError } from "../errors.js"
import type { ChatRequest } from "../types.js"
import type { WebSocketManager } from "../websocket.js"
import { subscription } from "../../infra/subscription.js"
import { rbac } from "../../infra/rbac.js"

// 获取 WS 管理器（由 server/index.ts 注入 globalThis）
function getWS(): WebSocketManager | undefined {
  return (globalThis as any).__wsManager
}

// -------------------------------------------------
// 辅助：检查会话配额并自动创建会话
// -------------------------------------------------
function checkAndCreateSession(userId: string): Effect.Effect<{ id: string }, Error> {
  return Effect.gen(function* () {
    // 检查会话数量配额
    const quota = subscription.checkQuota(userId, "session")
    if (!quota.allowed) {
      return yield* Effect.fail(new Error(quota.reason ?? "会话数已达上限"))
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = yield* Session as any
    return yield* svc.create({ userId })
  }) as Effect.Effect<{ id: string }, Error>
}

function autoCreateSessionEffect(): Effect.Effect<{ id: string }> {
  return (checkAndCreateSession("") as any).pipe(
    Effect.catchAll(() => Effect.succeed({ id: crypto.randomUUID() }))
  ) as Effect.Effect<{ id: string }>
}

// -------------------------------------------------
// POST /api/chat/stream — 发送消息（SSE 流式）
// -------------------------------------------------

function handleChatStream(sessionId: string, message: string, agentId: string | undefined, userId: string, displayMessage?: string): Response {
  const { response, send, close, isConnected } = createSSEResponse()

  // 在后台运行 Effect
  const program = Effect.gen(function* () {
    const agentService = yield* AgentServiceTag

    try {
      const result = yield* agentService.runAuto(sessionId, message, {
        ...(displayMessage ? { displayMessage } : {}),
        ...(agentId ? { agentId } : {}),
        onChunk: (chunk: string) => {
          send("chunk", JSON.stringify({ content: chunk }))
          getWS()?.broadcastToSession(sessionId, { type: "chunk", sessionId, data: { content: chunk } })
        },
        onToolCall: (toolCall, result) => {
          send("tool_call", JSON.stringify({
            tool: toolCall.function.name,
            arguments: toolCall.function.arguments,
            result: result ? result.content : null,
          }))
          getWS()?.broadcastToSession(sessionId, { type: "tool_call", sessionId, data: {
            tool: toolCall.function.name,
            arguments: toolCall.function.arguments,
            result: result ? result.content : null,
          }})
        },
        onPhaseChange: (state: ExecutionState) => {
          send("phase", JSON.stringify({
            phase: state.phase,
            iteration: state.iteration,
            currentTool: state.currentTool,
          }))
          getWS()?.broadcastToSession(sessionId, { type: "phase", sessionId, data: {
            phase: state.phase,
            iteration: state.iteration,
            ...(state.currentTool !== undefined ? { currentTool: state.currentTool } : {}),
          }})
        },
        onRequireConfirm: (req: ConfirmRequest) => {
          send("request_confirm", JSON.stringify({
            sessionId: req.sessionId,
            toolCallId: req.toolCallId,
            toolName: req.toolName,
            target: req.target,
            arguments: req.arguments,
            sensitivity: req.sensitivity,
            reason: req.reason,
          }))
        },
      })

      // 记录用量：仅当客户端仍然连接时才计入（避免断连后服务端空跑扣配额）
      if (isConnected()) {
        subscription.recordUsage(userId, 1)
      }

      send("done", JSON.stringify({
        sessionId,
        content: result.content,
        iterations: result.iterations,
        durationMs: result.durationMs,
        tokensUsed: result.tokensUsed,
        warning: result.warning,
      }))
      getWS()?.broadcastToSession(sessionId, { type: "done", sessionId, data: {
        content: result.content,
        iterations: result.iterations,
        durationMs: result.durationMs,
        tokensUsed: result.tokensUsed.totalTokens,
      }})
    } catch (error) {
      // 将 error 转为结构化 ApiError，携带 code + details
      const apiErr = errorToApiError(error)
      console.error("[SSE] Agent 执行错误:", JSON.stringify(apiErr))
      send("error", JSON.stringify({
        error: apiErr.message,
        code: apiErr.code,
        ...(apiErr.details ? { details: apiErr.details } : {}),
      }))
      getWS()?.broadcastToSession(sessionId, {
        type: "error", sessionId,
        data: { error: apiErr.message, code: apiErr.code, ...(apiErr.details ? { details: apiErr.details } : {}) },
      })
    } finally {
      // 关闭 SSE 流，让浏览器知道传输完成
      close()
    }
  })

  // 用 catchAllCause 包裹，确保 defect 也能被捕获并关闭 SSE 流
  const safeProgram = program.pipe(
    Effect.catchAllCause((cause) =>
      Effect.gen(function* () {
        const defectInfo = Cause.pretty(cause)
        console.error("[SSE] Fiber 异常终止:", defectInfo)
        try {
          send("error", JSON.stringify({
            error: "服务器内部异常",
            code: "INTERNAL_ERROR",
            detail: defectInfo.slice(0, 500),
          }))
        } catch {}
        close()
      })
    )
  )

  // 在 background 运行
  AppRuntime.runFork(safeProgram)

  return response
}

// POST /api/chat — 发送消息（非流式）
// -------------------------------------------------

async function handleChatSync(sessionId: string, message: string, agentId: string | undefined, userId: string, displayMessage?: string): Promise<Response> {
  const program = Effect.gen(function* () {
    const agentService = yield* AgentServiceTag
    const confirmationStore = yield* ConfirmationStore

    // 同步 API 无法弹出确认对话框 → 高敏感操作自动拒绝
    const result = yield* agentService.runAuto(sessionId, message, {
      ...(agentId ? { agentId } : {}),
      ...(displayMessage ? { displayMessage } : {}),
      onRequireConfirm: (req) => {
        // 同步模式自动拒绝，避免 Deferred 永久阻塞
        AppRuntime.runFork(
          Effect.gen(function* () {
            yield* confirmationStore.resolve(req.sessionId, false)
          })
        )
      },
    })

    // 记录用量
    subscription.recordUsage(userId, 1)

    return successResponse({
      sessionId,
      content: result.content,
      iterations: result.iterations,
      durationMs: result.durationMs,
      tokensUsed: result.tokensUsed,
      warning: result.warning,
      toolCalls: result.toolCalls.map(tc => ({
        tool: tc.function.name,
        arguments: tc.function.arguments,
      })),
    })
  })

  const response: Response = await AppRuntime.runPromise(
    program.pipe(
      Effect.catchAll((error) =>
        Effect.succeed(errorToStructuredResponse(error))
      )
    )
  )
  return response
}

// -------------------------------------------------
// 注册路由
// -------------------------------------------------

export function registerChatRoutes(router: Router): void {
  // 流式聊天
  router.post("/api/chat/stream", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult

    const quota = subscription.checkQuota(authResult.userId, "chat")
    if (!quota.allowed) {
      return apiErrorResponse("QUOTA_EXCEEDED", quota.reason ?? "配额已用完", 429, quota.resetAt ? { resetAt: quota.resetAt } : undefined)
    }

    const body = await parseJsonBody<ChatRequest & { enrichedMessage?: string }>(ctx.request)

    let sessionId = body.sessionId || ""
    if (!sessionId) {
      const result = await AppRuntime.runPromise(checkAndCreateSession(authResult.userId))
      sessionId = result.id
    }

    return handleChatStream(sessionId, body.enrichedMessage || body.message, body.agentId, authResult.userId, body.message)
  })

  // 同步聊天
  router.post("/api/chat", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult

    const quota = subscription.checkQuota(authResult.userId, "chat")
    if (!quota.allowed) {
      return apiErrorResponse("QUOTA_EXCEEDED", quota.reason ?? "配额已用完", 429, quota.resetAt ? { resetAt: quota.resetAt } : undefined)
    }

    const body = await parseJsonBody<ChatRequest & { enrichedMessage?: string }>(ctx.request)

    let sessionId = body.sessionId || ""
    if (!sessionId) {
      const result = await AppRuntime.runPromise(checkAndCreateSession(authResult.userId))
      sessionId = result.id
    }

    return await handleChatSync(sessionId, body.enrichedMessage || body.message, body.agentId, authResult.userId, body.message)
  })

  // 确认/拒绝高敏感度工具调用
  router.post("/api/chat/confirm", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult

    const body = await parseJsonBody<{ sessionId: string; approved: boolean }>(ctx.request)
    if (!body.sessionId) {
      return errorResponse("缺少 sessionId", 400)
    }
    const program = Effect.gen(function* () {
      const store = yield* ConfirmationStore
      const resolved = yield* store.resolve(body.sessionId, body.approved !== false)
      if (!resolved) {
        return errorResponse(
          `没有找到会话 ${body.sessionId} 的待确认请求（可能已超时自动取消或已被处理）`,
          404
        )
      }
      return successResponse({ sessionId: body.sessionId, resolved: true })
    })
    const response: Response = await AppRuntime.runPromise(
      program.pipe(
        Effect.catchAll((error) =>
          Effect.succeed(errorToStructuredResponse(error))
        )
      )
    )
    return response
  })

  // 取消会话的待确认请求（用户点击停止按钮时调用）
  router.post("/api/chat/cancel", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult

    const body = await parseJsonBody<{ sessionId: string }>(ctx.request)
    if (!body.sessionId) {
      return errorResponse("缺少 sessionId", 400)
    }
    const program = Effect.gen(function* () {
      const store = yield* ConfirmationStore
      yield* store.cancelSession(body.sessionId)
      return successResponse({ sessionId: body.sessionId, cancelled: true })
    })
    const response: Response = await AppRuntime.runPromise(
      program.pipe(
        Effect.catchAll((error) =>
          Effect.succeed(errorToStructuredResponse(error))
        )
      )
    )
    return response
  })
}
