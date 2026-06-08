// src/tool/types.ts
import { Data, Effect, Schema } from "effect"
import type { Action } from "../permission/types.js"

// ====================================================
// 工具基础类型
// ====================================================

/** 工具类别 */
export type ToolCategory = 
  | "file"      // 文件操作
  | "command"   // 命令执行
  | "search"    // 搜索操作
  | "reasoning" // 推理/思考

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
  /** 是否需要用户确认（覆盖 permission 默认行为） */
  requireConfirm?: boolean
  /** 是否在所有 Agent 中默认启用 */
  defaultEnabled?: boolean
  /** 执行函数 */
  execute: (input: TInput, context: ToolContext) => Effect.Effect<TOutput, ToolError>
}

/** 工具执行上下文 */
export interface ToolContext {
  sessionId: string
  workspaceRoot: string
  abortSignal?: AbortSignal
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