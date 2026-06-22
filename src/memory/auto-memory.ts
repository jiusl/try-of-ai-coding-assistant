// src/memory/auto-memory.ts
// 方案C：自动记忆提取 — Agent 每次回复后自动从对话中提取关键信息
import { Context, Effect, Layer } from "effect"
import { Memory } from "./memory.js"
import { Provider } from "../provider/provider.js"
import type { CreateMemoryInput, MemoryCategory } from "./types.js"

// ====================================================
// 服务接口
// ====================================================

export interface AutoMemoryService {
  /**
   * 从对话中提取关键信息并存入长期记忆。
   * 调用时机：Agent 每次回复后。
   *
   * @param userMessage 用户刚发送的消息
   * @param assistantMessage Agent 的回复
   * @param sessionId 当前会话 ID
   */
  readonly extract: (
    userMessage: string,
    assistantMessage: string,
    sessionId: string
  ) => Effect.Effect<ExtractResult, Error>

  /**
   * 使用 LLM 分析对话，决定该记住什么。
   * 需要一个 generateText 函数（由上层注入，避免循环依赖）。
   */
  readonly setLLM: (llm: AutoMemoryLLM) => Effect.Effect<void>
}

export class AutoMemory extends Context.Tag("AutoMemory")<AutoMemory, AutoMemoryService>() {}

// ====================================================
// LLM 接口（由 Provider 层实现，此处仅定义契约）
// ====================================================

export interface AutoMemoryLLM {
  generate: (prompt: string) => Effect.Effect<string, Error>
}

export interface ExtractResult {
  extracted: number
  memories: string[]
}

// ====================================================
// Live Layer
// ====================================================

export const AutoMemoryLive = Layer.effect(
  AutoMemory,
  Effect.gen(function* () {
    const memory = yield* Memory
    const provider = yield* Provider

    // 自动注入 LLM：用 Provider 包装 AutoMemoryLLM
    const llm: AutoMemoryLLM = {
      generate: (prompt: string): Effect.Effect<string, Error> =>
        Effect.gen(function* () {
          const response = yield* provider.generate(
            [{ role: "user", content: prompt }],
            { temperature: 0.3, maxTokens: 1024 }
          ).pipe(
            Effect.mapError((e) => new Error(e.message))
          )
          return response.content
        }),
    }

    const setLLM = (l: AutoMemoryLLM): Effect.Effect<void> =>
      Effect.sync(() => { /* no-op: LLM 已在构造时注入，保留接口供外部覆盖 */ })

    const extract = (
      userMessage: string,
      assistantMessage: string,
      sessionId: string
    ): Effect.Effect<ExtractResult, Error> =>
      Effect.gen(function* () {
        const prompt = buildExtractionPrompt(userMessage, assistantMessage)
        const rawResult = yield* llm.generate(prompt)

        // 解析 LLM 返回的 JSON 记忆列表
        const items = parseMemoryItems(rawResult)
        if (items.length === 0) {
          return { extracted: 0, memories: [] }
        }

        const saved: string[] = []
        for (const item of items) {
          if (!item.content || item.content.length < 5) continue
          const input: CreateMemoryInput = {
            content: item.content,
            category: (item.category ?? "general") as MemoryCategory,
            importance: Math.min(1, Math.max(0, item.importance ?? 0.5)),
            sourceSessionId: sessionId,
          }
          yield* memory.remember(input, { autoDedup: true })
          saved.push(item.content)
        }

        return { extracted: saved.length, memories: saved }
      })

    return { extract, setLLM } satisfies AutoMemoryService
  })
)

// ====================================================
// 提示词构建
// ====================================================

const buildExtractionPrompt = (userMessage: string, assistantMessage: string): string =>
  `You are a memory extraction system. Analyze the following conversation and extract key information worth remembering for future sessions.

Rules:
- Extract user preferences, facts, decisions, goals, and context
- Extract only GENUINELY important information
- Do NOT extract trivial details or task-specific instructions
- Assign an importance score (0.0-1.0) and category (preference/fact/context/general)
- Output ONLY valid JSON array, nothing else

Dialogue:
User: ${truncate(userMessage, 500)}
Assistant: ${truncate(assistantMessage, 500)}

Output format:
[{"content": "...", "category": "preference|fact|context|general", "importance": 0.0-1.0}]

Extracted memories (JSON array, or empty array if nothing important):`

// ====================================================
// 解析 LLM 输出
// ====================================================

const parseMemoryItems = (raw: string): Array<{
  content: string
  category?: string
  importance?: number
}> => {
  try {
    // 尝试提取 JSON 数组
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item: any) => typeof item.content === "string")
  } catch {
    return []
  }
}

const truncate = (text: string, maxLen: number): string =>
  text.length <= maxLen ? text : text.slice(0, maxLen) + "..."
