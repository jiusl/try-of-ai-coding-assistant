// src/cli/output.ts
import chalk from "chalk"
import readline from "readline"
import { Effect } from "effect"
import { AppRuntime } from "../effect/app-runtime.js"
import { ConfirmationStore } from "../tool/confirmation.js"
import type { ExecutionState, ConfirmRequest } from "../agent/types.js"
import type { ToolCall, ToolResult } from "../tool/types.js"

// ====================================================
// 颜色主题
// ====================================================

export const theme = {
  user: chalk.blue.bold,
  assistant: chalk.green.bold,
  system: chalk.gray,
  error: chalk.red.bold,
  warning: chalk.yellow,
  info: chalk.cyan,
  success: chalk.green,
  tool: chalk.magenta,
  thinking: chalk.dim
}

// ====================================================
// 输出函数
// ====================================================

/** 打印分隔线 */
export const printSeparator = (char: string = "─", length: number = 50) => {
  console.log(chalk.gray(char.repeat(length)))
}

/** 打印标题 */
export const printTitle = (title: string) => {
  console.log()
  printSeparator("=")
  console.log(chalk.bold(`  ${title}`))
  printSeparator("=")
  console.log()
}

/** 打印用户消息 */
export const printUserMessage = (content: string) => {
  console.log()
  console.log(theme.user("You:"))
  console.log(`  ${content}`)
}

/** 打印助手消息 */
export const printAssistantMessage = (content: string) => {
  console.log()
  console.log(theme.assistant("Assistant:"))
  console.log(`  ${content}`)
}

/** 打印系统消息 */
export const printSystemMessage = (content: string, type: "info" | "warning" | "error" = "info") => {
  const color = type === "info" ? theme.info : type === "warning" ? theme.warning : theme.error
  console.log(color(`[${type.toUpperCase()}] ${content}`))
}

/** 打印工具调用 */
export const printToolCall = (toolCall: ToolCall, result?: ToolResult) => {
  console.log()
  console.log(theme.tool(`🔧 Calling tool: ${toolCall.function.name}`))
  
  try {
    const args = JSON.parse(toolCall.function.arguments)
    console.log(theme.thinking(`   Arguments: ${JSON.stringify(args, null, 2)}`))
  } catch {
    console.log(theme.thinking(`   Arguments: ${toolCall.function.arguments}`))
  }
  
  if (result) {
    if (result.success) {
      const preview = result.content.slice(0, 200)
      console.log(theme.success(`   Result: ${preview}${result.content.length > 200 ? "..." : ""}`))
    } else {
      console.log(theme.error(`   Error: ${result.error || "Unknown error"}`))
    }
  }
}

/** 打印执行状态（流式）*/
export const printExecutionState = (state: ExecutionState) => {
  switch (state.phase) {
    case "initializing":
      console.log(theme.info("🔄 Initializing..."))
      break
    case "thinking":
      console.log(theme.thinking(`💭 Thinking (iteration ${state.iteration})...`))
      break
    case "calling_tool":
      console.log(theme.tool(`🔧 Calling tool: ${state.currentTool || "unknown"}`))
      break
    case "processing":
      console.log(theme.info("⚙️ Processing result..."))
      break
    case "generating":
      if (state.content) {
        process.stdout.write(state.content)
      }
      break
    case "done":
      console.log()
      console.log(theme.success("✅ Done"))
      break
    case "error":
      console.log(theme.error(`❌ Error: ${state.error || "Unknown error"}`))
      break
  }
}

/** 打印会话列表 */
export const printSessionList = (sessions: Array<{ id: string; title: string; updatedAt: Date; messageCount: number }>) => {
  console.log()
  for (const session of sessions) {
    const date = session.updatedAt.toLocaleString()
    console.log(`  ${chalk.cyan(session.id)}  ${chalk.white(session.title)}`)
    console.log(`      ${chalk.gray(`${date} • ${session.messageCount} messages`)}`)
  }
  console.log()
}

/** 打印 Agent 列表 */
export const printAgentList = (agents: Array<{ id: string; name: string; description: string; enabled?: boolean }>) => {
  console.log()
  for (const agent of agents) {
    const status = agent.enabled !== false ? chalk.green("✓") : chalk.red("✗")
    console.log(`  ${status} ${chalk.cyan(agent.id)}  ${chalk.white(agent.name)}`)
    console.log(`      ${chalk.gray(agent.description)}`)
  }
  console.log()
}

/** 打印工具列表 */
export const printToolList = (tools: Array<{ name: string; description: string; category: string; enabled?: boolean }>) => {
  console.log()
  for (const tool of tools) {
    const status = tool.enabled !== false ? chalk.green("✓") : chalk.red("✗")
    console.log(`  ${status} ${chalk.cyan(tool.name)}  ${chalk.white(`[${tool.category}]`)}`)
    console.log(`      ${chalk.gray(tool.description)}`)
  }
  console.log()
}

/** 创建流式输出处理器 */
export const createStreamHandler = (options?: { verbose?: boolean }) => {
  let currentContent = ""
  const verbose = options?.verbose ?? false
  
  return {
    onChunk: (chunk: string) => {
      process.stdout.write(chunk)
      currentContent += chunk
    },
    onToolCall: (toolCall: ToolCall, result?: ToolResult) => {
      if (verbose) {
        printToolCall(toolCall, result)
      } else {
        // 静默模式：只显示工具名，不显示参数/结果
        console.log(theme.thinking(`  🔧 ${toolCall.function.name}`))
      }
    },
    onPhaseChange: (state: ExecutionState) => {
      if (verbose) {
        if (state.phase !== "generating") {
          printExecutionState(state)
        }
      } else {
        switch (state.phase) {
          case "initializing":
            console.log(theme.info("🔄 Analyzing request..."))
            break
          case "generating":
            if (state.content) {
              process.stdout.write(state.content)
              currentContent += state.content
            }
            break
          case "done":
            console.log()
            break
          case "error":
            console.log(theme.error(`❌ Error: ${state.error || "Unknown error"}`))
            break
        }
      }
    },
    getContent: () => currentContent
  }
}

// ====================================================
// 高敏感操作确认处理器（CLI 终端交互）
// ====================================================

/**
 * 为 CLI 模式创建 onRequireConfirm 回调。
 * 当 executor 检测到高敏感工具（如 run_command）时，
 * 在终端打印确认提示，等待用户输入 y/n 后 resolve ConfirmationStore。
 */
export const createConfirmHandler = () => {
  return (req: ConfirmRequest): void => {
    // 打印确认提示
    console.log()
    console.log(chalk.yellow.bold("╔══════════════════════════════════════╗"))
    console.log(chalk.yellow.bold("║  ⚠️  高敏感操作需要确认               ║"))
    console.log(chalk.yellow.bold("╚══════════════════════════════════════╝"))
    console.log(chalk.white(`  工具:     ${chalk.cyan(req.toolName)}`))
    console.log(chalk.white(`  参数:     ${chalk.gray(req.arguments.slice(0, 200))}`))
    console.log(chalk.white(`  原因:     ${chalk.gray(req.reason)}`))
    console.log()

    // 异步读取用户输入，不阻塞 executor fiber 的通知阶段
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(chalk.yellow("  是否允许执行？(y/n): "), (answer) => {
      rl.close()
      const approved = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes"

      // 通过 Effect 调用 ConfirmationStore.resolve 解除 Deferred 阻塞
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const store = yield* ConfirmationStore
          yield* store.resolve(req.sessionId, approved)
        })
      ).catch((err) => {
        console.error(chalk.red(`确认处理失败: ${err}`))
      })
    })
  }
}