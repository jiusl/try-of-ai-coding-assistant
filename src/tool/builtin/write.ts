// src/tool/builtin/write.ts
import { Effect, Schema } from "effect"
import { writeFile, mkdir } from "fs/promises"
import { resolve, dirname, isAbsolute } from "path"
import type { ToolDefinition } from "../types.js"
import { WriteInput, ToolExecutionError } from "../types.js"

const WriteInputSchema = Schema.Struct({
  filePath: Schema.String,
  content: Schema.String
})

export const WriteTool: ToolDefinition<typeof WriteInput.Type, string> = {
  name: "write_file",
  description: "Write content to a file. Supports absolute paths and relative paths. Creates parent directories if needed.",
  category: "file",
  permission: "write",
  inputSchema: WriteInputSchema,
  defaultEnabled: true,
  
  execute: (input, context) =>
    Effect.gen(function* () {
      const fullPath = isAbsolute(input.filePath)
        ? input.filePath
        : resolve(context.workspaceRoot, input.filePath)
      
      // 确保目录存在
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(fullPath), { recursive: true }),
        catch: (error) => new ToolExecutionError({
          toolName: "write_file",
          message: `Failed to create directory for: ${input.filePath}`,
          cause: error
        })
      })
      
      yield* Effect.tryPromise({
        try: () => writeFile(fullPath, input.content, "utf-8"),
        catch: (error) => new ToolExecutionError({
          toolName: "write_file",
          message: `Failed to write file: ${input.filePath}`,
          cause: error
        })
      })
      
      return `Successfully wrote to ${input.filePath}`
    })
}