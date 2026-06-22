// src/memory/compressor.ts
// 方案C：记忆压缩 — 同类记忆过多时自动总结合并
import { Context, Effect, Layer } from "effect"
import { Memory } from "./memory.js"
import type { MemoryCategory } from "./types.js"

// ====================================================
// 服务接口
// ====================================================

export interface MemoryCompressorService {
  /**
   * 压缩同一分类下的记忆。
   * 当某分类记忆数超过阈值时，用 LLM 将多条同类记忆总结为精简摘要。
   */
  readonly compress: (
    category: MemoryCategory,
    options?: CompressOptions
  ) => Effect.Effect<CompressResult, Error>

  /** 检查是否需要压缩 */
  readonly shouldCompress: (
    category: MemoryCategory,
    threshold?: number
  ) => Effect.Effect<boolean, Error>

  /** 设置 LLM（由上层注入） */
  readonly setLLM: (llm: CompressorLLM) => Effect.Effect<void>
}

export class MemoryCompressor extends Context.Tag("MemoryCompressor")<MemoryCompressor, MemoryCompressorService>() {}

export interface CompressorLLM {
  generate: (prompt: string) => Effect.Effect<string, Error>
}

export interface CompressOptions {
  /** 触发压缩的阈值（默认 15） */
  threshold?: number
  /** 每次压缩的最大记忆条数（默认 10） */
  batchSize?: number
  /** 是否干运行（不实际删除） */
  dryRun?: boolean
}

export interface CompressResult {
  original: number
  deleted: number
  summary: string | null
}

// ====================================================
// Live Layer
// ====================================================

export const MemoryCompressorLive = Layer.effect(
  MemoryCompressor,
  Effect.gen(function* () {
    const memory = yield* Memory
    let llm: CompressorLLM | null = null

    const setLLM = (l: CompressorLLM): Effect.Effect<void> =>
      Effect.sync(() => { llm = l })

    const shouldCompress = (
      category: MemoryCategory,
      threshold = 15
    ): Effect.Effect<boolean, Error> =>
      Effect.gen(function* () {
        const stats = yield* memory.stats()
        return (stats.byCategory[category] ?? 0) >= threshold
      })

    const compress = (
      category: MemoryCategory,
      options?: CompressOptions
    ): Effect.Effect<CompressResult, Error> =>
      Effect.gen(function* () {
        if (!llm) {
          return { original: 0, deleted: 0, summary: null }
        }

        const threshold = options?.threshold ?? 15
        const batchSize = options?.batchSize ?? 10
        const dryRun = options?.dryRun ?? false

        // 获取该分类下的低重要度记忆
        const mems = yield* memory.list({ category, limit: batchSize })
        const targets = mems.filter(m => m.importance < 0.6)

        if (targets.length < 2) {
          return { original: targets.length, deleted: 0, summary: null }
        }

        // 构建压缩提示词
        const summaries = targets.map((m, i) => `${i + 1}. [importance: ${m.importance}] ${m.content}`)
        const prompt = `Summarize these ${category} memories into ONE concise sentence that captures ALL key points:

${summaries.join("\n")}

Single summary sentence:`

        const summary = yield* llm.generate(prompt)

        if (!dryRun && summary && summary.length > 0) {
          // 删除原始记忆
          for (const m of targets) {
            yield* memory.forget(m.id)
          }
          // 存摘要
          const sourceSessionId = targets[0]?.sourceSessionId
          yield* memory.remember({
            content: `[压缩摘要] ${summary.trim()}`,
            category,
            importance: 0.4,
            ...(sourceSessionId != null ? { sourceSessionId } : {}),
          }, { autoDedup: true })
        }

        return {
          original: targets.length,
          deleted: dryRun ? 0 : targets.length,
          summary: summary?.trim() ?? null,
        }
      })

    return { compress, shouldCompress, setLLM } satisfies MemoryCompressorService
  })
)
