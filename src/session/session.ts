// src/session/session.ts
import { Context, Effect, Layer, Option } from "effect"
import { Database, DatabaseMemoryLive } from "../infra/database.js"
import type { Message, ToolCall } from "../provider/types.js"

// ====================================================
// 类型定义
// ====================================================

export interface SessionInfo {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  messageCount: number
  lastMessageAt: Date | null
  status: "active" | "archived" | "deleted"
}

export interface SessionWithMessagesInfo extends SessionInfo {
  messages: Message[]
}

export interface CreateSessionInput {
  title?: string
  model?: string
  temperature?: number
}

// ====================================================
// 服务接口
// ====================================================

export interface SessionService {
  /** 创建新会话 */
  readonly create: (input?: CreateSessionInput) => Effect.Effect<SessionInfo, Error>
  
  /** 获取会话（不含消息） */
  readonly get: (id: string) => Effect.Effect<Option.Option<SessionInfo>, Error>
  
  /** 获取会话及完整消息历史 */
  readonly getWithMessages: (id: string) => Effect.Effect<Option.Option<SessionWithMessagesInfo>, Error>
  
  /** 列出所有会话 */
  readonly list: (options?: { limit?: number; offset?: number }) => Effect.Effect<SessionInfo[], Error>
  
  /** 添加用户消息 */
  readonly addUserMessage: (sessionId: string, content: string) => Effect.Effect<Message, Error>
  
  /** 添加 AI 响应 */
  readonly addAssistantMessage: (sessionId: string, content: string) => Effect.Effect<Message, Error>
  
  /** 添加带 tool_calls 的 AI 响应（用于持久化中间迭代状态） */
  readonly addAssistantMessageWithToolCalls: (
    sessionId: string,
    content: string | null,
    toolCalls: ToolCall[]
  ) => Effect.Effect<Message, Error>
  
  /** 添加工具调用结果 */
  readonly addToolMessage: (sessionId: string, toolCallId: string, content: string) => Effect.Effect<Message, Error>
  
  /** 获取对话历史（用于发送给 AI） */
  readonly getConversationHistory: (sessionId: string) => Effect.Effect<Message[], Error>
  
  /** 获取最后 N 条消息 */
  readonly getLastMessages: (sessionId: string, count: number) => Effect.Effect<Message[], Error>
  
  /** 清空会话的所有消息 */
  readonly clearMessages: (sessionId: string) => Effect.Effect<number, Error>
  
  /** 更新会话标题 */
  readonly setTitle: (id: string, title: string) => Effect.Effect<void, Error>
  
  /** 删除会话（软删除） */
  readonly delete: (id: string) => Effect.Effect<void, Error>
  
  /** 归档会话 */
  readonly archive: (id: string) => Effect.Effect<void, Error>
}

export class Session extends Context.Tag("Session")<Session, SessionService>() {}

// ====================================================
// Live Layer（使用 SQLite）
// ====================================================

