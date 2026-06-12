// src/skill/index.ts
import { Layer, Effect, Context } from "effect"
import type { SkillLoaderService } from "./loader.js"
import { SkillLoader, SkillLoaderLive } from "./loader.js"
import type { SkillRegistryService } from "./registry.js"
import { SkillRegistry, SkillRegistryLive } from "./registry.js"
import { SkillExecutor, SkillExecutorLive } from "./executor.js"

import { SkillRemote, SkillRemoteLive } from "./remote.js"
import { SkillLoadError, SkillParseError } from "./types.js"

// ====================================================
// SkillSystem — 统一入口服务
// ====================================================

export interface SkillSystemService {
  /**
   * 初始化 Skill 系统：扫描并加载所有 Skill，注册到 Registry。
   * 应在应用启动时调用。
   */
  readonly initialize: (workspaceRoot: string) => Effect.Effect<number, SkillLoadError | SkillParseError> // 返回加载数量

  /**
   * 热重载指定来源的 Skill
   */
  readonly reload: (
    workspaceRoot: string,
  ) => Effect.Effect<number, SkillLoadError | SkillParseError>
}

export class SkillSystem extends Context.Tag("SkillSystem")<
  SkillSystem,
  SkillSystemService
>() {}

// ====================================================
// SkillSystem Live
// ====================================================

export const SkillSystemLive = Layer.effect(
  SkillSystem,
  Effect.gen(function* () {
    const loader = yield* SkillLoader
    const registry = yield* SkillRegistry

    const initialize = (workspaceRoot: string) =>
      Effect.gen(function* () {
        // 先清空旧数据
        yield* registry.clear()

        // 加载所有 Skill
        const skills = yield* loader.loadAll(workspaceRoot)

        // 批量注册
        yield* registry.registerAll(skills)

        console.log(
          `📦 Skill 系统初始化完成：加载 ${skills.length} 个 Skill` +
            ` (builtin: ${skills.filter((s) => s.source === "builtin").length},` +
            ` user: ${skills.filter((s) => s.source === "user").length},` +
            ` remote: ${skills.filter((s) => s.source === "remote").length})`,
        )

        return skills.length
      })

    const reload = (workspaceRoot: string) => initialize(workspaceRoot)

    return { initialize, reload }
  }),
).pipe(
  Layer.provide(SkillLoaderLive),
  Layer.provide(SkillRegistryLive),
)

// ====================================================
// 组合 Layer（包含所有 Skill 子系统）
// ====================================================

export const SkillLayer = Layer.mergeAll(
  SkillLoaderLive,
  SkillRegistryLive,
).pipe(
  Layer.provideMerge(SkillExecutorLive),
  Layer.provideMerge(SkillRemoteLive),
  Layer.provideMerge(SkillSystemLive),
)

// ====================================================
// 自动初始化 Layer（外部提供 SkillSystem，共享实例）
// ====================================================

const SkillInitTag = Context.GenericTag<Record<string, never>>("SkillInit")

export const SkillInitLive = Layer.effect(
  SkillInitTag,
  Effect.gen(function* () {
    const sys = yield* SkillSystem
    yield* sys.initialize(process.cwd())
    return {} as Record<string, never>
  }),
)

// ====================================================
// 集成 Layer（所有 Skill 子服务共享同一 Registry 实例）
// 原则：pipe 链中，右侧可看到左侧所有输出
// ====================================================

export const SkillIntegratedLayer = Layer.mergeAll(
  SkillLoaderLive,
  SkillRegistryLive,
).pipe(
  // SkillSystem 依赖 Loader + Registry（base 已提供）
  Layer.provideMerge(SkillSystemLive),
  // SkillInit 依赖 SkillSystem（左侧已提供）
  Layer.provideMerge(SkillInitLive),
  Layer.provideMerge(SkillExecutorLive),
  Layer.provideMerge(SkillRemoteLive),
)

// ====================================================
// 重新导出
// ====================================================

export {
  SkillLoader,
  SkillLoaderLive,
} from "./loader.js"

export {
  SkillRegistry,
  SkillRegistryLive,
} from "./registry.js"

export {
  SkillExecutor,
  SkillExecutorLive,
} from "./executor.js"

export {
  SkillRemote,
  SkillRemoteLive,
} from "./remote.js"

export * from "./types.js"
