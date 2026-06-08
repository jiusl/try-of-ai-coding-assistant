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
  
  /** 选择最合适的 Agent */
  readonly select: (message: string) => Effect.Effect<AgentConfig, AgentNotFoundError>

  /** 清空所有注册的 Agent（用于测试） */
  readonly clear: () => Effect.Effect<void>
}

export class AgentRegistry extends Context.Tag("AgentRegistry")<
  AgentRegistry,
  AgentRegistryService
>() {}

// ====================================================
// 意图检测（用于选择 Agent）
// ====================================================

const detectIntent = (message: string): AgentCapability[] => {
  const lower = message.toLowerCase()
  const capabilities: AgentCapability[] = []
  
  // code-write: 写代码、实现、编程、写函数、写方法、创建
  if (
    lower.includes("写代码") || lower.includes("实现") || lower.includes("编程") ||
    lower.includes("写函数") || lower.includes("写方法") || lower.includes("写一个") ||
    lower.includes("创建") || lower.includes("开发") || lower.includes("编写") ||
    lower.includes("排序") || lower.includes("算法") || lower.includes("function") ||
    lower.includes("implement") || lower.includes("code") || lower.includes("代码")
  ) {
    capabilities.push("code-write")
  }
  
  // code-read: 阅读、读代码、查看、分析代码、理解
  if (
    lower.includes("读代码") || lower.includes("查看") || lower.includes("阅读") ||
    lower.includes("read") || lower.includes("解释") || lower.includes("理解") ||
    lower.includes("分析") || lower.includes("explain")
  ) {
    capabilities.push("code-read")
  }

  if (lower.includes("build") || lower.includes("compile") || lower.includes("打包") || lower.includes("构建")) {
    capabilities.push("build")
  }
  if (lower.includes("review") || lower.includes("审查") || lower.includes("检查代码")) {
    capabilities.push("code-review")
  }
  if (lower.includes("test") || lower.includes("测试")) {
    capabilities.push("test-run")
  }
  if (lower.includes("搜索") || lower.includes("查一下") || lower.includes("查查") ||
    lower.includes("网上") || lower.includes("网页") || lower.includes("文档") || 
    lower.includes("api") || lower.includes("官网") || lower.includes("search") ||
    lower.includes("fetch") || lower.includes("爬取")) {
    capabilities.push("web-fetch")
  }
  if (lower.includes("doc") || lower.includes("注释")) {
    capabilities.push("document")
  }
  if (lower.includes("refactor") || lower.includes("重构") || lower.includes("优化")) {
    capabilities.push("refactor")
  }
  
  if (capabilities.length === 0) {
    capabilities.push("chat")
  }
  
  return capabilities
}

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
    
    const select = (message: string) =>
      Effect.gen(function* () {
        const capabilities = detectIntent(message)
        const agents = yield* list({ enabledOnly: true })
        
        if (agents.length === 0) {
          return yield* Effect.fail(new AgentNotFoundError({ agentId: "无可用的 Agent" }))
        }
        
        const lowerMsg = message.toLowerCase()
        const agentsArr = agents as AgentConfig[]
        let bestAgent: AgentConfig = agentsArr[0]!
        let bestScore = -1
        
        for (const agent of agentsArr) {
          let score = 0
          // 能力匹配加分（每个匹配 +3）
          for (const cap of capabilities) {
            if (agent.capabilities.includes(cap)) {
              score += 3
            }
          }
          // 消息内容直接匹配能力字符串 +2
          for (const cap of capabilities) {
            if (lowerMsg.includes(cap)) {
              score += 2
            }
          }
          // Agent 名称/描述匹配消息关键词 +1
          const lowerName = agent.name.toLowerCase()
          const lowerDesc = agent.description.toLowerCase()
          const words = message.toLowerCase().split(/\s+/)
          for (const word of words) {
            if (word.length >= 2 && (lowerName.includes(word) || lowerDesc.includes(word))) {
              score += 1
            }
          }
          // 非 chat 的通用 Agent 在能力匹配时给予额外加分
          if (agent.id !== "builtin:chat" && agent.capabilities.some(c => capabilities.includes(c))) {
            score += 1
          }
          if (score > bestScore) {
            bestScore = score
            bestAgent = agent
          }
        }
        
        return bestAgent
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
      select,
      clear
    }
  })
)