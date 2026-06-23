// src/agent/executor.ts
import { Context, Effect, Layer, Queue, Stream, Fiber } from "effect"
import type { Message } from "../provider/types.js"
import type { ToolCall, ToolResult, ToolContext } from "../tool/types.js"
import { Provider } from "../provider/provider.js"
import { Session } from "../session/session.js"
import { ToolRegistry } from "../tool/registry.js"
import { ConfirmationStore } from "../tool/confirmation.js"
import { AgentRegistry } from "./registry.js"
import { AutoMemory } from "../memory/auto-memory.js"
import { DelegateJSONSchema, DELEGATE_TOOL_NAME, parseDelegateArgs } from "../tool/builtin/delegate.js"
import type { AgentConfig, AgentExecutionOptions, AgentExecutionResult, ExecutionState, ExecutionPhase } from "./types.js"
import { AgentExecutionError, MaxIterationsExceededError, NoToolsAvailableError } from "./types.js"
// ====================================================
// 服务接口
// ====================================================

export interface AgentExecutorService {
  /** 执行 Agent（非流式）*/
  readonly execute: (
    agent: AgentConfig,
    options: AgentExecutionOptions
  ) => Effect.Effect<AgentExecutionResult, AgentExecutionError | MaxIterationsExceededError | NoToolsAvailableError, ConfirmationStore>
  
  /** 执行 Agent（流式，推送执行状态）*/
  readonly executeStream: (
    agent: AgentConfig,
    options: AgentExecutionOptions
  ) => Stream.Stream<ExecutionState, AgentExecutionError | MaxIterationsExceededError, ConfirmationStore>
}

export class AgentExecutor extends Context.Tag("AgentExecutor")<
  AgentExecutor,
  AgentExecutorService
>() {}

// ====================================================
// 辅助函数
// ====================================================

/** 构建工具上下文 */
const buildToolContext = (sessionId: string, workspaceRoot: string): ToolContext => ({
  sessionId,
  workspaceRoot,
  isInteractive: false,
})

/** 将工具调用转换为消息格式（用于发送给 API）*/
const toolCallsToMessages = (
  toolCalls: ToolCall[],
  toolResults: ToolResult[]
): Message[] => {
  const messages: Message[] = []
  
  // 添加 assistant 消息（包含 tool_calls 数组）
  if (toolCalls.length > 0) {
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: toolCalls,
    } as Message)
  }
  
  // 添加 tool 响应消息
  for (const result of toolResults) {
    messages.push({
      role: "tool",
      content: result.content,
      tool_call_id: result.tool_call_id,
    })
  }
  
  return messages
}

// ====================================================
// Live Layer
// ====================================================

