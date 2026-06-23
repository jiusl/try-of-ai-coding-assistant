// src/tool/confirmation.ts
// ====================================================
// 工具确认存储 — 用于高敏感度工具的暂停-确认-恢复流程
// ====================================================
import { Context, Effect, Layer, Ref, Deferred, Queue } from "effect"
import type { ConfirmRequest } from "./types.js"

// -------------------------------------------------
// 内部状态
// -------------------------------------------------

interface PendingEntry {
  request: ConfirmRequest
  deferred: Deferred.Deferred<boolean>
}

// -------------------------------------------------
// 服务接口
// -------------------------------------------------

export interface ConfirmationStoreService {
  /**
   * 请求用户确认。返回一个 Effect，在用户做出决定前会一直阻塞。
   * 同时将确认请求推入 eventQueue，供 SSE 层读取并发送给前端。
   *
   * @returns true=用户批准, false=用户拒绝
   */
  readonly request: (req: ConfirmRequest) => Effect.Effect<boolean>

  /**
   * 解析确认请求（由前端 POST handler 调用）
   */
  readonly resolve: (sessionId: string, approved: boolean) => Effect.Effect<void>

  /**
   * 获取事件队列 — SSE 层从中读取待发送的确认请求事件
   */
  readonly eventQueue: Queue.Queue<ConfirmRequest>

  /**
   * 取消某个会话的所有待确认请求
   */
  readonly cancelSession: (sessionId: string) => Effect.Effect<void>
}

export class ConfirmationStore extends Context.Tag("ConfirmationStore")<
  ConfirmationStore,
  ConfirmationStoreService
>() {}

// -------------------------------------------------
// Live Layer
// -------------------------------------------------

export const ConfirmationStoreLive = Layer.effect(
  ConfirmationStore,
  Effect.gen(function* () {
    const pendingRef = yield* Ref.make<Map<string, PendingEntry>>(new Map())
    const eventQueue = yield* Queue.unbounded<ConfirmRequest>()

    const request = (req: ConfirmRequest): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<boolean>()
        const entry: PendingEntry = { request: req, deferred }

        // 存储到 pending map（按 sessionId 索引，同一会话同时只有一个确认）
        yield* Ref.set(pendingRef, new Map([[req.sessionId, entry]]))

        // 推入事件队列，SSE 层读取后发给前端
        yield* Queue.offer(eventQueue, req)

        // 等待用户决定（阻塞 Effect fiber）
        const approved = yield* Deferred.await(deferred)
        return approved
      })

    const resolve = (sessionId: string, approved: boolean): Effect.Effect<void> =>
      Effect.gen(function* () {
        const map = yield* Ref.get(pendingRef)
        const entry = map.get(sessionId)
        if (entry) {
          yield* Deferred.succeed(entry.deferred, approved)
          yield* Ref.set(pendingRef, new Map())
        }
      })

    const cancelSession = (sessionId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const map = yield* Ref.get(pendingRef)
        const entry = map.get(sessionId)
        if (entry) {
          yield* Deferred.succeed(entry.deferred, false) // 当作拒绝处理
          yield* Ref.set(pendingRef, new Map())
        }
      })

    return { request, resolve, eventQueue, cancelSession } as ConfirmationStoreService
  })
)
