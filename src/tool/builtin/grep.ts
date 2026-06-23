// src/tool/builtin/grep.ts
import { Effect, Schema } from "effect"
import { readFile } from "fs/promises"
import { resolve, isAbsolute } from "path"
import type { ToolDefinition } from "../types.js"
import { GrepInput, ToolExecutionError } from "../types.js"
import { glob } from "./glob.js"

const GrepInputSchema = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
  recursive: Schema.optional(Schema.Boolean),
  ignoreCase: Schema.optional(Schema.Boolean)
})

export const GrepTool: ToolDefinition<typeof GrepInput.Type, Array<{ file: string; line: number; content: string }>> = {
  name: "grep",
  description:
    "Search for a regex pattern in file contents. " +
    "Use 'path' for the directory to search (absolute) or glob pattern (relative to workspace). " +
    "This is a convenience tool that combines file-finding and content-searching. " +
    "For more control, use glob to find files first, then grep those files.\n" +
    "Parameters:\n" +
    "- pattern (required): A regex pattern to search for (e.g. 'function|class', 'TODO|FIXME').\n" +
    "- path (optional): Directory (absolute path) or glob pattern relative to workspace.\n" +
    "- recursive (optional): Search subdirectories (default: false).\n" +
    "- ignoreCase (optional): Case-insensitive search (default: false).",
  category: "search",
  permission: "read",
  sideEffect: "read",
  safeToRetry: true,
  sensitivity: "low",
  inputSchema: GrepInputSchema,
  defaultEnabled: true,
  
  execute: (input, context) =>
    Effect.gen(function* () {
      const isAbsPath = input.path && isAbsolute(input.path)
      const searchPath = isAbsPath ? "**/*" : (input.path ?? "**/*")
      const cwd = isAbsPath ? input.path! : context.workspaceRoot
      
      const files = yield* Effect.tryPromise({
        try: () => glob(searchPath, { cwd, absolute: true }),
        catch: (error) => new ToolExecutionError({
          toolName: "grep",
          message: `grep 文件查找失败: ${searchPath}`,
          cause: error
        })
      })
      
      const pattern = input.ignoreCase 
        ? new RegExp(input.pattern, "i") 
        : new RegExp(input.pattern)
      
      const results: Array<{ file: string; line: number; content: string }> = []
      
      const cwdSlash = cwd.replace(/\\/g, "/")
      for (const file of files.slice(0, 50)) {
        const content = yield* Effect.catchAll(
          Effect.tryPromise(() => readFile(file, "utf-8")),
          () => Effect.succeed("")
        )
        
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!
          if (pattern.test(line)) {
            results.push({
              file: file.replace(cwdSlash + "/", ""),
              line: i + 1,
              content: line.trim()
            })
          }
        }
      }
      
      return results.slice(0, 100)
    })
}