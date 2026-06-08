// src/agent/types.ts
import { Data } from "effect"
import type { ToolCall, ToolResult } from "../tool/types.js"

// ====================================================
// Agent 能力类型
// ====================================================

export type AgentCapability = 
  | "chat"       // 通用对话
  | "code-read"  // 读取代码
  | "code-write" // 写入代码
  | "code-edit"  // 编辑代码
  | "code-review"// 代码审查
  | "test-run"   // 运行测试
  | "test-write" // 编写测试
  | "build"      // 构建
  | "refactor"   // 重构
  | "document"   // 文档
  | "execute"    // 执行命令
  | "delegate"   // 委派子任务
  | "web-fetch"  // 网页抓取

// ====================================================
// Agent 配置
// ====================================================

export interface AgentConfig {
  /** Agent 唯一标识 */
  id: string
  /** Agent 名称 */
  name: string
  /** Agent 描述 */
  description: string
  /** 能力列表 */
  capabilities: AgentCapability[]
  /** 系统提示词 */
  systemPrompt: string
  /** 允许使用的工具名称列表 */
  toolNames: string[]
  /** 使用的模型（可选，不填则使用默认） */
  model?: string
  /** 温度参数 */
  temperature?: number
  /** 最大 token 数 */
  maxTokens?: number
  /** 最大工具调用轮数 */
  maxIterations?: number
  /** 是否启用 */
  enabled?: boolean
}

// ====================================================
// Agent 执行相关
// ====================================================

/** 执行阶段 */
export type ExecutionPhase = 
  | "initializing"   // 初始化
  | "thinking"       // AI 思考中
  | "calling_tool"   // 调用工具
  | "processing"     // 处理结果
  | "generating"     // 生成响应
  | "done"           // 完成
  | "error"          // 错误

/** 执行状态（用于流式推送）*/
export interface ExecutionState {
  phase: ExecutionPhase
  content: string
  iteration: number
  currentTool?: string
  currentToolCall?: ToolCall
  error?: string
}

/** 执行选项 */
export interface AgentExecutionOptions {
  sessionId: string
  userInput: string
  maxIterations?: number
  model?: string
  onChunk?: (chunk: string) => void
  onToolCall?: (toolCall: ToolCall, result?: ToolResult) => void
  onPhaseChange?: (state: ExecutionState) => void
}

/** 执行结果 */
export interface AgentExecutionResult {
  content: string
  toolCalls: ToolCall[]
  toolResults: ToolResult[]
  iterations: number
  durationMs: number
  tokensUsed: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// ====================================================
// 错误类型（使用 Data.TaggedError）
// ====================================================

export class AgentNotFoundError extends Data.TaggedError("AgentNotFound")<{
  agentId: string
}> {
  override get message(): string {
    return `找不到 Agent "${this.agentId}"，请检查 Agent ID 是否正确或 Agent 是否已注册`
  }
}

export class AgentExecutionError extends Data.TaggedError("AgentExecution")<{
  agentId: string
  message: string
  cause?: unknown
}> {}

export class MaxIterationsExceededError extends Data.TaggedError("MaxIterationsExceeded")<{
  maxIterations: number
}> {
  override get message(): string {
    return `已达最大迭代次数 (${this.maxIterations})，部分进度已保存到会话中。你可以发送后续消息继续（例如输入 "继续"），或增大 maxIterations、简化任务需求`
  }
}

export class NoToolsAvailableError extends Data.TaggedError("NoToolsAvailable")<{
  agentId: string
}> {
  override get message(): string {
    return `Agent "${this.agentId}" 配置了工具但所有工具均不可用，请检查工具注册状态或修改 Agent 的 toolNames 配置`
  }
}