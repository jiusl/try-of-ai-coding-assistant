// src/cli/commands/agent.ts — Agent 管理命令
import { Command } from "commander"
import { Effect } from "effect"
import chalk from "chalk"
import { AppRuntime } from "../../effect/app-runtime.js"
import { AgentServiceTag, AgentRegistry } from "../../agent/index.js"
import { printAgentList, printSystemMessage } from "../output.js"

// ====================================================
// Agent 命令
// ====================================================

export const agentCommand = new Command("agent")
  .description("Manage agents")

// list 子命令
agentCommand
  .command("list")
  .description("List all agents")
  .option("--enabled-only", "Show only enabled agents")
  .action(async (options) => {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const registry = yield* AgentRegistry
        const agents = yield* registry.list({ enabledOnly: options.enabledOnly })
        printAgentList(agents)
      })
    )
    process.exit(0)
  })

// info 子命令
agentCommand
  .command("info <id>")
  .description("Show agent details")
  .action(async (id) => {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const registry = yield* AgentRegistry
        const agent = yield* registry.get(id)
        console.log()
        console.log(chalk.bold("Agent Info:"))
        console.log(chalk.cyan(`  ID:          ${agent.id}`))
        console.log(chalk.white(`  Name:        ${agent.name}`))
        console.log(chalk.gray(`  Description: ${agent.description}`))
        console.log(chalk.white(`  Capabilities: ${agent.capabilities.join(", ")}`))
        console.log(chalk.white(`  Tools:       ${agent.toolNames.length > 0 ? agent.toolNames.join(", ") : "(none)"}`))
        console.log(chalk.white(`  Enabled:     ${agent.enabled !== false ? chalk.green("Yes") : chalk.red("No")}`))
        if (agent.temperature !== undefined) console.log(chalk.white(`  Temperature: ${agent.temperature}`))
        if (agent.maxTokens !== undefined) console.log(chalk.white(`  Max Tokens:  ${agent.maxTokens}`))
        console.log()
      })
    )
    process.exit(0)
  })

// enable 子命令
agentCommand
  .command("enable <id>")
  .description("Enable an agent")
  .action(async (id) => {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const registry = yield* AgentRegistry
        yield* registry.setEnabled(id, true)
        printSystemMessage(`Agent "${id}" enabled`, "info")
      })
    )
    process.exit(0)
  })

// disable 子命令
agentCommand
  .command("disable <id>")
  .description("Disable an agent")
  .action(async (id) => {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const registry = yield* AgentRegistry
        yield* registry.setEnabled(id, false)
        printSystemMessage(`Agent "${id}" disabled`, "info")
      })
    )
    process.exit(0)
  })

// select 子命令
agentCommand
  .command("select <message>")
  .description("Select the best agent for a message")
  .action(async (message) => {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const registry = yield* AgentRegistry
        const agent = yield* registry.select(message)
        console.log()
        console.log(chalk.bold("Selected Agent:"))
        console.log(chalk.cyan(`  ${agent.id} - ${agent.name}`))
        console.log(chalk.gray(`  ${agent.description}`))
        console.log()
      })
    )
    process.exit(0)
  })