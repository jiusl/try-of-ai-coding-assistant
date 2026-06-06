// src/cli/index.ts
import { Command } from "commander"

// 导入命令模块
import { chatCommand } from "./commands/chat.js"
import { runCommand } from "./commands/run.js"
import { agentCommand } from "./commands/agent.js"
import { toolCommand } from "./commands/tool.js"

const packageJson = {
  name: "try",
  version: "0.1.0",
  description: "AI-powered coding assistant"
}

// ====================================================
// 主程序
// ====================================================

export const cli = new Command()
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)

// 注册命令
cli.addCommand(chatCommand)
cli.addCommand(runCommand)
cli.addCommand(agentCommand)
cli.addCommand(toolCommand)