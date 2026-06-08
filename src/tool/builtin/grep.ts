// src/tool/builtin/grep.ts
import { Effect, Schema } from "effect"
import { readdir, readFile } from "fs/promises"
import { resolve, relative, isAbsolute } from "path"
import { isMatch } from "micromatch"
import type { ToolDefinition } from "../types.js"
import { GrepInput, ToolExecutionError } from "../types.js"

const GrepInputSchema = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
  recursive: Schema.optional(Schema.Boolean),
  ignoreCase: Schema.optional(Schema.Boolean)
})

/** 简易递归 glob：使用 fs.readdir + micromatch */
const glob = async (
  pattern: string,
  options: { cwd: string; ignore?: readonly string[]; absolute?: boolean }
): Promise<string[]> => {
  const { cwd, ignore: ignorePatterns, absolute } = options
  const results: string[] = []

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name)
      const relPath = relative(cwd, fullPath).replace(/\\/g, "/")

      if (ignorePatterns?.some(p => isMatch(relPath, p))) continue
      if (entry.name.startsWith(".")) continue

      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (isMatch(relPath, pattern)) {
        results.push(absolute ? fullPath : relPath)
      }
    }
  }

  await walk(cwd)
  return results
}

export const GrepTool: ToolDefinition<typeof GrepInput.Type, Array<{ file: string; line: number; content: string }>> = {
  name: "grep",
  description: "Search for a pattern in files (like grep). Pass an absolute directory path to search anywhere; or a glob pattern relative to workspace.",
  category: "search",
  permission: "read",
  inputSchema: GrepInputSchema,
  defaultEnabled: true,
  
  execute: (input, context) =>
    Effect.gen(function* () {
      // 支持绝对路径：如果 path 是绝对路径，将其作为搜索根目录
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
      
      for (const file of files.slice(0, 50)) { // 限制扫描文件数
        const content = yield* Effect.catchAll(
          Effect.tryPromise(() => readFile(file, "utf-8")),
          () => Effect.succeed("")
        )
        
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!
          if (pattern.test(line)) {
            results.push({
              file: file.replace(cwd + "/", ""),
              line: i + 1,
              content: line.trim()
            })
          }
        }
      }
      
      return results.slice(0, 100)
    })
}