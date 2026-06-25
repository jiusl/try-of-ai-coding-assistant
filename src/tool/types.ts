// src/tool/types.ts
import { Data, Effect, Schema } from "effect"
import type { Action } from "../permission/types.js"

// ====================================================
// 工具来源 & 目录映射
// ====================================================

/** 工具来源：内置 / 用户自定义 / 远程下载 */
export type ToolSource = "builtin" | "user" | "remote"

/** 工具根目录名称 */
export const TOOLS_DIR = "tools"

/** ToolSource → 工具子目录映射 */
export const TOOL_SOURCE_DIRS: Record<ToolSource, string> = {
  builtin: "builtin",
  user: "user",
  remote: "remote",
} as const

// ====================================================
// 用户工具配置（TOOL.md frontmatter）
// ====================================================

/** 参数定义（TOOL.md parameters 区） */
export interface ToolParameterDef {
  readonly type: "string" | "number" | "integer" | "boolean" | "array" | "object"
  readonly description: string
  readonly required?: boolean
  readonly default?: unknown
  readonly enum?: string[]
  readonly items?: { type: string }
}

/** 执行配置（仅混合型用户工具） */
export interface ToolExecutionConfig {
  readonly type: "script" | "internal"
  /** 入口脚本路径（相对于工具目录，type=script 时必填） */
  readonly entry: string
  /** 解释器，默认根据扩展名推断 */
  readonly interpreter?: string
  /** 超时时间（毫秒），默认 30000 */
  readonly timeout: number
  /** 是否需要用户确认 */
  readonly requireConfirm: boolean
  /** type=internal 时：指向 TS 实现表中的 key */
  readonly impl?: string
}

/** TOOL.md YAML frontmatter */
export interface UserToolFrontmatter {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly author: string
  readonly tags: string[]
  readonly category: ToolCategory
  readonly permission: Action
  readonly sensitivity: SensitivityLevel
  readonly sideEffect: "read" | "write"
  readonly safeToRetry: boolean
  readonly defaultEnabled: boolean
  readonly execution: ToolExecutionConfig
  readonly parameters: Record<string, ToolParameterDef>
}

/** 解析后的用户工具定义（含路径等运行时信息） */
export interface UserToolDefinition {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly author: string
  readonly tags: string[]
  readonly toolDir: string
  /** TOOL.md 的绝对路径 */
  readonly mdPath: string
  /** Markdown 正文（去除 frontmatter，用作工具说明补充） */
  readonly body: string
  /** 原始 frontmatter */
  readonly frontmatter: UserToolFrontmatter
  /** TOOL.md 的修改时间 */
  readonly mtime: Date
  /** 来源 */
  readonly source: ToolSource
}

// ====================================================
// 工具基础类型
// ====================================================

/** 工具类别 */
export type ToolCategory = 
  | "file"      // 文件操作
  | "command"   // 命令执行
  | "search"    // 搜索操作
  | "reasoning" // 推理/思考

/**
 * 工具敏感度等级
 * - low:  只读操作，无副作用，workspace 范围内（自动通过）
 * - medium: 跨边界读取或 workspace 内写入（会话级信任可自动通过）
 * - high:    外部写入/删除/网络请求/任意命令执行（每次需确认）
 * - critical: 系统级破坏性操作如 rm/chmod/格式化（每次需确认 + 二次确认）
 */
export type SensitivityLevel = "low" | "medium" | "high" | "critical"

/** 工具定义（使用 Schema 驱动）*/
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /** 工具唯一标识 */
  name: string
  /** 工具描述（给 LLM 看） */
  description: string
  /** 工具类别 */
  category: ToolCategory
  /** 需要的权限类型 */
  permission: Action
  /** 输入参数 Schema（用于验证和生成 JSON Schema） */
  inputSchema: Schema.Schema<any>
  /** 副作用级别：只读 / 写入（驱动确认机制和重试策略） */
  sideEffect: "read" | "write"
  /** 是否可安全重试（只读操作通常为 true，幂等写入也可为 true） */
  safeToRetry: boolean
  /** 是否需要用户确认（覆盖 permission 默认行为） */
  requireConfirm?: boolean
  /** 敏感度等级（驱动前端确认流程） */
  sensitivity: SensitivityLevel
  /** 是否在所有 Agent 中默认启用 */
  defaultEnabled?: boolean
  /** 执行函数 */
  execute: (input: TInput, context: ToolContext) => Effect.Effect<TOutput, ToolError, any>
}

/** 工具执行上下文 */
export interface ToolContext {
  sessionId: string
  workspaceRoot: string
  abortSignal?: AbortSignal
  /** 当前是否为交互式会话（终端可接受用户输入） */
  isInteractive: boolean
}

