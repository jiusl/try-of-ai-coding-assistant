// src/tool/builtin/bash.ts
import { Effect, Schema } from "effect"
import { exec } from "child_process"
import { promisify } from "util"
import type { ToolDefinition } from "../types.js"
import { BashInput, ToolExecutionError } from "../types.js"

const BashInputSchema = Schema.Struct({
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
  cwd: Schema.optional(Schema.String)
})

const execAsync = promisify(exec)

export const BashTool: ToolDefinition<typeof BashInput.Type, string> = {
  name: "execute_command",
  description: "Execute a bash command in the system shell. Returns stdout and stderr.",
  category: "command",
  permission: "execute",
  inputSchema: BashInputSchema,
  defaultEnabled: true,
  requireConfirm: true,
  
  execute: (input, context) =>
    Effect.gen(function* () {
      const cwd = input.cwd ?? context.workspaceRoot
      
      const result = yield* Effect.tryPromise({
        try: () => execAsync(input.command, {
          cwd,
          timeout: input.timeout ?? 30000,
          shell: "/bin/bash"
        }),
        catch: (error) => new ToolExecutionError({
          toolName: "execute_command",
          message: `命令执行失败: ${input.command}`,
          cause: error
        })
      })
      
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n")
      return output || "命令执行成功（无输出）"
    })
}