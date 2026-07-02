// src/session/types.ts
// ====================================================
// Session 层：类型定义 + 服务接口 + Context.Tag
// ====================================================

import { Context, Effect, Option } from "effect"
import type { Message, ToolCall } from "../provider/types.js"

export interface SessionInfo {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  messageCount: number
  lastMessageAt: Date | null
  status: "active" | "archived" | "deleted"
  /** 工作目录路径（绝对路径），默认为 <项目>/workspace/ */
  workspace: string
  /** 所属项目 ID */
  projectId: string
}

export interface SessionWithMessagesInfo extends SessionInfo {
  messages: Message[]
}

export interface CreateSessionInput {
  title?: string
  model?: string
  temperature?: number
  userId?: string
  /** 工作目录路径（可选，不填则默认 <项目>/workspace/） */
  workspace?: string
  /** 所属项目 ID（可选，默认 __default__） */
  projectId?: string
}

// ====================================================
// 服务接口
// ====================================================

export interface SessionService {
  readonly create: (input?: CreateSessionInput) => Effect.Effect<SessionInfo, Error>
  readonly get: (id: string) => Effect.Effect<Option.Option<SessionInfo>, Error>
  readonly getWithMessages: (id: string) => Effect.Effect<Option.Option<SessionWithMessagesInfo>, Error>
  readonly list: (options?: { limit?: number; offset?: number; userId?: string; projectId?: string }) => Effect.Effect<SessionInfo[], Error>
  readonly addUserMessage: (sessionId: string, content: string) => Effect.Effect<Message, Error>
  readonly addAssistantMessage: (sessionId: string, content: string) => Effect.Effect<Message, Error>
  readonly addAssistantMessageWithToolCalls: (sessionId: string, content: string | null, toolCalls: ToolCall[]) => Effect.Effect<Message, Error>
  readonly addToolMessage: (sessionId: string, toolCallId: string, content: string) => Effect.Effect<Message, Error>
  readonly getConversationHistory: (sessionId: string) => Effect.Effect<Message[], Error>
  readonly getLastMessages: (sessionId: string, count: number) => Effect.Effect<Message[], Error>
  readonly clearMessages: (sessionId: string) => Effect.Effect<number, Error>
  readonly setTitle: (id: string, title: string) => Effect.Effect<void, Error>
  readonly updateWorkspace: (id: string, workspace: string) => Effect.Effect<void, Error>
  readonly delete: (id: string) => Effect.Effect<void, Error>
  readonly archive: (id: string) => Effect.Effect<void, Error>
}

export class Session extends Context.Tag("Session")<Session, SessionService>() {}
