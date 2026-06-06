// src/tool/builtin/glob.ts
import { Effect, Schema } from "effect"
import { readdir } from "fs/promises"
import { resolve, relative, isAbsolute } from "path"
import { isMatch } from "micromatch"
import type { ToolDefinition } from "../types.js"
import { GlobInput, ToolExecutionError } from "../types.js"

const GlobInputSchema = Schema.Struct({
  pattern: Schema.String,
  cwd: Schema.optional(Schema.String),
  ignore: Schema.optional(Schema.Array(Schema.String))
})

/** 简易递归 glob：使用 fs.readdir + micromatch */
const glob = async (
  pattern: string,
  options: { cwd: string; ignore?: readonly string[]; absolute?: boolean; nodir?: boolean }
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

export const GlobTool: ToolDefinition<typeof GlobInput.Type, string[]> = {
  name: "glob",
  description: "Find files matching a glob pattern (e.g., '**/*.ts'). Supports absolute paths for cwd.",
  category: "search",
  permission: "read",
  inputSchema: GlobInputSchema,
  defaultEnabled: true,
  
  execute: (input, context) =>
    Effect.gen(function* () {
      const resolvedCwd = input.cwd
        ? isAbsolute(input.cwd) ? input.cwd : resolve(context.workspaceRoot, input.cwd)
        : context.workspaceRoot
      
      const files = yield* Effect.tryPromise({
        try: () => glob(input.pattern, {
          cwd: resolvedCwd,
          ...(input.ignore ? { ignore: input.ignore } : {}),
          absolute: false,
          nodir: true
        }),
        catch: (error) => new ToolExecutionError({
          toolName: "glob",
          message: `Glob search failed: ${input.pattern}`,
          cause: error
        })
      })
      
      return files
    })
}