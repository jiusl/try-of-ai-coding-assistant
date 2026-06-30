// src/tool/index.ts
import { Layer, Effect } from "effect"
import { ToolRegistry, ToolRegistryLive as BaseToolRegistryLive } from "./registry.js"
import { BUILTIN_TOOL_IMPLS } from "./builtin/index.js"
import { ToolLoader, ToolLoaderLive } from "./loader.js"
import { userToolToDefinition } from "./loader.js"
import { logger } from "../infra/logger.js"

// 带自动注册的 ToolRegistry Live：
// 从 Loader 扫描 tools/{builtin,user,remote}/ → 转换 → 注册到 Registry
export const ToolRegistryLive = Layer.effect(
  ToolRegistry,
  Effect.gen(function* () {
    const registry = yield* ToolRegistry
    const loader = yield* ToolLoader

    const workspaceRoot = process.cwd()
    const tools = yield* loader.loadAll(workspaceRoot)

    let builtinCount = 0
    let userCount = 0
    let remoteCount = 0

    for (const userDef of tools) {
      try {
        const toolDef = userToolToDefinition(userDef, BUILTIN_TOOL_IMPLS)
        if (!toolDef) continue

        yield* registry.register(toolDef)

        if (userDef.source === "builtin") builtinCount++
        else if (userDef.source === "user") userCount++
        else if (userDef.source === "remote") remoteCount++
      } catch (err) {
        logger.warn(`跳过工具 "${userDef.name}": ${String(err)}`)
      }
    }

    logger.info(
      `注册了 ${builtinCount + userCount + remoteCount} 个工具` +
        ` (builtin: ${builtinCount}, user: ${userCount}, remote: ${remoteCount})`,
    )

    return registry
  })
).pipe(
  Layer.provide(BaseToolRegistryLive),
  Layer.provide(ToolLoaderLive),
)

export * from "./types.js"
export * from "./registry.js"
export { ToolLoader, ToolLoaderLive } from "./loader.js"
export { userToolToDefinition } from "./loader.js"
export { BUILTIN_TOOL_IMPLS, BUILTIN_TOOLS } from "./builtin/index.js"