// src/permission/types.ts
import { Data } from "effect"
import mm from "micromatch"

// ====================================================
// 基础类型
// ====================================================

export type Action = 
  | "read"      // 读取文件
  | "write"     // 写入文件
  | "edit"      // 编辑文件
  | "delete"    // 删除文件
  | "execute"   // 执行命令
  | "network"   // 网络请求
  | "env"       // 读取环境变量
  | "shell"     // Shell 命令

export type Decision = "allow" | "deny" | "ask"

// 支持字符串（glob 模式）或正则表达式
export type Pattern = string | RegExp

export interface PermissionRule {
  id: string
  action: Action
  pattern: Pattern  // 支持 glob 或 RegExp
  decision: Decision
  priority: number  // 数字越大优先级越高
  description?: string
  condition?: string  // 条件表达式，如 "context.isCI === true"
  requireConfirm?: boolean  // 是否必须确认（覆盖 decision）
}

export interface PermissionContext {
  sessionId: string
  userId?: string
  projectPath: string
  isCI: boolean
  isInteractive: boolean
  recentApprovals: Set<string>  // 最近批准的操作 ID
}

export interface PermissionRequest {
  action: Action
  target: string
  context: PermissionContext
  metadata?: {
    command?: string
    fileSize?: number
    destination?: string
    originalContent?: string
  }
}

// ====================================================
// 辅助函数
// ====================================================

/** 检查目标是否匹配模式（支持 glob 和 RegExp） */
export const matchesPattern = (target: string, pattern: Pattern): boolean => {
  if (typeof pattern === "string") {
    return mm.isMatch(target, pattern)
  }
  return pattern.test(target)
}

// ====================================================
// 错误类型
// ====================================================

export class PermissionDeniedError extends Data.TaggedError("PermissionDenied")<{
  action: Action
  target: string
  reason: string
  ruleId?: string
}> {
  override get message(): string {
    return `权限被拒绝：${this.reason}（操作: ${this.action}，目标: ${this.target}）`
  }
}

export class PermissionAskError extends Data.TaggedError("PermissionAsk")<{
  action: Action
  target: string
  message: string
  requestId: string
}> {}

export class PermissionConfigError extends Data.TaggedError("PermissionConfig")<{
  message: string
  ruleId?: string
}> {}