// src/agent/protocol.ts
// ====================================================
// Agent 间通信协议 — 形式化委托/子任务类型系统
// ====================================================

import { Data } from "effect"

// -------------------------------------------------
// 委托请求 — Orchestrator → Specialist
// -------------------------------------------------

/** 子任务优先级 */
export type SubtaskPriority = "low" | "normal" | "high" | "critical"

/** 委托请求：从编排器发送给专家 Agent 的结构化任务 */
export interface SubtaskRequest {
  /** 唯一子任务 ID */
  taskId: string
  /** 发起委托的 Agent ID */
  fromAgentId: string
  /** 目标 Agent ID */
  toAgentId: string
  /** 任务描述（自然语言） */
  description: string
  /** 任务优先级 */
  priority: SubtaskPriority
  /** 涉及的上下文（文件路径、代码片段等） */
  context?: SubtaskContext
  /** 期望的输出格式 */
  expectedOutput?: "code" | "report" | "boolean" | "text" | "summary"
  /** 最大执行轮数 */
  maxIterations?: number
}

/** 委托上下文：传递给子 Agent 的环境信息 */
export interface SubtaskContext {
  /** 涉及的文件路径列表 */
  filePaths?: string[]
  /** 当前工作目录 */
  workspaceRoot?: string
  /** 附加说明 */
  notes?: string
  /** 前置条件（必须先满足的条件） */
  preconditions?: string[]
}

// -------------------------------------------------
// 委托结果 — Specialist → Orchestrator
// -------------------------------------------------

/** 委托执行状态 */
export type SubtaskStatus = "success" | "failure" | "timeout" | "cancelled" | "blocked"

/** 委托结果：专家 Agent 返回给编排器的结构化响应 */
export interface SubtaskResult {
  /** 对应的任务 ID */
  taskId: string
  /** 执行状态 */
  status: SubtaskStatus
  /** 输出内容 */
  content: string
  /** 产生的产物（如创建的/修改的文件） */
  artifacts?: SubtaskArtifact[]
  /** 错误信息（status !== success 时） */
  error?: string
  /** 执行的迭代次数 */
  iterations: number
  /** 工具调用次数 */
  toolCallCount: number
  /** 执行耗时 (ms) */
  durationMs: number
  /** 后续建议 */
  followUpSuggestions?: string[]
}

/** 子任务产物 */
export interface SubtaskArtifact {
  /** 产物类型 */
  type: "file_created" | "file_modified" | "file_deleted" | "test_result" | "report"
  /** 产物路径或标识 */
  path: string
  /** 简要描述 */
  summary: string
}

// -------------------------------------------------
// 委托链上下文 — 运行时跟踪
// -------------------------------------------------

/** 委托链：跟踪当前调用路径以防止循环委派 */
export interface DelegationChain {
  /** 调用链路径（按调用顺序） */
  path: string[]
  /** 当前深度 */
  depth: number
  /** 最大允许深度 */
  maxDepth: number
  /** 根任务 ID */
  rootTaskId: string
  /** 当前父任务 ID */
  parentTaskId: string
}

// -------------------------------------------------
// 错误类型
// -------------------------------------------------

export class CircularDelegationError extends Data.TaggedError("CircularDelegationError")<{
  readonly chain: string
  readonly agentId: string
}> {}

export class MaxDelegationDepthError extends Data.TaggedError("MaxDelegationDepthError")<{
  readonly depth: number
  readonly maxDepth: number
}> {}

export class DelegationFailedError extends Data.TaggedError("DelegationFailedError")<{
  readonly agentId: string
  readonly reason: string
}> {}

// -------------------------------------------------
// 辅助函数
// -------------------------------------------------

/** 创建委托链 */
export const createDelegationChain = (
  rootTaskId: string,
  parentTaskId: string,
  maxDepth = 3,
): DelegationChain => ({
  path: [],
  depth: 0,
  maxDepth,
  rootTaskId,
  parentTaskId,
})

/** 在委托链中添加一个 Agent */
export const pushToChain = (chain: DelegationChain, agentId: string): DelegationChain => ({
  ...chain,
  path: [...chain.path, agentId],
  depth: chain.depth + 1,
})

/** 检查是否会发生循环委派 */
export const wouldCycle = (chain: DelegationChain, agentId: string): boolean =>
  chain.path.includes(agentId)

/** 检查是否超过最大深度 */
export const exceedsMaxDepth = (chain: DelegationChain): boolean =>
  chain.depth >= chain.maxDepth

/** 格式化委托链为可读的字符串 */
export const formatChain = (chain: DelegationChain): string =>
  [...chain.path, "(current)"].join(" → ")

/** 生成唯一的子任务 ID */
export const generateTaskId = (): string =>
  `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

/** 判断 Agent 是否可以被委托（必须是专家型 Agent） */
export const isDelegatableAgent = (agentId: string): boolean => {
  // orchestrator 自身不应该被委派，chat 也不适合
  const nonDelegatable = ["builtin:orchestrator", "builtin:chat"]
  return !nonDelegatable.includes(agentId)
}

/** 根据能力推荐合适的 Agent */
export const recommendAgent = (
  capabilities: string[],
  availableAgents: Array<{ id: string; capabilities: string[] }>,
): string | null => {
  let bestMatch: string | null = null
  let bestScore = 0

  for (const agent of availableAgents) {
    if (!isDelegatableAgent(agent.id)) continue
    const score = capabilities.filter((c) => agent.capabilities.includes(c)).length
    if (score > bestScore) {
      bestScore = score
      bestMatch = agent.id
    }
  }

  return bestMatch
}
