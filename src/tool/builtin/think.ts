// src/tool/builtin/think.ts
import { Effect, Schema } from "effect"
import type { ToolDefinition } from "../types.js"
import { ThinkInput } from "../types.js"

const ThinkInputSchema = Schema.Struct({
  thought: Schema.String,
  plan: Schema.optional(Schema.Array(Schema.String))
})

export const ThinkTool = {
  name: "think",
  description:
    "Use this tool to think through a problem or plan a sequence of actions. " +
    "This tool doesn't perform any actions, it's just for reasoning. " +
    "The thought will be recorded but not used for output.\n" +
    "Parameters:\n" +
    "- thought (required): Your internal reasoning.\n" +
    "- plan (optional): List of planned steps.",
  category: "reasoning" as const,
  permission: "read" as const,
  sideEffect: "read" as const,
  safeToRetry: true,
  inputSchema: ThinkInputSchema,
  defaultEnabled: true,
  
  execute: (input: { thought: string }, _context: any) =>
    Effect.succeed(`[Thought recorded] ${input.thought}`)
} as ToolDefinition<any, any>