/** 工具调用（来自 LLM）*/
export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

/** 工具执行结果 */
export interface ToolResult {
  tool_call_id: string
  role: "tool"
  content: string
  success: boolean
  error?: string
}

/** 确认请求（从前端确认流程，敏感工具执行前发出） */
export interface ConfirmRequest {
  sessionId: string
  toolCallId: string
  toolName: string
  target: string
  arguments: string
  sensitivity: string
  reason: string
}

// ====================================================
// 错误类型（使用 Data.TaggedError）
// ====================================================

export class ToolNotFoundError extends Data.TaggedError("ToolNotFound")<{
  toolName: string
}> {
  override get message(): string {
    return `找不到工具 "${this.toolName}"，请检查工具是否已注册或名称是否正确`
  }
}

export class ToolExecutionError extends Data.TaggedError("ToolExecution")<{
  toolName: string
  message: string
  cause?: unknown
}> {}

export class ToolValidationError extends Data.TaggedError("ToolValidation")<{
  toolName: string
  message: string
  input?: unknown
}> {}

export class ToolPermissionError extends Data.TaggedError("ToolPermission")<{
  toolName: string
  action: string
  resource: string
  reason: string
}> {
  override get message(): string {
    return `工具 "${this.toolName}" 权限不足：${this.reason}（操作: ${this.action}，资源: ${this.resource}）`
  }
}

/** 工具错误联合类型 */
export type ToolError = ToolNotFoundError | ToolExecutionError | ToolValidationError | ToolPermissionError

// ====================================================
// 内置工具输入类型（使用 Schema）
// ====================================================

/** 读取文件输入 */
export class ReadInput extends Schema.TaggedRequest<ReadInput>()("ReadInput", {
  failure: Schema.Never,
  success: Schema.String,
  payload: {
    filePath: Schema.String,
    offset: Schema.optional(Schema.Number),
    limit: Schema.optional(Schema.Number)
  }
}) {}

/** 写入文件输入 */
export class WriteInput extends Schema.TaggedRequest<WriteInput>()("WriteInput", {
  failure: Schema.Never,
  success: Schema.String,
  payload: {
    filePath: Schema.String,
    content: Schema.String
  }
}) {}

/** 编辑文件输入 */
export class EditInput extends Schema.TaggedRequest<EditInput>()("EditInput", {
  failure: Schema.Never,
  success: Schema.String,
  payload: {
    filePath: Schema.String,
    oldString: Schema.String,
    newString: Schema.String
  }
}) {}

/** 执行命令输入 */
export class BashInput extends Schema.TaggedRequest<BashInput>()("BashInput", {
  failure: Schema.Never,
  success: Schema.String,
  payload: {
    command: Schema.String,
    timeout: Schema.optional(Schema.Number),
    cwd: Schema.optional(Schema.String)
  }
}) {}

/** Glob 搜索输入 */
export class GlobInput extends Schema.TaggedRequest<GlobInput>()("GlobInput", {
  failure: Schema.Never,
  success: Schema.Array(Schema.String),
  payload: {
    pattern: Schema.String,
    cwd: Schema.optional(Schema.String),
    ignore: Schema.optional(Schema.Array(Schema.String))
  }
}) {}

/** Grep 搜索输入 */
export class GrepInput extends Schema.TaggedRequest<GrepInput>()("GrepInput", {
  failure: Schema.Never,
  success: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      line: Schema.Number,
      content: Schema.String
    })
  ),
  payload: {
    pattern: Schema.String,
    path: Schema.optional(Schema.String),
    recursive: Schema.optional(Schema.Boolean),
    ignoreCase: Schema.optional(Schema.Boolean)
  }
}) {}

/** 思考输入 */
export class ThinkInput extends Schema.TaggedRequest<ThinkInput>()("ThinkInput", {
  failure: Schema.Never,
  success: Schema.String,
  payload: {
    thought: Schema.String,
    plan: Schema.optional(Schema.Array(Schema.String))
  }
}) {}

// ====================================================
// 工具加载错误类型
// ====================================================

export class ToolLoadError extends Data.TaggedError("ToolLoad")<{
  readonly path: string
  readonly reason: string
}> {
  override get message(): string {
    return `工具加载失败 (${this.path}): ${this.reason}`
  }
}

export class ToolParseError extends Data.TaggedError("ToolParseError")<{
  readonly path: string
  readonly reason: string
}> {
  override get message(): string {
    return `工具解析失败 (${this.path}): ${this.reason}`
  }
}