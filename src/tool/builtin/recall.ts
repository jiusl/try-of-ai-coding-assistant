// src/tool/builtin/recall.ts
// Agent 按需查询长期记忆的工具：用户提到历史对话时才调用
import { Effect, Schema } from "effect"
import type { ToolDefinition } from "../types.js"
import { ToolExecutionError } from "../types.js"
import { Memory } from "../../memory/memory.js"

const RecallInputSchema = Schema.Struct({
  query: Schema.String,
})

export const RecallTool: ToolDefinition<typeof RecallInputSchema.Type, string> = {
  name: "recall",
  description:
    "Recall relevant memories from past conversations. " +
    "Use this tool when the information needed to answer the user's question " +
    "cannot be obtained from the current session context. " +
    "Provide a descriptive query about what you're looking for.\n" +
    "Parameters:\n" +
    "- query (required): Natural language search query describing what you want to recall.",
  category: "search",
  permission: "read",
  sideEffect: "read",
  safeToRetry: true,
  sensitivity: "low",
  defaultEnabled: true,
  inputSchema: RecallInputSchema,

  execute: (input, _context) =>
    Effect.gen(function* () {
      const memory = yield* Memory
      const memories = yield* memory.search(input.query, 10).pipe(
        Effect.mapError(cause => new ToolExecutionError({
          toolName: "recall",
          message: `Failed to retrieve memories: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }))
      )

      if (memories.length === 0) {
        return "No relevant memories found from past conversations."
      }

      const lines = memories.map(
        (m) =>
          `- [${m.category}] (score: ${m.score.toFixed(2)}) ${m.content}` +
          (m.sourceSessionId ? `  (from session: ${m.sourceSessionId.slice(0, 8)}...)` : ""),
      )
      return (
        `Recalled ${memories.length} memor${memories.length === 1 ? "y" : "ies"}:\n\n` +
        lines.join("\n") +
        `\n\nUse this context to answer the user's question.`
      )
    }),
}
