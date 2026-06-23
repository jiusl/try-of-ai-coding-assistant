// src/server/handlers/chat.ts
// ====================================================
// 聊天 API 处理器 — 支持 SSE 流式推送
// ====================================================

import { Effect } from "effect"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { AgentServiceTag } from "../../agent/index.js"
import { Session } from "../../session/session.js"
import { ConfirmationStore } from "../../tool/confirmation.js"
import { MaxIterationsExceededError } from "../../agent/types.js"
import type { ExecutionState, ConfirmRequest } from "../../agent/types.js"
import {
  createSSEResponse,
  errorResponse,
  successResponse,
  parseJsonBody,
} from "../middleware.js"
import type { ChatRequest } from "../types.js"

// -------------------------------------------------
// 辅助：自动创建会话
// runtime 正确：AppLayer 提供了 SessionLive
// 此处 Effect.gen + runPromise 嵌套导致 TS 推断失败，用 any 绕过
// -------------------------------------------------
function autoCreateSessionEffect(): Effect.Effect<{ id: string }> {
  return (Effect.gen(function* () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = yield* Session as any
    return yield* svc.create()
  }) as any).pipe(
    Effect.catchAll(() => Effect.succeed({ id: crypto.randomUUID() }))
  ) as Effect.Effect<{ id: string }>
}

// -------------------------------------------------
// POST /api/chat/stream — 发送消息（SSE 流式）
// -------------------------------------------------

function handleChatStream(sessionId: string, message: string, agentId?: string): Response {
  const { response, send, close } = createSSEResponse()

  // 在后台运行 Effect
  const program = Effect.gen(function* () {
    const agentService = yield* AgentServiceTag

    try {
      const result = yield* agentService.runAuto(sessionId, message, {
        ...(agentId ? { agentId } : {}),
        onChunk: (chunk: string) => {
          send("chunk", JSON.stringify({ content: chunk }))
        },
        onToolCall: (toolCall, result) => {
          send("tool_call", JSON.stringify({
            tool: toolCall.function.name,
            arguments: toolCall.function.arguments,
            result: result ? result.content : null,
          }))
        },
        onPhaseChange: (state: ExecutionState) => {
          send("phase", JSON.stringify({
            phase: state.phase,
            iteration: state.iteration,
            currentTool: state.currentTool,
          }))
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

      send("done", JSON.stringify({
        sessionId,
        content: result.content,
        iterations: result.iterations,
        durationMs: result.durationMs,
        tokensUsed: result.tokensUsed,
        warning: result.warning,
      }))
    } catch (error) {
      if (error instanceof MaxIterationsExceededError) {
        send("error", JSON.stringify({ error: error.message }))
      } else {
        const msg = error instanceof Error ? error.message : String(error)
        send("error", JSON.stringify({ error: msg }))
      }
    } finally {
      // 关闭 SSE 流，让浏览器知道传输完成
      close()
    }
  })

  // 不等待完成，让 SSE 流自然推送
  AppRuntime.runFork(program)

  return response
}

// -------------------------------------------------
// POST /api/chat — 发送消息（非流式）
// -------------------------------------------------

async function handleChatSync(sessionId: string, message: string, agentId?: string): Promise<Response> {
  const program = Effect.gen(function* () {
    const agentService = yield* AgentServiceTag
    const confirmationStore = yield* ConfirmationStore

    // 同步 API 无法弹出确认对话框 → 高敏感操作自动拒绝
    const result = yield* agentService.runAuto(sessionId, message, {
      ...(agentId ? { agentId } : {}),
      onRequireConfirm: (req) => {
        // 同步模式自动拒绝，避免 Deferred 永久阻塞
        AppRuntime.runFork(
          Effect.gen(function* () {
            yield* confirmationStore.resolve(req.sessionId, false)
          })
        )
      },
    })

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
      Effect.catchAll((error: Error) =>
        Effect.succeed(errorResponse(error.message, 500))
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
    const body = await parseJsonBody<ChatRequest>(ctx.request)

    let sessionId = body.sessionId || ""
    if (!sessionId) {
      const result = await AppRuntime.runPromise(autoCreateSessionEffect())
      sessionId = result.id
    }

    return handleChatStream(sessionId, body.message, body.agentId)
  })

  // 同步聊天
  router.post("/api/chat", async (ctx) => {
    const body = await parseJsonBody<ChatRequest>(ctx.request)

    let sessionId = body.sessionId || ""
    if (!sessionId) {
      const result = await AppRuntime.runPromise(autoCreateSessionEffect())
      sessionId = result.id
    }

    return handleChatSync(sessionId, body.message, body.agentId)
  })

  // 确认/拒绝高敏感度工具调用
  router.post("/api/chat/confirm", async (ctx) => {
    const body = await parseJsonBody<{ sessionId: string; approved: boolean }>(ctx.request)
    if (!body.sessionId) {
      return errorResponse("缺少 sessionId", 400)
    }
    const program = Effect.gen(function* () {
      const store = yield* ConfirmationStore
      yield* store.resolve(body.sessionId, body.approved !== false)
      return successResponse({ sessionId: body.sessionId, resolved: true })
    })
    const response: Response = await AppRuntime.runPromise(
      program.pipe(
        Effect.catchAll((error: Error) =>
          Effect.succeed(errorResponse(error.message, 500))
        )
      )
    )
    return response
  })
}
