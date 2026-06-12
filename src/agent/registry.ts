// src/agent/registry.ts
import { Context, Effect, Layer, Ref } from "effect"
import type { AgentConfig, AgentCapability } from "./types.js"
import { AgentNotFoundError } from "./types.js"

// ====================================================
// 服务接口
// ====================================================

export interface AgentRegistryService {
  /** 注册 Agent */
  readonly register: (config: AgentConfig) => Effect.Effect<void>
  
  /** 批量注册 */
  readonly registerAll: (configs: AgentConfig[]) => Effect.Effect<void>
  
  /** 获取 Agent */
  readonly get: (id: string) => Effect.Effect<AgentConfig, AgentNotFoundError>
  
  /** 列出所有 Agent */
  readonly list: (options?: { 
    enabledOnly?: boolean
    capability?: AgentCapability 
  }) => Effect.Effect<AgentConfig[]>
  
  /** 启用/禁用 Agent */
  readonly setEnabled: (id: string, enabled: boolean) => Effect.Effect<void, AgentNotFoundError>
  
  /** 清空所有注册的 Agent（用于测试） */
  readonly clear: () => Effect.Effect<void>
}

export class AgentRegistry extends Context.Tag("AgentRegistry")<
  AgentRegistry,
  AgentRegistryService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const AgentRegistryLive = Layer.effect(
  AgentRegistry,
  Effect.gen(function* () {
    const agentsRef = yield* Ref.make<Map<string, AgentConfig>>(new Map())
    
    const register = (config: AgentConfig) =>
      Effect.gen(function* () {
        yield* Ref.update(agentsRef, map => map.set(config.id, config))
      })
    
    const registerAll = (configs: AgentConfig[]) =>
      Effect.gen(function* () {
        for (const config of configs) {
          yield* register(config)
        }
      })
    
    const get = (id: string) =>
      Effect.gen(function* () {
        const agents = yield* Ref.get(agentsRef)
        const agent = agents.get(id)
        if (!agent) {
          return yield* Effect.fail(new AgentNotFoundError({ agentId: id }))
        }
        return agent
      })
    
    const list = (options?: { enabledOnly?: boolean; capability?: AgentCapability }) =>
      Effect.gen(function* () {
        const agents = yield* Ref.get(agentsRef)
        let result = Array.from(agents.values()) as AgentConfig[]
        
        if (options?.enabledOnly) {
          result = result.filter((a: AgentConfig) => a.enabled !== false)
        }
        
        if (options?.capability) {
          const cap = options.capability
          result = result.filter((a: AgentConfig) => a.capabilities.includes(cap))
        }
        
        return result
      })
    
    const setEnabled = (id: string, enabled: boolean) =>
      Effect.gen(function* () {
        const agent = yield* get(id)
        yield* Ref.update(agentsRef, map => map.set(id, { ...agent, enabled }))
      })
    
    const clear = () =>
      Effect.gen(function* () {
        yield* Ref.set(agentsRef, new Map())
      })
    
    return {
      register,
      registerAll,
      get,
      list,
      setEnabled,
      clear
    }
  })
)