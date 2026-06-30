// src/server/handlers/session.ts
// ====================================================
// 会话管理 API 处理器
// ====================================================

import { Effect, Option } from "effect"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { Session } from "../../session/session.js"
import { AgentServiceTag } from "../../agent/index.js"
import { Provider } from "../../provider/provider.js"
import type { Message } from "../../provider/types.js"
import {
  successResponse,
  errorResponse,
  parseJsonBody,
  requireAuth,
  apiErrorResponse,
  errorToStructuredResponse,
} from "../middleware.js"
import type { CreateSessionRequest } from "../types.js"
import type { SessionInfo, SessionWithMessagesInfo } from "../../session/session.js"
import { subscription } from "../../infra/subscription.js"

// -------------------------------------------------
// 辅助：catchAll error → 结构化错误响应
// -------------------------------------------------
function catchToErrorResponse(): (err: unknown) => Effect.Effect<Response> {
  return (err: unknown) => Effect.succeed(errorToStructuredResponse(err))
}

// -------------------------------------------------
// 注册所有会话路由
// -------------------------------------------------

export function registerSessionRoutes(router: Router): void {
  
  // GET /api/sessions — 列出所有会话
  router.get("/api/sessions", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const userId = authResult.userId

    const limit = parseInt(ctx.query.get("limit") ?? "50")
    const offset = parseInt(ctx.query.get("offset") ?? "0")

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const sessions = yield* svc.list({ limit, offset, userId })
        return successResponse<SessionInfo[]>(sessions)
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // GET /api/sessions/:id — 获取会话详情（含消息）
  router.get("/api/sessions/:id", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const opt = yield* svc.getWithMessages(id)
        if (Option.isNone(opt)) {
          return errorResponse("Session not found", 404)
        }
        return successResponse<SessionWithMessagesInfo>(opt.value)
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // POST /api/sessions — 创建新会话
  router.post("/api/sessions", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const userId = authResult.userId
    const body = await parseJsonBody<CreateSessionRequest>(ctx.request).catch(() => ({}))

    // 检查会话数量配额
    const quota = subscription.checkQuota(userId, "session")
    if (!quota.allowed) {
      return apiErrorResponse("QUOTA_EXCEEDED", quota.reason ?? "会话数已达上限", 429, quota.resetAt ? { resetAt: quota.resetAt } : undefined)
    }

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const created = yield* svc.create({ ...body, userId })
        return successResponse<SessionInfo>(created, 201)
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // PUT /api/sessions/:id/title — 更新标题
  router.put("/api/sessions/:id/title", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!
    const body = await parseJsonBody<{ title: string }>(ctx.request)

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        yield* svc.setTitle(id, body.title)
        return successResponse({ updated: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // DELETE /api/sessions/:id — 删除会话
  router.delete("/api/sessions/:id", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        yield* svc.delete(id)
        return successResponse({ deleted: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // PUT /api/sessions/:id/rename — 重命名会话
  router.put("/api/sessions/:id/rename", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!
    const body = await parseJsonBody<{ title: string }>(ctx.request)

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        yield* svc.setTitle(id, body.title)
        return successResponse({ updated: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // PUT /api/sessions/:id/agent — 设置会话绑定的 Agent
  router.put("/api/sessions/:id/agent", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!
    const body = await parseJsonBody<{ agentId: string }>(ctx.request)

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const agentSvc = yield* AgentServiceTag
        yield* agentSvc.setSessionAgent(id, body.agentId)
        return successResponse({ updated: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // POST /api/sessions/:id/generate-title — AI 根据首条消息生成标题
  router.post("/api/sessions/:id/generate-title", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const provider = yield* Provider

        // 获取会话的首条用户消息
        const opt = yield* svc.getWithMessages(id)
        if (Option.isNone(opt)) return errorResponse("Session not found", 404)

        const firstUserMsg = opt.value.messages.find(m => m.role === "user")
        if (!firstUserMsg) return errorResponse("No user message to summarize", 400)

        // 调用 AI 生成简短标题
        const messages: Message[] = [
          {
            role: "system",
            content: "你是一个标题助手。根据用户的第一个问题生成一个简短的中文会话标题（不超过15个字）。只输出标题文本，不要加引号、标点或任何解释。"
          },
          {
            role: "user",
            content: `请为以下对话生成标题: ${firstUserMsg.content}`
          }
        ]

        const genResult = yield* provider.generate(messages, { maxTokens: 50, temperature: 0.5 })
        const title = genResult.content.trim().replace(/^["""'\s]+|["""'\s]+$/g, "").slice(0, 50)

        // 保存标题
        const finalTitle = title || (firstUserMsg.content ?? "").slice(0, 30)
        yield* svc.setTitle(id, finalTitle)

        return successResponse({ title: finalTitle })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // POST /api/sessions/:id/clear — 清空消息
  router.post("/api/sessions/:id/clear", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const count = yield* svc.clearMessages(id)
        return successResponse({ cleared: count })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })
}
