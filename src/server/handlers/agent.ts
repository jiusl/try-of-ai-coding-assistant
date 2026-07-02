// src/server/handlers/agent.ts
// ====================================================
// Agent 管理 API 处理器
// ====================================================

import { Effect } from "effect"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { AgentServiceTag } from "../../agent/index.js"
import { successResponse, errorToStructuredResponse, requireAuth } from "../middleware/index.js"
import type { AgentConfig } from "../../agent/types.js"

// -------------------------------------------------
// 辅助：将 error 转为错误响应
// -------------------------------------------------
function catchToErrorResponse(): (err: unknown) => Effect.Effect<Response> {
  return (err: unknown) => Effect.succeed(errorToStructuredResponse(err))
}

// -------------------------------------------------
// 注册所有 Agent 路由
// -------------------------------------------------

export function registerAgentRoutes(router: Router): void {

  // GET /api/agents — 列出可用的主 Agent（Chat / Builder）
  router.get("/api/agents", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const service = yield* AgentServiceTag
        const agents = yield* service.listAgents()
        // 只暴露 Chat 和 Builder 两个主 Agent
        const visible = agents.filter(
          a => a.id === "builtin:chat" || a.id === "builtin:builder"
        )
        return successResponse<AgentConfig[]>(visible)
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // GET /api/agents/:id — 获取单个 Agent 详情
  router.get("/api/agents/:id", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const service = yield* AgentServiceTag
        const agent = yield* service.getAgent(id)
        return successResponse<AgentConfig>(agent)
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })
}
