// src/cli/commands/chat.ts
import { Command } from "commander"
import { Effect } from "effect"
import { AppRuntime } from "../../effect/app-runtime.js"
import { AgentServiceTag } from "../../agent/index.js"
import { MaxIterationsExceededError } from "../../agent/types.js"
import { createStreamHandler, createConfirmHandler, printAssistantMessage, printSystemMessage } from "../output.js"
import { REPL } from "../repl.js"

// ====================================================
// 单次消息模式
// ====================================================

const runChat = (sessionId: string, message: string, verbose: boolean = false) =>
  Effect.gen(function* () {
    const agentService = yield* AgentServiceTag

    const handler = createStreamHandler({ verbose })
    const onRequireConfirm = createConfirmHandler()

    const result = yield* agentService.runAuto(sessionId, message, {
      onChunk: handler.onChunk,
      onToolCall: handler.onToolCall,
      onPhaseChange: handler.onPhaseChange,
      onRequireConfirm,
    })

    if (!handler.getContent()) {
      console.log()
      printAssistantMessage(result.content)
    }
    console.log()

    return result
  })

// ====================================================
// 聊天命令
// ====================================================

export const chatCommand = new Command("chat")
  .description("Start an interactive chat session")
  .option("-s, --session <id>", "Session ID to continue")
  .option("-v, --verbose", "Show detailed tool execution logs")
  .option("-m, --message <text>", "Send a single message and exit (non-interactive)")
  .action(async (options) => {
    const { session: sessionId, verbose, message } = options

    if (message) {
      // 单次消息模式：解析会话 → 执行 → 退出
      const resolvedId = await REPL.resolveSession(sessionId)
      await AppRuntime.runPromise(
        runChat(resolvedId, message, verbose).pipe(
          Effect.catchAll((error) => {
            if (error instanceof MaxIterationsExceededError) {
              printSystemMessage(error.message, "error")
            } else {
              const msg = error instanceof Error ? error.message : String(error)
              printSystemMessage(`Error: ${msg}`, "error")
            }
            return Effect.succeed(null)
          })
        )
      )
      process.exit(0)
    }

    // 交互式模式
    const repl = await REPL.create(sessionId, { verbose })
    repl.start()
  })