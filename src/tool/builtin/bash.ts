// src/tool/builtin/run_command.ts
import { Effect, Schema } from "effect"
import { exec } from "child_process"
import { promisify } from "util"
import type { ToolDefinition } from "../types.js"
import { BashInput, ToolExecutionError } from "../types.js"

const RunCommandInputSchema = Schema.Struct({
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

export const RunCommandTool: ToolDefinition<typeof RunCommandInputSchema.Type, string> = {
  name: "run_command",
  description:
    "Execute a shell command that may modify the system (write/delete files, install packages, etc.). " +
    "Use this for commands like npm install, git commit, mkdir, rm, etc. " +
    "For read-only queries (ls, cat, git status), use read_command instead.\n" +
    "Requires user confirmation before execution.\n" +
    "Parameters:\n" +
    "- command (required): The shell command to execute.\n" +
    "- timeout (optional): Maximum execution time in milliseconds (default: 30000).\n" +
    "- cwd (optional): Working directory for the command (default: workspace root).",
  category: "command",
  permission: "execute",
  sideEffect: "write",
  safeToRetry: false,
  inputSchema: RunCommandInputSchema,
  defaultEnabled: true,
  requireConfirm: true,
  
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
          toolName: "run_command",
          message: `命令执行失败: ${input.command}`,
          cause: error
        })
      })
      
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n")
      return output || "命令执行成功（无输出）"
    })
}