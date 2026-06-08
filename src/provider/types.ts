// src/provider/types.ts
import { Data, Schema } from "effect"

// ========== 基础类型 ==========
export type Role = "system" | "user" | "assistant" | "tool"

export interface Message {
  role: Role
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

// ========== API 类型 ==========
export interface GenerateOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDefinition[]
}

export interface GenerateResponse {
  content: string
  model: string
  usage: TokenUsage
  tool_calls?: ToolCall[]
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface StreamChunk {
  type: "content" | "tool_call" | "done" | "error"
  content?: string
  tool_call?: ToolCall
  error?: Error
}

// ========== 配置类型 ==========
export type ProviderType = "openai" | "anthropic" | "deepseek"

export interface ModelConfig {
  name: string
  provider: ProviderType
  maxTokens: number
  temperature?: number
}

// ========== 错误类型 ==========
export class ProviderError extends Data.TaggedError("ProviderError")<{
  provider: ProviderType
  statusCode?: number
  message: string
  cause?: unknown
}> {}

export class SDKNotInstalledError extends Data.TaggedError("SDKNotInstalled")<{
  provider: ProviderType
  installCommand: string
}> {
  override get message(): string {
    return `${this.provider} SDK 未安装，请运行 \`${this.installCommand}\` 安装`
  }
}

export class AuthError extends Data.TaggedError("AuthError")<{
  provider: ProviderType
  message: string
}> {}

// ========== 工具定义类型 ==========
export interface ToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}