export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const db = yield* Database
    
    // 创建 sessions 表
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Conversation',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      )
    `)
    
    // 创建 messages 表
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_calls TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `)
    
    // 兼容旧数据库：确保 tool_calls 列存在
    yield* Effect.catchAll(
      db.run(`ALTER TABLE messages ADD COLUMN tool_calls TEXT`),
      () => Effect.void  // 列已存在则忽略
    )
    
    // 创建索引优化查询性能
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`)
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`)
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`)
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)`)
    
    // 生成会话 ID（使用 UUID）
    const generateId = () => crypto.randomUUID()
    
    // ====================================================
    // 创建会话
    // ====================================================
    const create = (input?: CreateSessionInput) =>
      Effect.gen(function* () {
        const id = generateId()
        const now = Date.now()
        const title = input?.title ?? "New Conversation"
        
        yield* db.run(
          `INSERT INTO sessions (id, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?)`,
          [id, title, now, now, "active"]
        )
        
        return {
          id,
          title,
          createdAt: new Date(now),
          updatedAt: new Date(now),
          messageCount: 0,
          lastMessageAt: null,
          status: "active" as const
        }
      })
    
    // ====================================================
    // 获取单个会话（不含消息）— 单次 LEFT JOIN 查询
    // ====================================================
    const get = (id: string) =>
      Effect.gen(function* () {
        const rows = yield* db.query<{
          id: string
          title: string
          created_at: number
          updated_at: number
          status: string
          message_count: number
          last_message_at: number | null
        }>(
          `SELECT 
            s.id, s.title, s.created_at, s.updated_at, s.status,
            COUNT(m.id) as message_count,
            MAX(m.created_at) as last_message_at
           FROM sessions s
           LEFT JOIN messages m ON s.id = m.session_id
           WHERE s.id LIKE (? || '%') AND s.status != 'deleted'
           GROUP BY s.id
           ORDER BY s.created_at DESC
           LIMIT 1`,
          [id]
        )
        
        const row = rows[0]
        if (!row) return Option.none()
        
        return Option.some({
          id: row.id,
          title: row.title,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          messageCount: row.message_count,
          lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
          status: row.status as "active" | "archived" | "deleted"
        })
      })
    
    // ====================================================
    // 获取会话及完整消息历史
    // ====================================================
    const getWithMessages = (id: string) =>
      Effect.gen(function* () {
        const sessionOpt = yield* get(id)
        if (Option.isNone(sessionOpt)) return Option.none()
        
        const session = sessionOpt.value
        
        const messages = yield* db.query<{
          role: string
          content: string
          tool_call_id: string | null
          tool_calls: string | null
          created_at: number
        }>(
          `SELECT role, content, tool_call_id, tool_calls, created_at 
           FROM messages 
           WHERE session_id = ? 
           ORDER BY created_at ASC, id ASC`,
          [id]
        )
        
        const lastMsg = messages[messages.length - 1]
        return Option.some({
          ...session,
          messages: messages.map(m => {
            const msg: Record<string, unknown> = {
              role: m.role as "user" | "assistant" | "tool",
              content: m.content
            }
            if (m.tool_call_id) {
              msg.tool_call_id = m.tool_call_id
            }
            if (m.tool_calls) {
              try {
                msg.tool_calls = JSON.parse(m.tool_calls)
              } catch { /* ignore */ }
            }
            return msg as unknown as Message
          }),
          messageCount: messages.length,
          lastMessageAt: lastMsg ? new Date(lastMsg.created_at) : null
        })
      })
    
    // ====================================================
    // 列出所有会话
    // ====================================================
    const list = (options?: { limit?: number; offset?: number }) =>
      Effect.gen(function* () {
        const limit = options?.limit ?? 50
        const offset = options?.offset ?? 0
        
        const rows = yield* db.query<{
          id: string
          title: string
          created_at: number
          updated_at: number
          status: string
          message_count: number
          last_message_at: number | null
        }>(
          `SELECT 
            s.id,
            s.title,
            s.created_at,
            s.updated_at,
            s.status,
            COUNT(m.id) as message_count,
            MAX(m.created_at) as last_message_at
          FROM sessions s
          LEFT JOIN messages m ON s.id = m.session_id
          WHERE s.status != 'deleted'
          GROUP BY s.id
          ORDER BY s.updated_at DESC
          LIMIT ? OFFSET ?`,
          [limit, offset]
        )
        
        return rows.map(row => ({
          id: row.id,
          title: row.title,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          messageCount: row.message_count,
          lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
          status: row.status as "active" | "archived" | "deleted"
        }))
      })
    
    // ====================================================
    // 事务辅助函数（基于 SAVEPOINT，非嵌套安全）
    // ====================================================
    const atomic = <A, E>(
      effect: Effect.Effect<A, E>
    ): Effect.Effect<A, E | Error> =>
      Effect.gen(function* () {
        yield* db.run("SAVEPOINT _sp")
        const result = yield* Effect.exit(effect)
        if (result._tag === "Failure") {
          yield* db.run("ROLLBACK TO SAVEPOINT _sp")
          return yield* Effect.failCause(result.cause) as Effect.Effect<A, E | Error>
        }
        yield* db.run("RELEASE SAVEPOINT _sp")
        return result.value as A
      })
    
    // ====================================================
    // 添加消息（内部方法）— 原子性：INSERT + UPDATE session
    // ====================================================
    const addMessage = (
      sessionId: string, 
      role: string, 
      content: string, 
      toolCallId?: string,
      toolCallsJson?: string
    ) =>
      atomic(
        Effect.gen(function* () {
          const now = Date.now()
          
          yield* db.run(
            `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [sessionId, role, content, toolCallId ?? null, toolCallsJson ?? null, now]
          )
          
          yield* db.run(
            `UPDATE sessions SET updated_at = ? WHERE id = ?`,
            [now, sessionId]
          )
          
          const message: Record<string, unknown> = {
            role: role as "user" | "assistant" | "tool",
            content
          }
          
          if (toolCallId) {
            message.tool_call_id = toolCallId
          }
          
          if (toolCallsJson) {
            try {
              message.tool_calls = JSON.parse(toolCallsJson)
            } catch { /* ignore */ }
          }
          
          return message as unknown as Message
        })
      )
    
    // ====================================================
    // 添加用户消息
    // ====================================================
    const addUserMessage = (sessionId: string, content: string) =>
      addMessage(sessionId, "user", content)
    
    // ====================================================
    // 添加 AI 响应
    // ====================================================
    const addAssistantMessage = (sessionId: string, content: string) =>
      addMessage(sessionId, "assistant", content)
    
    /** 添加带 tool_calls 的 AI 响应（持久化中间迭代状态） */
    const addAssistantMessageWithToolCalls = (
      sessionId: string,
      content: string | null,
      toolCalls: ToolCall[]
    ) =>
      addMessage(sessionId, "assistant", content ?? "", undefined, JSON.stringify(toolCalls))
    
    // ====================================================
    // 添加工具调用结果
    // ====================================================
    const addToolMessage = (sessionId: string, toolCallId: string, content: string) =>
      addMessage(sessionId, "tool", content, toolCallId)
    
    // ====================================================
    // 获取对话历史（正序，用于发送给 AI）
    // ====================================================
    const getConversationHistory = (sessionId: string) =>
      Effect.gen(function* () {
        const messages = yield* db.query<{
          role: string
          content: string
          tool_call_id: string | null
          tool_calls: string | null
        }>(
          `SELECT role, content, tool_call_id, tool_calls 
           FROM messages 
           WHERE session_id = ? 
           ORDER BY created_at ASC, id ASC`,
          [sessionId]
        )
        
        return messages.map(m => {
          const msg: Record<string, unknown> = {
            role: m.role as "user" | "assistant" | "tool",
            content: m.content
          }
          if (m.tool_call_id) {
            msg.tool_call_id = m.tool_call_id
          }
          if (m.tool_calls) {
            try {
              msg.tool_calls = JSON.parse(m.tool_calls)
            } catch { /* ignore */ }
          }
          return msg as unknown as Message
        })
      })
    
    // ====================================================
    // 获取最后 N 条消息（正序）
    // ====================================================
    const getLastMessages = (sessionId: string, count: number) =>
      Effect.gen(function* () {
        const messages = yield* db.query<{
          role: string
          content: string
          tool_call_id: string | null
          created_at: number
        }>(
          `SELECT role, content, tool_call_id, created_at 
           FROM messages 
           WHERE session_id = ? 
           ORDER BY created_at DESC, id DESC 
           LIMIT ?`,
          [sessionId, count]
        )
        
        // 反转回正序
        return messages.reverse().map(m => {
          const msg: Record<string, unknown> = {
            role: m.role as "user" | "assistant" | "tool",
            content: m.content
          }
          if (m.tool_call_id) {
            msg.tool_call_id = m.tool_call_id
          }
          return msg as unknown as Message
        })
      })
    
    // ====================================================
    // 清空会话的所有消息 — 原子性：DELETE + UPDATE session
    // ====================================================
    const clearMessages = (sessionId: string) =>
      atomic(
        Effect.gen(function* () {
          const changes = yield* db.run(
            `DELETE FROM messages WHERE session_id = ?`,
            [sessionId]
          )
          
          yield* db.run(
            `UPDATE sessions SET updated_at = ? WHERE id = ?`,
            [Date.now(), sessionId]
          )
          
          return changes
        })
      )
    
    // ====================================================
    // 更新会话标题
    // ====================================================
    const setTitle = (id: string, title: string) =>
      Effect.gen(function* () {
        yield* db.run(
          `UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`,
          [title, Date.now(), id]
        )
      })
    
    // ====================================================
    // 删除会话（软删除）
    // ====================================================
    const deleteSession = (id: string) =>
      Effect.gen(function* () {
        yield* db.run(
          `UPDATE sessions SET status = 'deleted', updated_at = ? WHERE id = ?`,
          [Date.now(), id]
        )
      })
    
    // ====================================================
    // 归档会话
    // ====================================================
    const archive = (id: string) =>
      Effect.gen(function* () {
        yield* db.run(
          `UPDATE sessions SET status = 'archived', updated_at = ? WHERE id = ?`,
          [Date.now(), id]
        )
      })
    
    // ====================================================
    // 返回服务接口
    // ====================================================
    return {
      create,
      get,
      getWithMessages,
      list,
      addUserMessage,
      addAssistantMessage,
      addAssistantMessageWithToolCalls,
      addToolMessage,
      getConversationHistory,
      getLastMessages,
      clearMessages,
      setTitle,
      delete: deleteSession,
      archive
    }
  })
)

// ====================================================
// Mock 版本（用于测试）
// ====================================================

export const SessionMockLive = Layer.succeed(Session, {
  create: (input?: CreateSessionInput) =>
    Effect.succeed({
      id: crypto.randomUUID(),
      title: input?.title ?? "Mock Session",
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: 0,
      lastMessageAt: null,
      status: "active"
    } as SessionInfo),
  
  get: (id: string) =>
    Effect.succeed(Option.some({
      id,
      title: "Mock Session",
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: 0,
      lastMessageAt: null,
      status: "active"
    } as SessionInfo)),
  
  getWithMessages: (id: string) =>
    Effect.succeed(Option.some({
      id,
      title: "Mock Session",
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: 0,
      lastMessageAt: null,
      status: "active",
      messages: []
    } as SessionWithMessagesInfo)),
  
  list: () => Effect.succeed([] as SessionInfo[]),
  
  addUserMessage: (sessionId: string, content: string) =>
    Effect.succeed({ role: "user" as const, content } as Message),
  
  addAssistantMessage: (sessionId: string, content: string) =>
    Effect.succeed({ role: "assistant" as const, content } as Message),
  
  addToolMessage: (sessionId: string, toolCallId: string, content: string) =>
    Effect.succeed({ role: "tool" as const, content, tool_call_id: toolCallId } as unknown as Message),
  
  getConversationHistory: () => Effect.succeed([] as Message[]),
  
  getLastMessages: () => Effect.succeed([] as Message[]),
  
  clearMessages: () => Effect.succeed(0),
  
  setTitle: () => Effect.succeed(undefined),
  
  delete: () => Effect.succeed(undefined),
  
  archive: () => Effect.succeed(undefined)
})

// ====================================================
// 测试用内存数据库版本
// ====================================================

export const SessionMemoryLive = Layer.provide(
  SessionLive,
  DatabaseMemoryLive
)