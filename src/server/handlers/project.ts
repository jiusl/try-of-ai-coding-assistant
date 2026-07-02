// src/server/handlers/project.ts
// ====================================================
// 项目管理 API 处理器
// ====================================================

import { Effect, Option } from "effect"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { Project } from "../../project/project.js"
import type { ProjectInfo, CreateProjectInput, UpdateProjectInput } from "../../project/project.js"
import {
  successResponse,
  errorResponse,
  parseJsonBody,
  requireAuth,
  errorToStructuredResponse,
} from "../middleware/index.js"
import { basename } from "path"

// -------------------------------------------------
// 辅助：catchAll error → 结构化错误响应
// -------------------------------------------------
function catchToErrorResponse(): (err: unknown) => Effect.Effect<Response> {
  return (err: unknown) => Effect.succeed(errorToStructuredResponse(err))
}

// -------------------------------------------------
// 注册所有项目路由
// -------------------------------------------------

export function registerProjectRoutes(router: Router): void {

  // GET /api/projects — 列出所有项目
  router.get("/api/projects", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Project
        const projects = yield* svc.list()
        return successResponse<ProjectInfo[]>(projects)
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // POST /api/projects — 创建项目
  // body: { path: string }
  router.post("/api/projects", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const body = await parseJsonBody<{ path: string }>(ctx.request)

    if (!body.path) {
      return errorResponse("缺少 path 参数", 400)
    }

    // 项目名称取自路径的文件夹名
    const name = basename(body.path)

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Project
        const input: CreateProjectInput = { name, path: body.path }
        const project = yield* svc.create(input)
        return successResponse<ProjectInfo>(project, 201)
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // GET /api/projects/:id — 获取单个项目
  router.get("/api/projects/:id", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Project
        const opt = yield* svc.get(id)
        if (Option.isNone(opt)) {
          return errorResponse("项目不存在", 404)
        }
        return successResponse<ProjectInfo>(opt.value)
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // PUT /api/projects/:id — 更新项目（重命名/改路径）
  router.put("/api/projects/:id", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!
    const body = await parseJsonBody<UpdateProjectInput>(ctx.request)

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Project
        yield* svc.update(id, body)
        return successResponse({ updated: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // DELETE /api/projects/:id — 删除项目（级联删除会话）
  router.delete("/api/projects/:id", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Project
        yield* svc.delete(id)
        return successResponse({ deleted: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // POST /api/projects/:id/activate — 激活项目
  router.post("/api/projects/:id/activate", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Project
        yield* svc.touch(id)
        return successResponse({ activated: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })
}
