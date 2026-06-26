// src/tool/builtin/command-common.ts
// run_command 和 read_command 的共享逻辑：Shell 检测、虚拟环境激活、命令执行
import { Effect, Schema } from "effect"
import { exec } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import { join } from "path"
import type { ToolContext } from "../types.js"
import { ToolExecutionError } from "../types.js"

// ====================================================
// 共享 Input Schema
// ====================================================

export const CommandInputSchema = Schema.Struct({
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
  cwd: Schema.optional(Schema.String),
})

// ====================================================
// Shell 检测
// ====================================================

const execAsync = promisify(exec)

const GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  "C:\\Git\\bin\\bash.exe",
]

/** 获取平台对应的 shell：Windows 优先 Git Bash，否则 cmd；Linux/macOS 用 /bin/bash */
export const getShellOption = (): string | true => {
  if (process.platform === "win32") {
    for (const bashPath of GIT_BASH_PATHS) {
      if (existsSync(bashPath)) return bashPath
    }
    return true // 兜底：%COMSPEC% (cmd.exe)
  }
  return "/bin/bash"
}

// ====================================================
// 虚拟环境自动激活
// ====================================================

/**
 * 如果 cwd 下存在 .venv，将原命令包裹为「先激活再执行」。
 * 每次 exec() 都是独立进程，所以每条命令都需要独立激活。
 */
export const wrapWithVenv = (command: string, cwd: string): string => {
  const venvPath = join(cwd, ".venv")
  if (!existsSync(venvPath)) return command

  const shell = getShellOption()
  if (typeof shell === "string" && shell.includes("bash")) {
    return `source "${venvPath}/Scripts/activate" && ${command}`
  }
  if (shell === "/bin/bash") {
    return `source "${venvPath}/bin/activate" && ${command}`
  }
  // cmd.exe
  return `"${venvPath}\\Scripts\\activate.bat" && ${command}`
}

// ====================================================
// 共享执行逻辑
// ====================================================

export interface CommandInput {
  readonly command: string
  readonly timeout?: number | undefined
  readonly cwd?: string | undefined
}

/**
 * 执行一条 shell 命令，自动处理 shell 选择和 .venv 激活。
 * toolName 仅用于错误信息。
 */
export const executeCommand = (
  input: CommandInput,
  context: ToolContext,
  toolName: string,
) =>
  Effect.gen(function* () {
    const cwd = input.cwd ?? context.workspaceRoot
    const resolvedCommand = wrapWithVenv(input.command, cwd)

    const execOptions: Record<string, unknown> = {
      cwd,
      timeout: input.timeout ?? 30000,
    }
    if (getShellOption() !== true) {
      execOptions.shell = getShellOption()
    }

    const result = yield* Effect.tryPromise({
      try: () => execAsync(resolvedCommand, execOptions),
      catch: (error) =>
        new ToolExecutionError({
          toolName,
          message: `命令执行失败: ${input.command}`,
          cause: error,
        }),
    })

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n")
    return output || "命令执行成功（无输出）"
  })
