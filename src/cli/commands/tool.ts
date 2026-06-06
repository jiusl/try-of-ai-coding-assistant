// src/cli/commands/tool.ts
import { Command } from "commander"
import { Effect } from "effect"
import { AppRuntime } from "../../effect/app-runtime.js"
import { ToolRegistry } from "../../tool/index.js"
import { printToolList, printSystemMessage } from "../output.js"

// ====================================================
// 列出工具
// ====================================================

const listTools = (enabledOnly: boolean = false) =>
  Effect.gen(function* () {
    const toolRegistry = yield* ToolRegistry
    const tools = yield* toolRegistry.list({ enabledOnly })
    return tools
  })

// ====================================================
// 启用/禁用工具
// ====================================================

const setToolEnabled = (toolName: string, enabled: boolean) =>
  Effect.gen(function* () {
    const toolRegistry = yield* ToolRegistry
    yield* toolRegistry.setEnabled(toolName, enabled)
    printSystemMessage(`Tool "${toolName}" ${enabled ? "enabled" : "disabled"}`, "info")
  })

// ====================================================
// 工具命令
// ====================================================

export const toolCommand = new Command("tool")
  .description("Manage tools")

// list 子命令
toolCommand
  .command("list")
  .description("List all available tools")
  .option("--enabled-only", "Show only enabled tools")
  .action(async (options) => {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const tools = yield* listTools(options.enabledOnly)
        printToolList(tools)
      })
    )
    process.exit(0)
  })

// enable 子命令
toolCommand
  .command("enable <name>")
  .description("Enable a tool")
  .action(async (toolName: string) => {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        yield* setToolEnabled(toolName, true)
      })
    )
    process.exit(0)
  })

// disable 子命令
toolCommand
  .command("disable <name>")
  .description("Disable a tool")
  .action(async (toolName: string) => {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        yield* setToolEnabled(toolName, false)
      })
    )
    process.exit(0)
  })