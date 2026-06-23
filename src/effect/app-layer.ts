import { Layer } from "effect"
import { EnvLive } from "../infra/env.js"
import { FsLive } from "../infra/fs-util.js"
import { DatabaseDefaultLive } from "../infra/database.js"
import { ConfigLive } from "../config/config.js"
import { AuthLive } from "../provider/auth.js"
import { ProviderLive } from "../provider/provider.js"
import { SessionLive } from "../session/session.js"
import { MemoryLive } from "../memory/memory.js"
import { EmbeddingServiceLive } from "../memory/embedding.js"
import { AutoMemoryLive } from "../memory/auto-memory.js"
import { RuleEngineLive } from "../permission/rule-engine.js"
import { PermissionLive } from "../permission/permission.js"
import { ToolRegistryLive } from "../tool/index.js"
import { ConfirmationStoreLive } from "../tool/confirmation.js"
import { AgentRegistryLive, AgentExecutorLive, AgentServiceLive } from "../agent/index.js"
import {
  SkillLoaderLive,
  SkillRegistryLive,
  SkillSystemLive,
  SkillInitLive,
} from "../skill/index.js"

// 单管道 provideMerge（恰好 20 层，不超限制）
// 原则：需要某依赖的层必须在提供该依赖的层之前（需求在前，提供在后）
// EnvLive + FsLive 合并为一个 infra 层，避免超出 20 层限制
const InfraLive = Layer.mergeAll(EnvLive, FsLive)

export const AppLayer = Layer.empty.pipe(
  Layer.provideMerge(AgentServiceLive),
  Layer.provideMerge(AgentRegistryLive),
  Layer.provideMerge(AgentExecutorLive),
  Layer.provideMerge(ToolRegistryLive),
  Layer.provideMerge(ConfirmationStoreLive),
  Layer.provideMerge(SkillInitLive),
  Layer.provideMerge(SkillSystemLive),
  Layer.provideMerge(SkillRegistryLive),
  Layer.provideMerge(SkillLoaderLive),
  Layer.provideMerge(AutoMemoryLive),
  Layer.provideMerge(ProviderLive),
  Layer.provideMerge(PermissionLive),
  Layer.provideMerge(AuthLive),
  Layer.provideMerge(ConfigLive),
  Layer.provideMerge(RuleEngineLive),
  Layer.provideMerge(SessionLive),
  Layer.provideMerge(MemoryLive),
  Layer.provideMerge(EmbeddingServiceLive),
  Layer.provideMerge(DatabaseDefaultLive),
  Layer.provideMerge(InfraLive),
)