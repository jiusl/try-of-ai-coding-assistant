// src/tool/builtin/read_command.ts
import type { ToolDefinition } from "../types.js"
import { CommandInputSchema, executeCommand } from "./command-common.js"

export const ReadCommandTool: ToolDefinition<typeof CommandInputSchema.Type, string> = {
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
  inputSchema: CommandInputSchema,
  defaultEnabled: true,
  requireConfirm: false,

  execute: (input, context) => executeCommand(input, context, "read_command"),
}
