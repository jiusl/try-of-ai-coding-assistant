// src/tool/builtin/read.ts
import { Effect, Schema } from "effect"
import { readFile } from "fs/promises"
import { resolve, isAbsolute } from "path"
import type { ToolDefinition } from "../types.js"
import { ReadInput, ToolExecutionError } from "../types.js"

const ReadInputSchema = Schema.Struct({
  filePath: Schema.String,
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
})

export const ReadTool: ToolDefinition<typeof ReadInput.Type, string> = {
  name: "read_file",
  description: "Read the contents of a file. Supports absolute paths (e.g. D:/projects/main.ts) and relative paths from workspace.",
  category: "file",
  permission: "read",
  inputSchema: ReadInputSchema,
  defaultEnabled: true,
  
  execute: (input, context) =>
    Effect.gen(function* () {
      const fullPath = isAbsolute(input.filePath)
        ? input.filePath
        : resolve(context.workspaceRoot, input.filePath)
      
      const content = yield* Effect.tryPromise({
        try: () => readFile(fullPath, "utf-8"),
        catch: (error) => new ToolExecutionError({
          toolName: "read_file",
          message: `Failed to read file: ${input.filePath}`,
          cause: error
        })
      })
      
      // 支持偏移和限制
      if (input.offset !== undefined || input.limit !== undefined) {
        const lines = content.split("\n")
        const start = input.offset ?? 0
        const end = input.limit ? start + input.limit : undefined
        return lines.slice(start, end).join("\n")
      }
      
      return content
    })
}