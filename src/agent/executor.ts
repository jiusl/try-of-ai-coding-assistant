// src/agent/executor.ts
import { Context, Effect, Layer, Queue, Stream, Fiber, Duration, Cause, Option } from "effect"
import type { Message, StreamChunk, GenerateOptions, GenerateResponse, TokenUsage } from "../provider/types.js"
import type { ToolCall, ToolResult, ToolContext } from "../tool/types.js"
import { Provider } from "../provider/provider.js"
import { Session } from "../session/session.js"
import { ToolRegistry } from "../tool/registry.js"
import { ConfirmationStore } from "../tool/confirmation.js"
import { AgentRegistry } from "./registry.js"
import { SkillRegistry } from "../skill/registry.js"
import { AutoMemory } from "../memory/auto-memory.js"
import { DelegateJSONSchema, DELEGATE_TOOL_NAME, parseDelegateArgs } from "../tool/builtin/delegate.js"
import type { AgentConfig, AgentExecutionOptions, AgentExecutionResult, ExecutionState, ExecutionPhase } from "./types.js"
import { AgentExecutionError, MaxIterationsExceededError, NoToolsAvailableError, AgentTimeoutError } from "./types.js"
import {
  type DelegationChain,
  type SubtaskResult,
  createDelegationChain,
  pushToChain,
  wouldCycle,
  exceedsMaxDepth,
  formatChain,
  generateTaskId,
  type SubtaskArtifact,
} from "./protocol.js"
import { defaultWorkspace, sanitizeWorkspace } from "../infra/workspace.js"
// ====================================================
// 服务接口
// ====================================================

export interface AgentExecutorService {
  /** 执行 Agent（非流式）*/
  readonly execute: (
    agent: AgentConfig,
    options: AgentExecutionOptions
  ) => Effect.Effect<AgentExecutionResult, AgentExecutionError | MaxIterationsExceededError | NoToolsAvailableError | AgentTimeoutError, ConfirmationStore>
  
  /** 执行 Agent（流式，推送执行状态）*/
  readonly executeStream: (
    agent: AgentConfig,
    options: AgentExecutionOptions
  ) => Stream.Stream<ExecutionState, AgentExecutionError | AgentTimeoutError, ConfirmationStore>
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
    const skillRegistry = yield* SkillRegistry
    const autoMemory = yield* AutoMemory

    const DEFAULT_MAX_ITERATIONS = 50
    const DELEGATE_MAX_ITERATIONS = 30
    const MAX_DELEGATION_DEPTH = 3
    
