// src/session/live.ts
// ====================================================
// Session 层 Live Layer（SQLite 实现 + Mock + 内存测试）
// ====================================================

import { Effect, Layer, Option } from "effect"
import { Database, DatabaseMemoryLive } from "../infra/database.js"
import type { Message, ToolCall } from "../provider/types.js"
import { Session } from "./types.js"
import type { SessionService, SessionInfo, SessionWithMessagesInfo, CreateSessionInput } from "./types.js"
import { defaultWorkspace, sanitizeWorkspace } from "../infra/workspace.js"

// ====================================================
// SessionLive — 基于 SQLite 的实现
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
        status TEXT DEFAULT 'active',
        user_id TEXT NOT NULL DEFAULT 'legacy',
        workspace TEXT NOT NULL DEFAULT ''
      )
    `)

    // 兼容旧数据库：确保 workspace 列存在
    yield* Effect.catchAll(
      db.run(`ALTER TABLE sessions ADD COLUMN workspace TEXT NOT NULL DEFAULT ''`),
      () => Effect.void
    )

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
    // 创建会话
    // ====================================================
    const create = (input?: CreateSessionInput) =>
      Effect.gen(function* () {
        const id = generateId()
        const now = Date.now()
        const title = input?.title ?? "New Conversation"

        const userId = input?.userId ?? "legacy"

        const projectId = input?.projectId ?? "__default__"
        // 如果没传 workspace 但指定了项目，用项目路径作为默认工作目录
        let workspace = input?.workspace
        if (!workspace) {
          const rows = yield* db.query<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            [projectId]
          )
          workspace = rows[0]?.path || defaultWorkspace()
        }

        yield* db.run(
          `INSERT INTO sessions (id, title, created_at, updated_at, status, user_id, workspace, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, title, now, now, "active", userId, workspace, projectId]
        )

        return {
          id,
          title,
          workspace,
          projectId,
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
          workspace: string
          project_id: string
          message_count: number
          last_message_at: number | null
        }>(
          `SELECT 
            s.id, s.title, s.created_at, s.updated_at, s.status, s.workspace, s.project_id,
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
          workspace: row.workspace || defaultWorkspace(),
          projectId: row.project_id || "__default__",
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
    const list = (options?: { limit?: number; offset?: number; userId?: string; projectId?: string }) =>
      Effect.gen(function* () {
        const limit = options?.limit ?? 50
        const offset = options?.offset ?? 0
        const userId = options?.userId
        const projectId = options?.projectId

        let sql = `
          SELECT 
            s.id,
            s.title,
            s.created_at,
            s.updated_at,
            s.status,
            s.workspace,
            s.project_id,
            COUNT(m.id) as message_count,
            MAX(m.created_at) as last_message_at
          FROM sessions s
          LEFT JOIN messages m ON s.id = m.session_id
          WHERE s.status != 'deleted'`
        const params: (string | number)[] = []

        if (userId) {
          sql += ` AND s.user_id = ?`
          params.push(userId)
        }

        if (projectId) {
          sql += ` AND s.project_id = ?`
          params.push(projectId)
        }

        sql += `
          GROUP BY s.id
          ORDER BY s.updated_at DESC
          LIMIT ? OFFSET ?`
        params.push(limit, offset)

        const rows = yield* db.query<{
          id: string
          title: string
          created_at: number
          updated_at: number
          status: string
          workspace: string
          project_id: string
          message_count: number
          last_message_at: number | null
        }>(sql, params)

        return rows.map(row => ({
          id: row.id,
          title: row.title,
          workspace: row.workspace || defaultWorkspace(),
          projectId: row.project_id || "__default__",
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          messageCount: row.message_count,
          lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
          status: row.status as "active" | "archived" | "deleted"
        }))
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

    /** 会话标题最大长度（截取首条用户消息的前 N 个字符） */
    const MAX_TITLE_LENGTH = 50

    // ====================================================
    // 添加用户消息（首条消息自动作为会话标题）
    // ====================================================
    const addUserMessage = (sessionId: string, content: string) =>
      atomic(
        Effect.gen(function* () {
          // 检查是否为第一条用户消息
          const rows = yield* db.query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND role = 'user'`,
            [sessionId]
          )
          const cnt = rows[0]?.cnt ?? 0
          // 首条用户消息：自动设为会话标题
          if (cnt === 0) {
            const title = content.length > MAX_TITLE_LENGTH
              ? content.slice(0, MAX_TITLE_LENGTH)
              : content
            yield* db.run(
              `UPDATE sessions SET title = ? WHERE id = ?`,
              [title, sessionId]
            )
          }
          // 添加消息
          const now = Date.now()
          yield* db.run(
            `INSERT INTO messages (session_id, role, content, created_at)
             VALUES (?, ?, ?, ?)`,
            [sessionId, "user", content, now]
          )
          yield* db.run(
            `UPDATE sessions SET updated_at = ? WHERE id = ?`,
            [now, sessionId]
          )
          return {
            role: "user" as const,
            content,
          } as unknown as Message
        })
      )

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
    // 更新会话工作目录
    // ====================================================
    const updateWorkspace = (id: string, workspace: string) =>
      Effect.gen(function* () {
        const ws = sanitizeWorkspace(workspace)
        yield* db.run(
          `UPDATE sessions SET workspace = ?, updated_at = ? WHERE id = ?`,
          [ws, Date.now(), id]
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
      updateWorkspace,
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
      workspace: input?.workspace || defaultWorkspace(),
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
      workspace: defaultWorkspace(),
      projectId: "__default__",
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
      workspace: defaultWorkspace(),
      projectId: "__default__",
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

  addAssistantMessageWithToolCalls: (
    sessionId: string,
    content: string | null,
    toolCalls: ToolCall[],
  ) =>
    Effect.succeed({
      role: "assistant" as const,
      content,
      tool_calls: toolCalls,
    } as Message),

  addToolMessage: (sessionId: string, toolCallId: string, content: string) =>
    Effect.succeed({ role: "tool" as const, content, tool_call_id: toolCallId } as unknown as Message),

  getConversationHistory: () => Effect.succeed([] as Message[]),

  getLastMessages: () => Effect.succeed([] as Message[]),

  clearMessages: () => Effect.succeed(0),

  setTitle: () => Effect.succeed(undefined),

  updateWorkspace: () => Effect.succeed(undefined),

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
