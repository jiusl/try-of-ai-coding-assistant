// src/tool/builtin/run_command.ts
import type { ToolDefinition } from "../types.js"
import { CommandInputSchema, executeCommand } from "./command-common.js"

export const RunCommandTool: ToolDefinition<typeof CommandInputSchema.Type, string> = {
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
  sensitivity: "high",
  inputSchema: CommandInputSchema,
  defaultEnabled: true,
  requireConfirm: true,

  execute: (input, context) => executeCommand(input, context, "run_command"),
}