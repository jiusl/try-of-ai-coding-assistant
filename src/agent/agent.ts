// src/agent/agent.ts
import { Context, Effect, Layer, Ref, Option, Stream, Fiber } from "effect"
import type { AgentConfig, AgentExecutionOptions, AgentExecutionResult, ExecutionState } from "./types.js"
import { AgentNotFoundError, AgentExecutionError, MaxIterationsExceededError } from "./types.js"
import { AgentRegistry } from "./registry.js"
import { AgentExecutor } from "./executor.js"
import { Session } from "../session/session.js"

// ====================================================
// 服务接口
// ====================================================

export interface AgentService {
  /** 运行 Agent（非流式）*/
  readonly run: (
    sessionId: string,
    agentId: string,
    userInput: string,
    options?: Partial<Omit<AgentExecutionOptions, "sessionId" | "userInput">>
  ) => Effect.Effect<AgentExecutionResult, AgentExecutionError | AgentNotFoundError | MaxIterationsExceededError>
  
  /** 运行 Agent（流式）*/
  readonly runStream: (
    sessionId: string,
    agentId: string,
    userInput: string,
    options?: Partial<Omit<AgentExecutionOptions, "sessionId" | "userInput">>
  ) => Stream.Stream<ExecutionState, AgentExecutionError | AgentNotFoundError | MaxIterationsExceededError>
  
  /** 列出所有 Agent */
  readonly listAgents: () => Effect.Effect<AgentConfig[]>
  
  /** 获取 Agent */
  readonly getAgent: (agentId: string) => Effect.Effect<AgentConfig, AgentNotFoundError>
  
  /** 获取当前会话绑定的 Agent */
  readonly getCurrentAgent: (sessionId: string) => Effect.Effect<Option.Option<AgentConfig>>
  
  /** 设置会话绑定的 Agent */
  readonly setSessionAgent: (sessionId: string, agentId: string) => Effect.Effect<void>
  
  /** 根据消息自动选择 Agent 并运行 */
  readonly runAuto: (
    sessionId: string,
    userInput: string,
    options?: Partial<Omit<AgentExecutionOptions, "sessionId" | "userInput">>
  ) => Effect.Effect<AgentExecutionResult, AgentExecutionError | MaxIterationsExceededError>
}

export class AgentServiceTag extends Context.Tag("AgentService")<
  AgentServiceTag,
  AgentService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const AgentServiceLive = Layer.effect(
  AgentServiceTag,
  Effect.gen(function* () {
    const registry = yield* AgentRegistry
    const executor = yield* AgentExecutor
    const session = yield* Session
    
    // 会话绑定的 Agent（key: sessionId, value: agentId）
    const sessionAgents = yield* Ref.make<Map<string, string>>(new Map())
    
    const makeOptions = (
      sessionId: string,
      userInput: string,
      options?: Partial<Omit<AgentExecutionOptions, "sessionId" | "userInput">>
    ): AgentExecutionOptions => ({
      sessionId,
      userInput,
      ...(options?.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
      ...(options?.model !== undefined ? { model: options.model } : {}),
      ...(options?.onChunk ? { onChunk: options.onChunk } : {}),
      ...(options?.onToolCall ? { onToolCall: options.onToolCall } : {}),
      ...(options?.onPhaseChange ? { onPhaseChange: options.onPhaseChange } : {}),
      ...(options?.onRequireConfirm ? { onRequireConfirm: options.onRequireConfirm } : {}),
    })
    
    const run = (
      sessionId: string,
      agentId: string,
      userInput: string,
      options?: Partial<Omit<AgentExecutionOptions, "sessionId" | "userInput">>
    ) =>
      Effect.gen(function* () {
        const agent = yield* registry.get(agentId)
        const executionOptions = makeOptions(sessionId, userInput, options)
        const result = yield* executor.execute(agent, executionOptions)
        yield* Ref.update(sessionAgents, map => map.set(sessionId, agentId))
        return result
      })
    
    const runStream = (
      sessionId: string,
      agentId: string,
      userInput: string,
      options?: Partial<Omit<AgentExecutionOptions, "sessionId" | "userInput">>
    ) =>
      Effect.gen(function* () {
        const agent = yield* registry.get(agentId)
        const executionOptions = makeOptions(sessionId, userInput, options)
        yield* Ref.update(sessionAgents, map => map.set(sessionId, agentId))
        return executor.executeStream(agent, executionOptions)
      }).pipe(Stream.unwrap)
    
    const listAgents = () => registry.list({ enabledOnly: true })
    
    const getAgent = (agentId: string) => registry.get(agentId)
    
    const getCurrentAgent = (sessionId: string) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(sessionAgents)
        const agentId = map.get(sessionId)
        if (!agentId) return Option.none<AgentConfig>()
        const agent = yield* Effect.either(registry.get(agentId))
        if (agent._tag === "Left") return Option.none<AgentConfig>()
        return Option.some(agent.right)
      })
    
    const setSessionAgent = (sessionId: string, agentId: string) =>
      Effect.gen(function* () {
        yield* registry.get(agentId) // 确保 Agent 存在
        yield* Ref.update(sessionAgents, map => map.set(sessionId, agentId))
      })
    
    const runAuto = (
      sessionId: string,
      userInput: string,
      options?: Partial<Omit<AgentExecutionOptions, "sessionId" | "userInput">>
    ) =>
      Effect.gen(function* () {
        let agent: AgentConfig

        // 优先使用请求中显式指定的 agentId
        if (options?.agentId) {
          agent = yield* registry.get(options.agentId)
          yield* Ref.update(sessionAgents, map => map.set(sessionId, agent.id))
        } else {
          // 其次使用会话绑定的 Agent（需验证仍然可用）
          const currentAgentOpt = yield* getCurrentAgent(sessionId)

          if (Option.isSome(currentAgentOpt) && currentAgentOpt.value.enabled !== false) {
            agent = currentAgentOpt.value
          } else {
            // 自动选择：按能力匹配，或回退到第一个启用的 Agent
            const enabledAgents = yield* registry.list({ enabledOnly: true })
            if (enabledAgents.length === 0) {
              return yield* Effect.fail(
                new AgentNotFoundError({ agentId: "(no enabled agent)" })
              )
            }

            // 简单启发式：优先匹配有 "code" 能力的 agent（针对编程类输入）
            const lowerInput = userInput.toLowerCase()
            const isCodingTask =
              lowerInput.includes("代码") || lowerInput.includes("实现") ||
              lowerInput.includes("排序") || lowerInput.includes("算法") ||
              lowerInput.includes("写") || lowerInput.includes("code") ||
              lowerInput.includes("sort") || lowerInput.includes("function") ||
              lowerInput.includes("bug") || lowerInput.includes("修复")

            if (isCodingTask) {
              const coder = enabledAgents.find(
                (a) => a.capabilities.includes("code-read") || a.capabilities.includes("code-write")
              )
              agent = coder ?? enabledAgents[0]!
            } else {
              agent = enabledAgents[0]!
            }

            yield* Ref.update(sessionAgents, map => map.set(sessionId, agent.id))
          }
        }
        
        const executionOptions = makeOptions(sessionId, userInput, options)
        const result = yield* executor.execute(agent, executionOptions)
        return result
      })
    
    return {
      run,
      runStream,
      listAgents,
      getAgent,
      getCurrentAgent,
      setSessionAgent,
      runAuto
    } as AgentService
  })
)