export const AgentExecutorLive = Layer.effect(
  AgentExecutor,
  Effect.gen(function* () {
    const provider = yield* Provider
    const session = yield* Session
    const toolRegistry = yield* ToolRegistry
    const agentRegistry = yield* AgentRegistry
    const autoMemory = yield* AutoMemory

    const DEFAULT_MAX_ITERATIONS = 50
    const DELEGATE_MAX_ITERATIONS = 30
    const MAX_DELEGATION_DEPTH = 3
    
    const executeInternal = (
      agent: AgentConfig,
      options: AgentExecutionOptions,
      stateQueue?: Queue.Queue<ExecutionState>,
      delegationChain?: Set<string>
    ): Effect.Effect<AgentExecutionResult, AgentExecutionError | MaxIterationsExceededError | NoToolsAvailableError, ConfirmationStore> => {
      const {
        sessionId,
        userInput,
        onChunk,
        onToolCall,
        onPhaseChange
      } = options
      const maxIterations = options.maxIterations ?? agent.maxIterations ?? DEFAULT_MAX_ITERATIONS
      const chain = delegationChain ?? new Set<string>()
      
      return Effect.gen(function* () {
        const startTime = Date.now()
        const workspaceRoot = process.cwd()
        
        const setPhase = (phase: ExecutionPhase, extra?: Partial<ExecutionState>) =>
          Effect.gen(function* () {
            const state: ExecutionState = {
              phase,
              content: "",
              iteration: extra?.iteration ?? 0,
              ...extra,
            }
            onPhaseChange?.(state)
            if (stateQueue) {
              yield* Queue.offer(stateQueue, state)
            }
          })
        
        yield* setPhase("initializing")
        yield* session.addUserMessage(sessionId, userInput)
        
        const regularToolNames = agent.toolNames.filter(n => n !== DELEGATE_TOOL_NAME)
        const hasDelegate = agent.toolNames.includes(DELEGATE_TOOL_NAME)
        
        const toolDefs = regularToolNames.length > 0
          ? yield* toolRegistry.getOpenAIDefinitions(regularToolNames)
          : []
        
        const allToolDefs = hasDelegate
          ? [...toolDefs, DelegateJSONSchema]
          : toolDefs
        
        if (agent.toolNames.length > 0 && allToolDefs.length === 0) {
          return yield* Effect.fail(new NoToolsAvailableError({ agentId: agent.id }))
        }
        
        const buildMessages = (): Effect.Effect<Message[], Error> =>
          Effect.gen(function* () {
            const history = yield* session.getConversationHistory(sessionId)
            return [
              { role: "system", content: agent.systemPrompt },
              ...history
            ]
          })
        
        let currentMessages = yield* buildMessages()
        const initialMessageCount = currentMessages.length  // 追踪初始消息数，用于超限时持久化增量
        let iterations = 0
        let executionWarning: string | undefined = undefined  // 捕获 provider 路由警告
        const allToolCalls: ToolCall[] = []
        const allToolResults: ToolResult[] = []
        let finalContent = ""
        const totalTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        
        while (iterations < maxIterations) {
          iterations++
          yield* setPhase("thinking", { iteration: iterations })
          
          const response = yield* (provider.generate(currentMessages, {
            ...(options.provider !== undefined ? { provider: options.provider as any } : {}),
            ...(options.model !== undefined ? { model: options.model } : {}),
            ...(agent.model !== undefined ? { model: agent.model } : {}),
            ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
            ...(agent.maxTokens !== undefined ? { maxTokens: agent.maxTokens } : {}),
            ...(allToolDefs.length > 0 ? { tools: allToolDefs as any } : {}),
          }) as Effect.Effect<any, Error>)

          // 捕获首轮 provider 路由警告
          if (response.warning && !executionWarning) {
            executionWarning = response.warning
            yield* setPhase("thinking", { iteration: iterations, warning: response.warning })
          }
          
          if (response.usage) {
            totalTokens.promptTokens += response.usage.promptTokens
            totalTokens.completionTokens += response.usage.completionTokens
            totalTokens.totalTokens += response.usage.totalTokens
          }
          
          if (onChunk && response.content) {
            onChunk(response.content)
          }
          
          const toolCalls = response.tool_calls as ToolCall[] | undefined
          
          if (toolCalls && toolCalls.length > 0) {
            const firstCall = toolCalls[0]!
            yield* setPhase("calling_tool", {
              iteration: iterations,
              currentTool: firstCall.function.name,
              currentToolCall: firstCall,
            })
            
            // 分离 delegate 调用和普通工具调用
            const delegateCalls = toolCalls.filter(tc => tc.function.name === DELEGATE_TOOL_NAME)
            const regularCalls = toolCalls.filter(tc => tc.function.name !== DELEGATE_TOOL_NAME)
            
            // 保持原始顺序的结果映射 (tool_call_id → ToolResult)
            const resultMap = new Map<string, ToolResult>()
            
            // 执行普通工具调用
            if (regularCalls.length > 0) {
              const toolContext = buildToolContext(sessionId, workspaceRoot)

              // --- 敏感度确认 ---
              // 获取所有涉及工具的敏感度，筛选需要确认的
              let approvedCalls = regularCalls
              const highSensitivityCalls: ToolCall[] = []

              for (const tc of regularCalls) {
                const toolResult = yield* Effect.either(toolRegistry.get(tc.function.name))
                if (toolResult._tag === "Right") {
                  const tool = toolResult.right
                  if (tool.sensitivity === "high" || tool.sensitivity === "critical") {
                    highSensitivityCalls.push(tc)
                  }
                }
              }

              if (highSensitivityCalls.length > 0) {
                const confirmationStore = yield* ConfirmationStore

                // 进入等待确认阶段，让前端显示更清晰的状态
                yield* setPhase("awaiting_confirmation", {
                  iteration: iterations,
                  currentTool: highSensitivityCalls[0]!.function.name,
                })

                // 逐个确认（同一会话同时只有一个确认）
                for (const tc of highSensitivityCalls) {
                  let argsPreview = ""
                  try { argsPreview = tc.function.arguments.slice(0, 200) } catch { /* ignore */ }

                  const reason = tc.function.name === "run_command"
                    ? `执行命令: ${argsPreview}`
                    : `工具 "${tc.function.name}" 需要用户确认才能执行`

                  const confirmReq = {
                    sessionId,
                    toolCallId: tc.id,
                    toolName: tc.function.name,
                    target: argsPreview,
                    arguments: argsPreview,
                    sensitivity: tc.function.name === "run_command" ? "high" : "high",
                    reason,
                  }

                  // 通知前端显示确认对话框
                  options.onRequireConfirm?.(confirmReq)

                  // 阻塞等待用户决定
                  const approved = yield* confirmationStore.request(confirmReq)

                  if (!approved) {
                    // 用户拒绝 → 从执行列表中移除
                    approvedCalls = approvedCalls.filter(c => c.id !== tc.id)
                    // 生成拒绝结果
                    resultMap.set(tc.id, {
                      tool_call_id: tc.id,
                      role: "tool" as const,
                      content: `用户拒绝执行工具 "${tc.function.name}"`,
                      success: false,
                      error: "用户拒绝执行",
                    })
                  }
                }
              }

              // 执行已批准的工具
              if (approvedCalls.length > 0) {
                const results = yield* toolRegistry.executeBatch(approvedCalls, toolContext)
                for (let i = 0; i < approvedCalls.length; i++) {
                  resultMap.set(approvedCalls[i]!.id, results[i]!)
                }
              }
            }
            
            // 执行 delegate 调用（递归运行子 Agent，带去重检测）
            for (const dc of delegateCalls) {
              try {
                const { agentId, task } = parseDelegateArgs(dc.function.arguments)
                
                // 去重检测：防止循环委派
                if (chain.has(agentId)) {
                  const loop = [...chain, agentId].join(" → ")
                  resultMap.set(dc.id, {
                    tool_call_id: dc.id,
                    role: "tool" as const,
                    content: `Delegate BLOCKED: circular delegation detected (${loop}). Do NOT delegate to an agent already in the call chain. Try another approach or complete the task yourself.`,
                    success: false,
                    error: `Circular delegation: ${loop}`,
                  })
                  continue
                }
                
                // 深度限制
                if (chain.size >= MAX_DELEGATION_DEPTH) {
                  resultMap.set(dc.id, {
                    tool_call_id: dc.id,
                    role: "tool" as const,
                    content: `Delegate BLOCKED: maximum delegation depth (${MAX_DELEGATION_DEPTH}) reached. Complete the remaining work yourself.`,
                    success: false,
                    error: "Max delegation depth exceeded",
                  })
                  continue
                }
                
                const targetAgent = yield* agentRegistry.get(agentId)
                
                yield* setPhase("calling_tool", {
                  iteration: iterations,
                  currentTool: `delegate→${agentId}`,
                  currentToolCall: dc,
                })
                
                if (stateQueue) {
                  yield* Queue.offer(stateQueue, {
                    phase: "processing" as const,
                    content: `🤝 Delegating to ${agentId}...`,
                    iteration: iterations,
                  })
                }
                
                // 构建子调用链（当前链 + 当前 agent）
                const subChain = new Set(chain)
                subChain.add(agent.id)
                
                const subResult = yield* executeInternal(targetAgent, {
                  sessionId,
                  userInput: task,
                  maxIterations: DELEGATE_MAX_ITERATIONS,
                  ...(onChunk !== undefined ? { onChunk } : {}),
                  ...(onToolCall !== undefined ? { onToolCall } : {}),
                  ...(onPhaseChange !== undefined ? { onPhaseChange } : {}),
                }, stateQueue, subChain)
                
                resultMap.set(dc.id, {
                  tool_call_id: dc.id,
                  role: "tool" as const,
                  content: `[Delegated to ${agentId}]\n${subResult.content}`,
                  success: true,
                })
              } catch (e: any) {
                resultMap.set(dc.id, {
                  tool_call_id: dc.id,
                  role: "tool" as const,
                  content: `Delegate failed: ${e.message || String(e)}`,
                  success: false,
                  error: e.message || String(e),
                })
              }
            }
            
            // 按原始 toolCalls 顺序组装结果
            const orderedResults: ToolResult[] = []
            for (const tc of toolCalls) {
              const result = resultMap.get(tc.id)
              if (result) {
                orderedResults.push(result)
                allToolCalls.push(tc)
                allToolResults.push(result)
                onToolCall?.(tc, result)
                if (stateQueue) {
                  yield* Queue.offer(stateQueue, {
                    phase: "calling_tool" as const,
                    content: result.content,
                    iteration: iterations,
                    currentTool: tc.function.name,
                    currentToolCall: tc,
                    ...(result.error ? { error: result.error } : {}),
                  })
                }
              }
            }
            
            // 将工具调用+结果追加到消息列表
            currentMessages.push({
              role: "assistant",
              content: response.content,
              tool_calls: toolCalls,
            } as Message)
            for (const result of orderedResults) {
              currentMessages.push({
                role: "tool",
                content: result.content,
                tool_call_id: result.tool_call_id,
              })
            }
            
          } else {
            finalContent = response.content ?? ""
            yield* session.addAssistantMessage(sessionId, finalContent)
            break
          }
        }
        
        if (iterations >= maxIterations && !finalContent) {
          // 将本轮新增的消息持久化到 session，以便用户可以在下一轮继续
          for (let i = initialMessageCount; i < currentMessages.length; i++) {
            const msg = currentMessages[i]!
            if (msg.role === "assistant") {
              if (msg.tool_calls && msg.tool_calls.length > 0) {
                yield* session.addAssistantMessageWithToolCalls(sessionId, msg.content, msg.tool_calls)
              } else {
                yield* session.addAssistantMessage(sessionId, msg.content ?? "")
              }
            } else if (msg.role === "tool" && msg.tool_call_id) {
              yield* session.addToolMessage(sessionId, msg.tool_call_id, msg.content ?? "")
            }
          }
          return yield* Effect.fail(new MaxIterationsExceededError({ maxIterations }))
        }
        
        yield* setPhase("done", { iteration: iterations, content: finalContent })
        
        // 方案C：自动从对话中提取长期记忆
        yield* autoMemory.extract(userInput, finalContent, sessionId).pipe(
          Effect.catchAll(() => Effect.succeed({ extracted: 0, memories: [] }))
        )
        
        const result: AgentExecutionResult = {
          content: finalContent,
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          iterations,
          durationMs: Date.now() - startTime,
          tokensUsed: totalTokens,
        }
        if (executionWarning !== undefined) {
          result.warning = executionWarning
        }
        return result
      }).pipe(
        Effect.mapError((err: unknown) => {
          if (err instanceof AgentExecutionError) return err
          if (err instanceof MaxIterationsExceededError) return err
          if (err instanceof NoToolsAvailableError) return err
          const message = err instanceof Error ? err.message : String(err)
          return new AgentExecutionError({ agentId: agent.id, message })
        })
      )
    }
    
    const execute = (
      agent: AgentConfig,
      options: AgentExecutionOptions
    ): Effect.Effect<AgentExecutionResult, AgentExecutionError | MaxIterationsExceededError | NoToolsAvailableError, ConfirmationStore> =>
      executeInternal(agent, options)
    
    const executeStream = (
      agent: AgentConfig,
      options: AgentExecutionOptions
    ): Stream.Stream<ExecutionState, AgentExecutionError> => {
      const createStream = Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ExecutionState>()
        const fiber = yield* Effect.fork(
          executeInternal(agent, options, queue)
        )
        
        // Read states from queue, emit via Stream
        const readStates = (): Stream.Stream<ExecutionState> =>
          Stream.fromQueue(queue).pipe(
            Stream.takeWhile((state: ExecutionState) =>
              state.phase !== "done" && state.phase !== "error"
            ),
            Stream.concat(
              Stream.fromEffect(
                Queue.take(queue).pipe(
                  Effect.tap((finalState: ExecutionState) =>
                    Effect.fork(Fiber.interrupt(fiber))
                  )
                )
              )
            )
          )
        
        return readStates()
      })
      
      return Stream.unwrap(createStream).pipe(
        Stream.mapError((err: unknown) => {
          if (err instanceof AgentExecutionError) return err
          const message = err instanceof Error ? err.message : String(err)
          return new AgentExecutionError({ agentId: agent.id, message })
        })
      ) as Stream.Stream<ExecutionState, AgentExecutionError>
    }
    
    return {
      execute,
      executeStream
    }
  })
)