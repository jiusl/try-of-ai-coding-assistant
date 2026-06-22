// src/cli/output.ts
import chalk from "chalk"
import type { ExecutionState } from "../agent/types.js"
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