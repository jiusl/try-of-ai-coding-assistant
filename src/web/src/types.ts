// src/web/src/types.ts
// ====================================================
// 前端共享类型定义
// ====================================================

/** 消息角色 */
export type MessageRole = "user" | "assistant" | "tool" | "system"

/** 会话摘要 */
export interface SessionInfo {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount?: number
  /** 工作目录路径 */
  workspace?: string
  /** 所属项目 ID */
  projectId?: string
}

/** 项目信息 */
export interface ProjectInfo {
  id: string
  name: string
  path: string
  lastActivatedAt: string
  createdAt: string
  updatedAt: string
  sessionCount: number
}

/** 聊天消息 */
export interface ChatMessage {
  role: MessageRole
  content: string
  timestamp?: string
  /** 工具调用专用 */
  name?: string
  toolName?: string
  result?: string
  metadata?: Record<string, string>
}

/** Agent 信息 */
export interface AgentInfo {
  id: string
  name: string
  description: string
  enabled?: boolean
  capabilities?: string[]
}

/** Provider 名称 */
export type ProviderName = "openai" | "anthropic" | "deepseek" | "ollama"

/** 模型配置 */
export interface ModelConfig {
  provider: ProviderName
  model: string
  temperature: number
  maxTokens: number
}

/** Provider 配置 */
export interface ProviderConfig {
  hasKey?: boolean
  apiKey?: string
  baseUrl?: string
}

/** 应用配置 */
export interface AppConfig {
  model: ModelConfig
  providers: Record<string, ProviderConfig>
}

/** SSE 事件类型 */
export type SSEEventType = "chunk" | "tool_call" | "phase" | "done" | "error" | "request_confirm"

/** SSE 流状态 */
export interface StreamState {
  isStreaming: boolean
  contentSoFar: string
  segments: StreamSegment[]
  phase: string
  iteration: number
  currentTool?: string
  error?: string
}

/** 流式消息段 */
export type StreamSegment =
  | { type: "text"; content: string }
  | { type: "tool"; payload: ToolCallPayload }

/** 工具调用 payload */
export interface ToolCallPayload {
  tool: string
  arguments: string
  result: string | null
}

/** 确认请求 */
export interface ConfirmRequest {
  sessionId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown> | string
  message: string
}

/** WebSocket 服务端消息 */
export interface WSMessage {
  type: string
  sessionId: string
  data: Record<string, unknown>
}

/** 订阅配额 */
export interface QuotaInfo {
  tierId: string
  tierName: string
  dailyChats: { used: number; limit: number | null; remaining: number | null }
  maxSessions: { current: number; limit: number | null; remaining: number | null }
  tierInfo?: { tierId: string; tierName: string; expiresAt: string | null; isExpired: boolean }
  /** 配额用尽时的重置时间（ISO 8601 UTC），仅剩余为 0 时有值 */
  resetAt?: string | undefined
}

/** 等级完整信息 */
export interface TierInfo {
  id: string
  name: string
  dailyChats: number | null
  dailyTokens: number | null
  maxSessions: number | null
  sortOrder: number
}

/** 切换等级返回 */
export interface SwitchTierResult {
  tier: {
    id: string
    name: string
    dailyChats: number | null
    maxSessions: number | null
  }
  remaining: QuotaInfo
  tierInfo: { tierId: string; tierName: string; expiresAt: string | null; isExpired: boolean } | null
}

/** 认证用户信息 */
export interface AuthUser {
  id: string
  name: string
  email?: string
  roles: string[]
}

/** 登录/注册表单 */
export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput {
  name: string
  email: string
  password: string
}

/** 认证令牌 */
export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

/** License 信息 */
export interface LicenseInfo {
  id: number
  licenseKey: string
  licensee: string | null
  product: string
  maxUsers: number
  maxSessions: number
  features: Record<string, boolean>
  issuedAt: string
  expiresAt: string | null
  status: "active" | "expired" | "revoked"
}

// ── 工具 & Skill 管理 ──

/** 工具信息（来自 GET /api/tools） */
export interface ToolInfo {
  name: string
  source: "builtin" | "user" | "remote"
  category?: string
  description?: string
  loaded: boolean
  error?: string
  toolDir: string
}

/** 工具重载结果 */
export interface ToolReloadResult {
  total: number
  builtin: number
  user: number
  remote: number
  errors: Array<{ name: string; source: string; error: string }>
}

/** 添加工具返回 */
export interface AddToolResult {
  name: string
  destDir: string
  reloadResult: ToolReloadResult
}

/** Skill 信息（来自 GET /api/skills） */
export interface SkillInfo {
  name: string
  source: "builtin" | "user" | "remote"
  category?: string
  description?: string
  loaded: boolean
  error?: string
  skillDir: string
}

/** Skill 重载结果 */
export interface SkillReloadResult {
  total: number
}

/** 添加 Skill 返回 */
export interface AddSkillResult {
  name: string
  destDir: string
  total: number
}

// ── 文件浏览 ──

/** 目录项 */
export interface FileEntry {
  name: string
  isDir: boolean
  size?: number
}

/** 文件内容 */
export interface FileContent {
  content: string
  language: string
  size: number
  path: string
}
