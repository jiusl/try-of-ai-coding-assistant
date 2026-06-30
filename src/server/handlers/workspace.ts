// src/server/handlers/workspace.ts
// ====================================================
// Workspace API — 获取/更新工作目录
// ====================================================

import { Effect, Option } from "effect"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { Session } from "../../session/session.js"
import { defaultWorkspace, listWorkspaceSubdirs, sanitizeWorkspace } from "../../infra/workspace.js"
import {
  successResponse,
  errorResponse,
  requireAuth,
  errorToStructuredResponse,
} from "../middleware.js"

// -------------------------------------------------
// 辅助：catchAll error → 结构化错误响应
// -------------------------------------------------
function catchToErrorResponse(): (err: unknown) => Effect.Effect<Response> {
  return (err: unknown) => Effect.succeed(errorToStructuredResponse(err))
}

// -------------------------------------------------
// 注册所有 Workspace 路由
// -------------------------------------------------

export function registerWorkspaceRoutes(router: Router): void {

  // GET /api/workspace — 获取默认工作目录和子目录列表
  router.get("/api/workspace", () => {
    const ws = defaultWorkspace()
    const subdirs = listWorkspaceSubdirs(ws)
    return successResponse({ workspace: ws, subdirs })
  })

  // GET /api/sessions/:id/workspace — 获取会话工作目录
  router.get("/api/sessions/:id/workspace", async (ctx) => {
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const opt = yield* svc.get(id)
        if (Option.isNone(opt)) {
          return errorResponse("Session not found", 404)
        }
        return successResponse({
          workspace: opt.value.workspace || defaultWorkspace(),
          configured: !!opt.value.workspace,
        })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // PUT /api/sessions/:id/workspace — 更新会话工作目录
  router.put("/api/sessions/:id/workspace", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!
    const body = await ctx.request.json().catch(() => ({}))
    const workspace = body?.workspace

    if (!workspace || typeof workspace !== "string") {
      return errorResponse("缺少 workspace 参数", 400)
    }

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const ws = sanitizeWorkspace(workspace)
        yield* svc.updateWorkspace(id, ws)
        return successResponse({ workspace: ws, success: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })
}

