// src/cli/repl.ts
import { Effect, Option } from "effect"
import readline from "readline"
import chalk from "chalk"
import { AppRuntime } from "../effect/app-runtime.js"
import { AgentServiceTag } from "../agent/index.js"
import { Session } from "../session/session.js"
import { createStreamHandler, printUserMessage, printAssistantMessage, printSystemMessage } from "./output.js"

// ====================================================
// 主 Agent 常量 — 仅 Chat & Builder 可在 REPL 中切换
// ====================================================

const PRIMARY_AGENTS = {
  chat: "builtin:chat",
  builder: "builtin:builder",
} as const

const PRIMARY_AGENT_LABELS: Record<string, string> = {
  "builtin:chat": "Chat",
  "builtin:builder": "Builder",
}

function resolvePrimaryAgent(id: string): string | null {
  if (id === "chat" || id === "builtin:chat") return "builtin:chat"
  if (id === "builder" || id === "builtin:builder") return "builtin:builder"
  return null
}

// ====================================================
// REPL 类 — 交互式对话循环
// ====================================================

export class REPL {
  private sessionId: string
  private verbose: boolean
  private currentAgentId: string = "builtin:chat"
  private processing: Promise<void> = Promise.resolve()
  private rl: readline.Interface

  constructor(sessionId: string, options?: { verbose?: boolean }) {
    this.sessionId = sessionId
    this.verbose = options?.verbose ?? false
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.makePrompt()
    })
    this.setupTabSwitching()
  }

  // ====================================================
  // 动态提示符
  // ====================================================

  private makePrompt(): string {
    const label = PRIMARY_AGENT_LABELS[this.currentAgentId] ?? this.currentAgentId
    return chalk.cyan(`[${label}] > `)
  }

  private refreshPrompt(): void {
    this.rl.setPrompt(this.makePrompt())
    this.rl.prompt(true)
  }

  // ====================================================
  // Tab 键切换 Agent (Chat ↔ Builder)
  // ====================================================

  private setupTabSwitching(): void {
    const originalTtyWrite = (this.rl as any)._ttyWrite
    const self = this
    ;(this.rl as any)._ttyWrite = function (char: string, key: any) {
      if (key && key.name === "tab") {
        self.cycleAgent()
        return
      }
      originalTtyWrite.call(this, char, key)
    }
  }

  private cycleAgent(): void {
    this.currentAgentId =
      this.currentAgentId === PRIMARY_AGENTS.chat
        ? PRIMARY_AGENTS.builder
        : PRIMARY_AGENTS.chat
    const label = PRIMARY_AGENT_LABELS[this.currentAgentId]!
    // 清除当前行并重绘
    const rli = this.rl as any
    rli.line = ""
    rli.cursor = 0
    rli.write("")
    printSystemMessage(`Switched to ${label} agent`, "info")
    // 重新显示提示符
    this.rl.setPrompt(this.makePrompt())
    this.rl.prompt(true)
  }

  // ====================================================
  // 启动 REPL
  // ====================================================

  start(): void {
    const label = PRIMARY_AGENT_LABELS[this.currentAgentId]!
    printSystemMessage(`Chat session started. Current agent: ${label} (Tab to switch, /help for commands, /exit to quit)`, "info")
    console.log()

    this.rl.prompt()

    // 串行化处理，防止管道输入竞态
    this.rl.on("line", (line) => {
      this.processing = this.processing.then(() => this.processLine(line.trim()))
    })

    this.rl.on("close", () => {
      process.exit(0)
    })
  }

  // ====================================================
  // 行分发
  // ====================================================

  private async processLine(input: string): Promise<void> {
    if (input === "") {
      this.rl.prompt()
      return
    }

    if (input.startsWith("/")) {
      await this.handleCommand(input.slice(1))
      this.rl.prompt()
      return
    }

    await this.handleMessage(input)
    this.rl.prompt()
  }

  // ====================================================
  // 消息处理（带 Agent 路由）
  // ====================================================

  private async handleMessage(input: string): Promise<void> {
    printUserMessage(input)

    const sessionId = this.sessionId
    const currentAgentId = this.currentAgentId
    const handler = createStreamHandler({ verbose: this.verbose })

    const result = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const agentService = yield* AgentServiceTag
        return yield* agentService.run(sessionId, currentAgentId, input, {
          onChunk: handler.onChunk,
          onToolCall: handler.onToolCall,
          onPhaseChange: handler.onPhaseChange,
          maxIterations: 10
        })
      }).pipe(
        Effect.catchAll((error) => {
          printSystemMessage(`Error: ${(error as any).message || String(error)}`, "error")
          return Effect.succeed(null)
        })
      )
    )

    if (!handler.getContent() && result) {
      console.log()
      printAssistantMessage(result.content)
    }
    console.log()
  }

  // ====================================================
  // 命令处理
  // ====================================================

  private async handleCommand(cmdLine: string): Promise<void> {
    const [cmd, ...args] = cmdLine.split(" ")

    switch (cmd) {
      case "exit":
      case "quit":
        console.log()
        printSystemMessage("Goodbye!", "info")
        this.rl.close()
        break

      case "help":
        console.log()
        console.log(chalk.bold("Commands:"))
        console.log("  Tab              - Switch between Chat and Builder agents")
        console.log("  /agent [chat|builder] - Switch to Chat or Builder (no args = toggle)")
        console.log("  /exit, /quit     - Exit the chat")
        console.log("  /clear           - Clear the screen")
        console.log("  /verbose         - Toggle verbose mode")
        console.log("  /session         - Show current session info")
        console.log()
        console.log(chalk.bold("Agents:"))
        console.log(`  ${chalk.cyan("[Chat]")}    - Planning agent (read files, search code, plan — read-only)`)
        console.log(`  ${chalk.cyan("[Builder]")} - Full development agent (read, write, edit, execute, delegate)`)
        console.log()
        break

      case "clear":
        console.clear()
        printSystemMessage("Screen cleared", "info")
        break

      case "verbose":
        this.verbose = !this.verbose
        printSystemMessage(`Verbose mode: ${this.verbose ? "ON" : "OFF"}`, "info")
        break

      case "session":
        console.log()
        console.log(chalk.bold("Session Info:"))
        console.log(`  ID: ${chalk.cyan(this.sessionId)}`)
        console.log(`  Agent: ${chalk.cyan(PRIMARY_AGENT_LABELS[this.currentAgentId] ?? this.currentAgentId)}`)
        console.log()
        break

      case "agent": {
        if (args.length > 0) {
          const resolved = resolvePrimaryAgent(args[0]!)
          if (!resolved) {
            printSystemMessage(
              `Invalid agent: ${args[0]}. Only "chat" and "builder" are available. Use Tab to toggle.`,
              "warning"
            )
            break
          }
          const oldLabel = PRIMARY_AGENT_LABELS[this.currentAgentId]
          const sessionId = this.sessionId
          try {
            await AppRuntime.runPromise(
              Effect.gen(function* () {
                const agentService = yield* AgentServiceTag
                yield* agentService.setSessionAgent(sessionId, resolved)
              })
            )
            this.currentAgentId = resolved
            this.rl.setPrompt(this.makePrompt())
            const newLabel = PRIMARY_AGENT_LABELS[resolved]
            printSystemMessage(`Switched from ${oldLabel} to ${newLabel}`, "info")
          } catch (e: any) {
            printSystemMessage(`Failed to set agent: ${e.message}`, "error")
          }
        } else {
          // 无参数 = 切换
          this.cycleAgent()
        }
        break
      }

      default:
        printSystemMessage(`Unknown command: ${cmd}. Type /help for available commands.`, "warning")
    }
  }

  // ====================================================
  // 工厂方法
  // ====================================================

  /**
   * 解析会话 ID — 验证已有会话或创建新会话，返回完整 UUID。
   */
  static async resolveSession(sessionId?: string): Promise<string> {
    return AppRuntime.runPromise(
      Effect.gen(function* () {
        if (sessionId) {
          const session = yield* Session
          const existing = yield* session.get(sessionId)
          if (Option.isSome(existing)) {
            return existing.value.id
          }
          printSystemMessage(`Session ${sessionId} not found, creating new...`, "warning")
        }
        const session = yield* Session
        const newSession = yield* session.create({ title: "New Chat" })
        printSystemMessage(`Created new session: ${newSession.id}`, "info")
        return newSession.id
      })
    )
  }

  /**
   * 创建 REPL 实例（自动解析会话 ID）。
   */
  static async create(sessionId?: string, options?: { verbose?: boolean }): Promise<REPL> {
    const resolvedId = await REPL.resolveSession(sessionId)
    return new REPL(resolvedId, options)
  }
}