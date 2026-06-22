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
  description:
    "Write content to a file. Supports absolute paths and relative paths. Creates parent directories if needed.\n" +
    "Parameters:\n" +
    "- filePath (required): Absolute or workspace-relative path to write to.\n" +
    "- content (required): The full text content to write.",
  category: "file",
  permission: "write",
  sideEffect: "write",
  safeToRetry: false,
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
          message: `创建目录失败: ${input.filePath}`,
          cause: error
        })
      })
      
      yield* Effect.tryPromise({
        try: () => writeFile(fullPath, input.content, "utf-8"),
        catch: (error) => new ToolExecutionError({
          toolName: "write_file",
          message: `写入文件失败: ${input.filePath}`,
          cause: error
        })
      })
      
      return `成功写入 ${input.filePath}`
    })
}