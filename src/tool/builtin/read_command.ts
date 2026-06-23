// src/tool/builtin/read_command.ts
import { Effect, Schema } from "effect"
import { exec } from "child_process"
import { promisify } from "util"
import type { ToolDefinition } from "../types.js"
import { ToolExecutionError } from "../types.js"

const ReadCommandInputSchema = Schema.Struct({
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
  cwd: Schema.optional(Schema.String)
})

const execAsync = promisify(exec)

/** 获取平台对应的 shell 选项 */
const getShellOption = (): string | true => {
  if (process.platform === "win32") {
    return true // 传 true 让 Node 自动使用 %COMSPEC%
  }
  return "/bin/bash"
}

export const ReadCommandTool: ToolDefinition<typeof ReadCommandInputSchema.Type, string> = {
  name: "read_command",
  description:
    "Execute a read-only shell command that does NOT modify the system. " +
    "Use this for queries like: ls, cat, pwd, git status, git log, git diff, " +
    "echo, which, node --version, npm list, etc. " +
    "For commands that modify the system (write/delete/install), use run_command instead.",
  category: "command",
  permission: "read",
  sideEffect: "read",
  safeToRetry: true,
  sensitivity: "medium",
  inputSchema: ReadCommandInputSchema,
  defaultEnabled: true,
  requireConfirm: false,

  execute: (input, context) =>
    Effect.gen(function* () {
      const cwd = input.cwd ?? context.workspaceRoot

      const execOptions: Record<string, unknown> = {
        cwd,
        timeout: input.timeout ?? 30000,
      }
      if (getShellOption() !== true) {
        execOptions.shell = getShellOption()
      }

      const result = yield* Effect.tryPromise({
        try: () => execAsync(input.command, execOptions),
        catch: (error) => new ToolExecutionError({
          toolName: "read_command",
          message: `命令执行失败: ${input.command}`,
          cause: error
        })
      })

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n")
      return output || "命令执行成功（无输出）"
    })
}
