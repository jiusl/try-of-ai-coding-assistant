// src/agent/index.ts
import { Layer, Effect } from "effect"
import { AgentRegistry, AgentRegistryLive as BaseAgentRegistryLive } from "./registry.js"
import { AgentExecutor, AgentExecutorLive as BaseAgentExecutorLive } from "./executor.js"
import { AgentServiceTag, AgentServiceLive as BaseAgentServiceLive } from "./agent.js"
import { BUILTIN_AGENTS } from "./builtin/index.js"
import { ToolRegistryLive } from "../tool/index.js"
import { ProviderLive } from "../provider/provider.js"
import { SessionLive } from "../session/session.js"
import { PermissionLive } from "../permission/permission.js"
import { RuleEngineLive } from "../permission/rule-engine.js"

// ====================================================
// AgentRegistry Live（带自动注册）
// ====================================================

export const AgentRegistryLive = Layer.effect(
  AgentRegistry,
  Effect.gen(function* () {
    const registry = yield* AgentRegistry
    for (const agent of BUILTIN_AGENTS) {
      yield* registry.register(agent)
    }
    console.log(`🤖 注册了 ${BUILTIN_AGENTS.length} 个内置 Agent`)
    return registry
  })
).pipe(Layer.provide(BaseAgentRegistryLive))

// ====================================================
// AgentExecutor Live（依赖工具层）
// ====================================================

export const AgentExecutorLive = BaseAgentExecutorLive.pipe(
  Layer.provide(Layer.mergeAll(
    ProviderLive,
    SessionLive,
    ToolRegistryLive,
    AgentRegistryLive
  ))
)

// ====================================================
// AgentService Live（依赖 Registry 和 Executor）
// ====================================================

export const AgentServiceLive = BaseAgentServiceLive.pipe(
  Layer.provide(Layer.mergeAll(
    AgentRegistryLive,
    AgentExecutorLive,
    SessionLive
  ))
)

// ====================================================
// 导出
// ====================================================

export * from "./types.js"
export * from "./registry.js"
export * from "./executor.js"
export type { AgentService } from "./agent.js"
export { AgentServiceTag } from "./agent.js"
export { BUILTIN_AGENTS } from "./builtin/index.js"