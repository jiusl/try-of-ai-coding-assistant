// src/cli/commands/run.ts
import { Command } from "commander"
import { Effect, Option } from "effect"
import { AppRuntime } from "../../effect/app-runtime.js"
import { AgentServiceTag } from "../../agent/index.js"
import { MaxIterationsExceededError } from "../../agent/types.js"
import { Session } from "../../session/session.js"
import { createStreamHandler, createConfirmHandler, printSystemMessage, printAssistantMessage, printTitle } from "../output.js"

// ====================================================
// 运行 Agent
// ====================================================

const runAgent = (
  agentId: string,
  sessionId: string,
  input: string,
  verbose: boolean = false,
  maxIterations?: number
) =>
  Effect.gen(function* () {
    const agentService = yield* AgentServiceTag
    
    const handler = createStreamHandler({ verbose })
    const onRequireConfirm = createConfirmHandler()
    
    const opts: any = {
      onChunk: handler.onChunk,
      onToolCall: handler.onToolCall,
      onPhaseChange: handler.onPhaseChange,
      onRequireConfirm,
    }
    if (maxIterations !== undefined) {
      opts.maxIterations = maxIterations
    }
    const result = yield* agentService.run(sessionId, agentId, input, opts)
    
    if (!handler.getContent()) {
      console.log()
      printAssistantMessage(result.content)
    }
    console.log()
    
    // 打印统计信息
    if (verbose) {
      console.log()
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  Duration: ${result.durationMs}ms`)
      console.log(`  Tokens: ${result.tokensUsed.totalTokens} (prompt: ${result.tokensUsed.promptTokens}, completion: ${result.tokensUsed.completionTokens})`)
      console.log()
    }
    
    return result
  })

// ====================================================
// 获取或创建会话
// ====================================================

const getOrCreateSession = (sessionId?: string) =>
  Effect.gen(function* () {
    if (sessionId) {
      const session = yield* Session
      const existing = yield* session.get(sessionId)
      if (Option.isSome(existing)) {
        return existing.value.id
      }
    }
    const session = yield* Session
    const newSession = yield* session.create()
    printSystemMessage(`Created new session: ${newSession.id}`, "info")
    return newSession.id
  })

// ====================================================
// 运行命令
// ====================================================

export const runCommand = new Command("run")
  .description("Run an agent with the given input")
  .argument("<input>", "The input/prompt to send to the agent")
  .option("-a, --agent <id>", "Agent ID to use (default: auto-select)")
  .option("-s, --session <id>", "Session ID to continue")
  .option("-v, --verbose", "Show detailed tool execution logs")
  .option("-i, --max-iterations <number>", "Maximum tool call iterations", parseInt)
  .action(async (input, options) => {
    const { agent: agentId, session: sessionId, verbose, maxIterations } = options
    
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const finalSessionId = yield* getOrCreateSession(sessionId)
        
        printSystemMessage(`Running with input: "${input.slice(0, 100)}${input.length > 100 ? "..." : ""}"`, "info")
        
        let result: any
        if (agentId) {
          printSystemMessage(`Using agent: ${agentId}`, "info")
          result = yield* runAgent(agentId, finalSessionId, input, verbose, maxIterations)
        } else {
          printSystemMessage("Auto-selecting agent...", "info")
          const agentService = yield* AgentServiceTag
          const handler = createStreamHandler({ verbose })
          const onRequireConfirm = createConfirmHandler()
          const opts: any = { onChunk: handler.onChunk, onToolCall: handler.onToolCall, onPhaseChange: handler.onPhaseChange, onRequireConfirm }
          if (maxIterations !== undefined) opts.maxIterations = maxIterations
          result = yield* agentService.runAuto(finalSessionId, input, opts)
        }
        
        return result
      }).pipe(
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
  })