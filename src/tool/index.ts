// src/tool/index.ts
import { Layer, Effect } from "effect"
import { ToolRegistry, ToolRegistryLive as BaseToolRegistryLive } from "./registry.js"
import { BUILTIN_TOOLS } from "./builtin/index.js"

// 带自动注册的 ToolRegistry Live：
// 上层包装器从 BaseLayer 获取 registry、注册内置工具后透传
export const ToolRegistryLive = Layer.effect(
  ToolRegistry,
  Effect.gen(function* () {
    const registry = yield* ToolRegistry
    for (const tool of BUILTIN_TOOLS) {
      yield* registry.register(tool)
    }
    console.log(`🔧 注册了 ${BUILTIN_TOOLS.length} 个内置工具`)
    return registry
  })
).pipe(Layer.provide(BaseToolRegistryLive))

export * from "./types.js"
export * from "./registry.js"