    const executeInternal = (
      agent: AgentConfig,
      options: AgentExecutionOptions,
      stateQueue?: Queue.Queue<ExecutionState>,
      delegationChain?: DelegationChain
    ): Effect.Effect<AgentExecutionResult, AgentExecutionError | MaxIterationsExceededError | NoToolsAvailableError | AgentTimeoutError, ConfirmationStore> => {
      const {
        sessionId,
        userInput,
        onChunk,
        onToolCall,
        onPhaseChange
      } = options
      const maxIterations = options.maxIterations ?? agent.maxIterations ?? DEFAULT_MAX_ITERATIONS
      const rootTaskId = delegationChain?.rootTaskId ?? generateTaskId()
      const chain: DelegationChain = delegationChain ?? createDelegationChain(rootTaskId, rootTaskId, MAX_DELEGATION_DEPTH)
      
      return Effect.gen(function* () {
        const startTime = Date.now()

        // 从 session 读取工作目录，若无则使用默认值
        const sessionInfo = yield* session.get(sessionId)
        const workspaceRoot = Option.match(sessionInfo, {
          onNone: () => defaultWorkspace(),
          onSome: (info) => sanitizeWorkspace(info.workspace || defaultWorkspace()),
        })
        
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
        // 根调用：持久化用户消息到数据库（前端可见）；子Agent委托：不持久化，避免内部任务描述泄露到聊天界面
        const isRootCall = !delegationChain
        if (isRootCall) {
          yield* session.addUserMessage(sessionId, options.displayMessage || userInput)
        }
        
        // 动态合并用户/远程工具：Agent 静态 toolNames 只列内置工具，
        // 用户通过 tools/user/ 目录添加的工具按 Agent 能力自动注入
        const agentCanWrite = agent.capabilities.some(c =>
          c === "code-write" || c === "code-edit" || c === "execute" || c === "build"
        )
        const allRegisteredTools = yield* toolRegistry.list({ enabledOnly: true })
        const dynamicToolNames = allRegisteredTools
          .filter(t => {
            if (agent.toolNames.includes(t.name)) return false               // 已静态声明，跳过
            if (t.sideEffect === "read" || agentCanWrite) return true        // 只读工具所有 Agent 可用；写工具仅写能力 Agent 可用
            return false
          })
          .map(t => t.name)

        const regularToolNames = [
          ...agent.toolNames.filter(n => n !== DELEGATE_TOOL_NAME),
          ...dynamicToolNames,
        ]
        const hasDelegate = agent.toolNames.includes(DELEGATE_TOOL_NAME)

        const toolDefs = regularToolNames.length > 0
          ? yield* toolRegistry.getOpenAIDefinitions(regularToolNames)
          : []

        const allToolDefs = hasDelegate
          ? [...toolDefs, DelegateJSONSchema]
          : toolDefs

        if (regularToolNames.length > 0 && toolDefs.length === 0) {
          return yield* Effect.fail(new NoToolsAvailableError({ agentId: agent.id }))
        }
        
        const buildMessages = (): Effect.Effect<Message[], Error> =>
          Effect.gen(function* () {
            const history = yield* session.getConversationHistory(sessionId)
            // 注入可用 Skill 摘要，让 LLM 首轮即知晓所有 Skill，无需额外往返调用 list_skills
            const skills = yield* skillRegistry.list()
            let skillInfo = ""
            if (skills.length > 0) {
              const skillLines = skills
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => `- ${s.name}: ${s.description} (tags: ${s.tags.join(", ")})`)
              skillInfo = `\n\n<available_skills>\n${skillLines.join("\n")}\n使用 get_skill(\"name\") 获取完整 Skill 文档。调用 list_skills 可查看实时更新的 Skill 列表。\n</available_skills>`
            }
            // 将 workspace 信息注入 system prompt，让 LLM 知道当前工作目录
            const wsInfo = `\n\n<workspace>\n当前工作目录: ${workspaceRoot}\n所有工具默认在此目录下执行。如果需要操作其他目录的文件，请使用绝对路径或指定 cwd 参数。\n</workspace>`
            return [
              { role: "system", content: agent.systemPrompt + skillInfo + wsInfo },
              ...history
            ]
          })
        
        let currentMessages = yield* buildMessages()
        // 子Agent委托：将任务指令注入 LLM 上下文（不写数据库，前端不可见）
        if (!isRootCall) {
          currentMessages = [...currentMessages, { role: "user", content: userInput }]
        }
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
          
          // ===== 流式优先 + generate 保底 =====
          const buildLLMOptions = (): GenerateOptions => ({
            ...(options.provider !== undefined ? { provider: options.provider as any } : {}),
            ...(options.model !== undefined ? { model: options.model } : {}),
            ...(agent.model !== undefined ? { model: agent.model } : {}),
            ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
            ...(agent.maxTokens !== undefined ? { maxTokens: agent.maxTokens } : {}),
            ...(allToolDefs.length > 0 ? { tools: allToolDefs as any } : {}),
          })

          const llmResponse = yield* (provider.stream(currentMessages, buildLLMOptions()) as Stream.Stream<StreamChunk, Error>).pipe(
            // 副作用：逐 token 推送前端
            Stream.tap((chunk: StreamChunk) => Effect.sync(() => {
              if (chunk.type === "content") onChunk?.(chunk.content ?? "")
            })),
            Stream.timeout(Duration.seconds(90)),
            // 聚合成完整结果
            Stream.runFold(
              {
                content: "",
                toolCalls: [] as ToolCall[],
                warning: undefined as string | undefined,
                usage: undefined as TokenUsage | undefined,
                streamError: undefined as string | undefined,
              },
              (acc, chunk: StreamChunk) => {
                switch (chunk.type) {
                  case "content":
                    acc.content += (chunk.content ?? "")
                    return acc
                  case "tool_call":
                    if (chunk.tool_call) acc.toolCalls.push(chunk.tool_call)
                    return acc
                  case "warning":
                    acc.warning = chunk.content
                    return acc
                  case "done":
                    acc.usage = chunk.usage
                    return acc
                  case "error":
                    acc.streamError = chunk.error?.message ?? "Stream error"
                    return acc
                  default:
                    return acc
                }
              }
            ),
            // 健康检查：内容为空且无 tool_calls 且无 stream error → 视为 stream 失败
            Effect.flatMap((result) =>
              (!result.content && result.toolCalls.length === 0 && !result.streamError)
                ? Effect.fail(new Error("LLM stream 返回空内容"))
                : Effect.succeed(result)
            ),
            // 降级：任何失败都回退到 generate() 保底
            Effect.catchAll((err) => {
              const streamErrMsg = err instanceof Error ? err.message : String(err)
              console.warn(`[Executor] 流式调用失败，降级为 generate() 保底: ${streamErrMsg}`)
              return (provider.generate(currentMessages, buildLLMOptions()) as Effect.Effect<GenerateResponse, Error>).pipe(
                Effect.timeout(Duration.seconds(60)),
                Effect.catchTag("TimeoutException", () =>
                  Effect.fail(new AgentTimeoutError({
                    agentId: agent.id,
                    operation: "LLM API 调用（降级）",
                    timeoutSeconds: 60,
                  }))
                ),
                Effect.map((resp) => {
                  // 保底模式：一次性推送全文
                  if (onChunk && resp.content) {
                    onChunk(resp.content)
                  }
                  return {
                    content: resp.content,
                    toolCalls: (resp.tool_calls as ToolCall[] | undefined) ?? [],
                    warning: resp.warning,
                    usage: resp.usage,
                    streamError: undefined,
                  }
                })
              )
            })
          )

          // 捕获首轮 provider 路由警告
          if (llmResponse.warning && !executionWarning) {
            executionWarning = llmResponse.warning
            yield* setPhase("thinking", { iteration: iterations, warning: llmResponse.warning })
          }
          
          if (llmResponse.usage) {
            totalTokens.promptTokens += llmResponse.usage.promptTokens
            totalTokens.completionTokens += llmResponse.usage.completionTokens
            totalTokens.totalTokens += llmResponse.usage.totalTokens
          }
          
          const toolCalls = llmResponse.toolCalls.length > 0 ? llmResponse.toolCalls : undefined
          
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
                const results = yield* toolRegistry.executeBatch(approvedCalls, toolContext).pipe(
                  Effect.timeout(Duration.seconds(60)),
                  Effect.catchTag("TimeoutException", () =>
                    Effect.fail(new AgentTimeoutError({
                      agentId: agent.id,
                      operation: `工具执行 (${approvedCalls.map(c => c.function.name).join(", ")})`,
                      timeoutSeconds: 60,
                    }))
                  )
                )
                for (let i = 0; i < approvedCalls.length; i++) {
                  resultMap.set(approvedCalls[i]!.id, results[i]!)
                }
              }
            }
            
