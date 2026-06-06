import { Layer } from "effect"
import { EnvLive } from "../infra/env.js"
import { FsLive } from "../infra/fs-util.js"
import { DatabaseDefaultLive } from "../infra/database.js"
import { ConfigLive } from "../config/config.js"
import { AuthLive } from "../provider/auth.js"
import { ProviderLive } from "../provider/provider.js"
import { SessionLive } from "../session/session.js"
import { RuleEngineLive } from "../permission/rule-engine.js"
import { PermissionLive } from "../permission/permission.js"
import { ToolRegistryLive } from "../tool/index.js"
import { AgentRegistryLive, AgentExecutorLive, AgentServiceLive } from "../agent/index.js"

// 使用 Layer.empty + provideMerge 构建无依赖的闭合 Layer
// 原则：需要某依赖的层必须在提供该依赖的层之前（需求在前，提供在后）
export const AppLayer = Layer.empty.pipe(
  Layer.provideMerge(AgentServiceLive),
  Layer.provideMerge(AgentRegistryLive),
  Layer.provideMerge(AgentExecutorLive),
  Layer.provideMerge(ToolRegistryLive),
  Layer.provideMerge(ProviderLive),
  Layer.provideMerge(PermissionLive),
  Layer.provideMerge(AuthLive),
  Layer.provideMerge(ConfigLive),
  Layer.provideMerge(RuleEngineLive),
  Layer.provideMerge(SessionLive),
  Layer.provideMerge(DatabaseDefaultLive),
  Layer.provideMerge(EnvLive),
  Layer.provideMerge(FsLive)
)