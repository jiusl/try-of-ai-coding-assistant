// src/tool/builtin/remember.ts
// Agent 主动存储长期记忆的工具：发现值得记住的信息时调用
import { Effect, Schema } from "effect"
import type { ToolDefinition } from "../types.js"
import { ToolExecutionError } from "../types.js"
import { Memory } from "../../memory/memory.js"

const RememberInputSchema = Schema.Struct({
  content: Schema.String,
  category: Schema.optional(Schema.Literal("preference", "fact", "context", "general")),
  importance: Schema.optional(Schema.Number),
})

export const RememberTool: ToolDefinition<typeof RememberInputSchema.Type, string> = {
  name: "remember",
  description:
    "Save an important fact or insight to long-term memory so it can be recalled in future conversations. " +
    "Use this when the user shares personal information (name, role, preferences, goals), " +
    "makes important decisions, or when you discover context worth remembering across sessions. " +
    "Be selective — only save genuinely important, reusable information.",
  category: "reasoning",
  permission: "read",
  sideEffect: "write",
  safeToRetry: true,
  defaultEnabled: true,
  inputSchema: RememberInputSchema,

  execute: (input, _context) =>
    Effect.gen(function* () {
      const memory = yield* Memory
      const entry = yield* memory.remember({
        content: input.content,
        category: input.category ?? "general",
        importance: input.importance ?? 0.5,
      }).pipe(
        Effect.mapError(cause => new ToolExecutionError({
          toolName: "remember",
          message: `Failed to save memory: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }))
      )

      const cat = entry.category
      const imp = entry.importance >= 0.8 ? " ⭐ high importance" : ""
      return `Memory saved: [${cat}]${imp} "${entry.content}"`
    }),
}
