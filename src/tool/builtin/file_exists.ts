// src/tool/builtin/file_exists.ts
import { Effect, Schema } from "effect"
import { stat } from "fs/promises"
import { resolve, isAbsolute } from "path"
import type { ToolDefinition } from "../types.js"
import { ToolExecutionError } from "../types.js"

const FileExistsInputSchema = Schema.Struct({
  path: Schema.String
})

export interface FileExistsOutput {
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

const notFound: FileExistsOutput = {
  exists: false,
  isFile: false,
  isDirectory: false
}

export const FileExistsTool: ToolDefinition<typeof FileExistsInputSchema.Type, FileExistsOutput> = {
  name: "file_exists",
  description:
    "Check whether a file or directory exists at the given path. " +
    "Returns existence, file type (file vs directory). " +
    "Use this before attempting to read or write a file to avoid errors.",
  category: "file",
  permission: "read",
  sideEffect: "read",
  safeToRetry: true,
  sensitivity: "low",
  inputSchema: FileExistsInputSchema,
  defaultEnabled: true,

  execute: (input, context) =>
    Effect.gen(function* () {
      const fullPath = isAbsolute(input.path)
        ? input.path
        : resolve(context.workspaceRoot, input.path)

      const result = yield* Effect.tryPromise({
        try: async () => {
          try {
            const stats = await stat(fullPath)
            return {
              exists: true,
              isFile: stats.isFile(),
              isDirectory: stats.isDirectory()
            } as FileExistsOutput
          } catch {
            return notFound
          }
        },
        catch: (err) => new ToolExecutionError({
          toolName: "file_exists",
          message: `路径检查失败: ${input.path}`,
          cause: err
        })
      })

      return result
    })
}
