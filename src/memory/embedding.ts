// src/memory/embedding.ts
// Embedding 服务：优先本地 GGUF 模型，不可用时降级为 FTS5 纯文本检索
import { Context, Effect, Layer } from "effect"
import type { EmbeddingVector } from "./types.js"

// ====================================================
// 服务接口
// ====================================================

export interface EmbeddingServiceImpl {
  /** 检查 embedding 是否可用 */
  readonly isAvailable: Effect.Effect<boolean>

  /**
   * 生成文本的 embedding 向量。
   * 本地 GGUF 模型不可用时返回 None，调用方应降级为 FTS5。
   */
  readonly embed: (text: string) => Effect.Effect<EmbeddingVector, EmbeddingError>

  /**
   * 批量生成 embedding（更高效）
   */
  readonly embedBatch: (texts: string[]) => Effect.Effect<EmbeddingVector[], EmbeddingError>
}

export class EmbeddingService extends Context.Tag("EmbeddingService")<EmbeddingService, EmbeddingServiceImpl>() {}

// ====================================================
// 错误类型
// ====================================================

export class EmbeddingError {
  readonly _tag = "EmbeddingError"
  constructor(
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

// ====================================================
// Live Layer — 尝试加载本地 GGUF 模型做 embedding
// ====================================================

export const EmbeddingServiceLive = Layer.effect(
  EmbeddingService,
  Effect.gen(function* () {
    // 懒加载 node-llama-cpp SDK 和 embedding context
    let sdk: any = null
    let embedContext: any = null
    let initAttempted = false

    const tryInit = (): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (initAttempted) return sdk !== null && embedContext !== null
        initAttempted = true
        try {
          // 动态加载 node-llama-cpp
          const mod: any = yield* Effect.tryPromise(() => import("node-llama-cpp"))
          const getLlama: any = mod.getLlama ?? mod.default?.getLlama
          if (!getLlama) return false

          const llama: any = yield* Effect.tryPromise(() => getLlama())

          // 查找 GGUF 模型
          const fsMod: any = yield* Effect.tryPromise(() => import("fs/promises"))
          const pathMod: any = yield* Effect.tryPromise(() => import("path"))
          const modelDir: string = pathMod.default.join(process.cwd(), "model")
          let entries: string[] = []
          try {
            entries = yield* Effect.tryPromise(
              () => fsMod.default.readdir(modelDir) as Promise<string[]>
            )
          } catch {
            return false
          }
          const ggufFiles = entries
            .filter((f: string) => f.endsWith(".gguf"))
            .map((f: string) => pathMod.default.join(modelDir, f))
            .sort()
          if (ggufFiles.length === 0) return false

          // 加载模型（embedding 模式只需读模型结构）
          const model: any = yield* Effect.tryPromise(() =>
            llama.loadModel({ modelPath: ggufFiles[0]! })
          )
          embedContext = yield* Effect.tryPromise(() =>
            model.createContext({ contextSize: 512 })
          )
          sdk = mod
          return true
        } catch {
          return false
        }
      }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    const isAvailable: Effect.Effect<boolean> = Effect.orElseSucceed(
      tryInit(),
      () => false
    )

    const embed = (text: string): Effect.Effect<EmbeddingVector, EmbeddingError> =>
      Effect.gen(function* () {
        const ready = yield* tryInit()
        if (!ready || !embedContext) {
          return yield* Effect.fail(
            new EmbeddingError("本地 GGUF 模型不可用，请降级为 FTS5 检索")
          )
        }
        const sequence = embedContext.getSequence()
        return yield* Effect.try({
          try: () => sequence.embed(text) as EmbeddingVector,
          catch: (e: unknown) =>
            new EmbeddingError(
              `Embedding 生成失败: ${e instanceof Error ? e.message : String(e)}`,
              e
            ),
        })
      })

    const embedBatch = (texts: string[]): Effect.Effect<EmbeddingVector[], EmbeddingError> =>
      Effect.gen(function* () {
        const ready = yield* tryInit()
        if (!ready || !embedContext) {
          return yield* Effect.fail(
            new EmbeddingError("本地 GGUF 模型不可用，请降级为 FTS5 检索")
          )
        }
        const sequence = embedContext.getSequence()
        const results: EmbeddingVector[] = []
        for (const text of texts) {
          const vec = yield* Effect.try({
            try: () => sequence.embed(text) as EmbeddingVector,
            catch: (e: unknown) =>
              new EmbeddingError(
                `批量 Embedding 失败: ${e instanceof Error ? e.message : String(e)}`,
                e
              ),
          })
          results.push(vec)
        }
        return results
      })

    return { isAvailable, embed, embedBatch } satisfies EmbeddingServiceImpl
  })
)

// ====================================================
// Mock 版本（用于测试）
// ====================================================

export const EmbeddingServiceMock = Layer.succeed(
  EmbeddingService,
  EmbeddingService.of({
    isAvailable: Effect.succeed(false),
    embed: () => Effect.fail(new EmbeddingError("Mock: 不可用")),
    embedBatch: () => Effect.fail(new EmbeddingError("Mock: 不可用")),
  } satisfies EmbeddingServiceImpl)
)

// ====================================================
// 工具函数：余弦相似度
// ====================================================

export const cosineSimilarity = (a: EmbeddingVector, b: EmbeddingVector): number => {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** 时间衰减因子：越旧的记忆权重越低，半衰期 30 天 */
export const timeDecayFactor = (lastAccessedAt: Date, halfLifeDays: number = 30): number => {
  const daysSince = (Date.now() - lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24)
  return Math.exp(-Math.LN2 * daysSince / halfLifeDays)
}