            // 执行 delegate 调用（递归运行子 Agent，使用结构化委托协议）
            for (const dc of delegateCalls) {
              const dcStartTime = Date.now()
              const subTaskId = generateTaskId()
              let dcIterations = 0
              let dcToolCount = 0
              let capturedAgentId = "?"
              try {
                const delegateArgs = parseDelegateArgs(dc.function.arguments)
                const { agentId, task } = delegateArgs
                capturedAgentId = agentId
                
                // 去重检测：防止循环委派（使用 protocol.ts 工具函数）
                if (wouldCycle(chain, agentId)) {
                  const loop = formatChain(pushToChain(chain, agentId))
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
                if (exceedsMaxDepth(chain)) {
                  resultMap.set(dc.id, {
                    tool_call_id: dc.id,
                    role: "tool" as const,
                    content: `Delegate BLOCKED: maximum delegation depth (${chain.maxDepth}) reached at ${formatChain(chain)}. Complete the remaining work yourself.`,
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
                    content: `🤝 Delegating to ${agentId} (task: ${subTaskId})...`,
                    iteration: iterations,
                  })
                }
                
                // 构建结构化任务描述（含上下文注入）
                let structuredTask = `[Task ID: ${subTaskId}]\n\n${task}`
                if (delegateArgs.context) {
                  if (delegateArgs.context.file_paths && delegateArgs.context.file_paths.length > 0) {
                    structuredTask += `\n\n## Relevant Files\n${delegateArgs.context.file_paths.map((f: string) => `- ${f}`).join("\n")}`
                  }
                  if (delegateArgs.context.notes) {
                    structuredTask += `\n\n## Additional Notes\n${delegateArgs.context.notes}`
                  }
                  if (delegateArgs.context.preconditions && delegateArgs.context.preconditions.length > 0) {
                    structuredTask += `\n\n## Preconditions\n${delegateArgs.context.preconditions.map((p: string) => `- [ ] ${p}`).join("\n")}`
                  }
                }
                if (delegateArgs.expected_output) {
                  structuredTask += `\n\n## Expected Output Format\n${delegateArgs.expected_output}`
                }
                if (delegateArgs.priority) {
                  structuredTask += `\n\n## Priority\n${delegateArgs.priority.toUpperCase()}`
                }
                
                // 构建子调用链（当前链 push 当前 agent）
                const subChain = pushToChain(chain, agent.id)
                
                const subResult = yield* executeInternal(targetAgent, {
                  sessionId,
                  userInput: structuredTask,
                  maxIterations: DELEGATE_MAX_ITERATIONS,
                  ...(onChunk !== undefined ? { onChunk } : {}),
                  ...(onToolCall !== undefined ? { onToolCall } : {}),
                  ...(onPhaseChange !== undefined ? { onPhaseChange } : {}),
                }, stateQueue, subChain)
                
                dcIterations = subResult.iterations
                dcToolCount = subResult.toolCalls.length
                
                // 格式化结构化委托结果
                const artifacts: SubtaskArtifact[] = (subResult.artifacts ?? []).map((a: any) => ({
                  type: a.type ?? "report",
                  path: a.path ?? "",
                  summary: a.summary ?? "",
                }))
                const subtaskResult: SubtaskResult = {
                  taskId: subTaskId,
                  status: subResult.success ? "success" : "failure",
                  content: subResult.content,
                  artifacts,
                  iterations: dcIterations,
                  toolCallCount: dcToolCount,
                  durationMs: Date.now() - dcStartTime,
                  ...(subResult.warning ? { error: subResult.warning } : {}),
                  ...(subResult.followUpSuggestions ? { followUpSuggestions: subResult.followUpSuggestions } : {}),
                }
                
                const resultSummary = [
                  `## Sub-task Result`,
                  `- **Agent**: ${agentId}`,
                  `- **Task ID**: ${subTaskId}`,
                  `- **Status**: ${subtaskResult.status}`,
                  `- **Iterations**: ${dcIterations}`,
                  `- **Tool Calls**: ${dcToolCount}`,
                  `- **Duration**: ${subtaskResult.durationMs}ms`,
                  ...(artifacts.length > 0 ? [`- **Artifacts**: ${artifacts.map(a => a.path).join(", ")}`] : []),
                  `\n---\n`,
                  subResult.content,
                ].join("\n")
                
                resultMap.set(dc.id, {
                  tool_call_id: dc.id,
                  role: "tool" as const,
                  content: resultSummary,
                  success: true,
                })
              } catch (e: any) {
                const errMsg = e instanceof Error ? e.message : String(e)
                console.error(`[Executor] Delegate 到 ${capturedAgentId} 执行失败:`, errMsg)
                resultMap.set(dc.id, {
                  tool_call_id: dc.id,
                  role: "tool" as const,
                  content: `Delegate 到 "${capturedAgentId}" 执行失败 (${Date.now() - dcStartTime}ms): ${errMsg}`,
                  success: false,
                  error: errMsg,
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
              content: llmResponse.content,
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
            finalContent = llmResponse.content ?? ""
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
          const error = new MaxIterationsExceededError({ maxIterations })
          yield* setPhase("error", {
            iteration: iterations,
            error: error.message,
            content: `已执行 ${iterations} 轮，仍未完成。部分进度已保存，可以发送"继续"来恢复执行。`,
          })
          return yield* Effect.fail(error)
        }
        
        yield* setPhase("done", { iteration: iterations, content: finalContent })
        
        // 方案C：自动从对话中提取长期记忆（fork 不阻塞，避免延迟发送 done 事件）
        yield* Effect.fork(autoMemory.extract(userInput, finalContent, sessionId).pipe(
          Effect.catchAll(() => Effect.succeed({ extracted: 0, memories: [] }))
        ))
        
        const result: AgentExecutionResult = {
          content: finalContent,
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          iterations,
          durationMs: Date.now() - startTime,
          tokensUsed: totalTokens,
          success: true,
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
          if (err instanceof AgentTimeoutError) return err
          const message = err instanceof Error ? err.message : String(err)
          return new AgentExecutionError({ agentId: agent.id, message })
        })
      )
    }
    
    const execute = (
      agent: AgentConfig,
      options: AgentExecutionOptions
    ): Effect.Effect<AgentExecutionResult, AgentExecutionError | MaxIterationsExceededError | NoToolsAvailableError | AgentTimeoutError, ConfirmationStore> =>
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