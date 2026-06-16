// src/memory/memory.ts
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "../infra/database.js"
import type { MemoryEntry, CreateMemoryInput, MemoryCategory } from "./types.js"

// ====================================================
// 服务接口
// ====================================================

export interface MemoryService {
  /** 存储一条记忆 */
  readonly remember: (input: CreateMemoryInput) => Effect.Effect<MemoryEntry, Error>

  /** 按关键词检索记忆（模糊匹配，返回按重要度+时间排序的结果） */
  readonly retrieve: (query: string, limit?: number) => Effect.Effect<MemoryEntry[], Error>

  /** 获取单条记忆 */
  readonly get: (id: string) => Effect.Effect<Option.Option<MemoryEntry>, Error>

  /** 删除记忆 */
  readonly forget: (id: string) => Effect.Effect<void, Error>

  /** 列出所有记忆 */
  readonly list: (options?: { category?: MemoryCategory; limit?: number }) => Effect.Effect<MemoryEntry[], Error>
}

export class Memory extends Context.Tag("Memory")<Memory, MemoryService>() {}

// ====================================================
// Live Layer（使用 SQLite）
// ====================================================

export const MemoryLive = Layer.effect(
  Memory,
  Effect.gen(function* () {
    const db = yield* Database

    // 创建 memories 表
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        importance REAL DEFAULT 0.5,
        source_session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // 索引
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)`)
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)`)
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at)`)

    const generateId = () => crypto.randomUUID()

    // ====================================================
    // 存储记忆
    // ====================================================
    const remember = (input: CreateMemoryInput) =>
      Effect.gen(function* () {
        const id = generateId()
        const now = Date.now()
        const category = input.category ?? "general"
        const importance = Math.min(1, Math.max(0, input.importance ?? 0.5))

        yield* db.run(
          `INSERT INTO memories (id, content, category, importance, source_session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, input.content, category, importance, input.sourceSessionId ?? null, now, now]
        )

        return {
          id,
          content: input.content,
          category,
          importance,
          sourceSessionId: input.sourceSessionId ?? undefined,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        } satisfies MemoryEntry
      })

    // ====================================================
    // 检索记忆 — 关键词 LIKE 匹配 + 按重要度×时间衰减排序
    // ====================================================
    const retrieve = (query: string, limit = 10) =>
      Effect.gen(function* () {
        // 将 query 拆成关键词，每个词做 LIKE 匹配
        const keywords = query
          .split(/\s+/)
          .filter(k => k.length > 0)
          .map(k => k.replace(/[%_]/g, "\\$&")) // 转义 LIKE 通配符

        if (keywords.length === 0) {
          // 空查询返回最近的高重要度记忆
          const rows = yield* db.query<MemoryRow>(
            `SELECT id, content, category, importance, source_session_id, created_at, updated_at
             FROM memories
             ORDER BY importance DESC, updated_at DESC
             LIMIT ?`,
            [limit]
          )
          return rows.map(toMemory)
        }

        // 构建 WHERE 子句：每个 keyword 对 content 做 LIKE 匹配，OR 连接
        const conditions = keywords.map(() => `content LIKE ? COLLATE NOCASE`).join(" OR ")
        const params = keywords.map(k => `%${k}%`)

        const rows = yield* db.query<MemoryRow>(
          `SELECT id, content, category, importance, source_session_id, created_at, updated_at
           FROM memories
           WHERE ${conditions}
           ORDER BY importance DESC, updated_at DESC
           LIMIT ?`,
          [...params, limit]
        )

        return rows.map(toMemory)
      })

    // ====================================================
    // 获取单条记忆
    // ====================================================
    const get = (id: string) =>
      Effect.gen(function* () {
        const rows = yield* db.query<MemoryRow>(
          `SELECT id, content, category, importance, source_session_id, created_at, updated_at
           FROM memories WHERE id = ? LIMIT 1`,
          [id]
        )
        if (rows.length === 0) return Option.none()
        return Option.some(toMemory(rows[0]!))
      })

    // ====================================================
    // 删除记忆
    // ====================================================
    const forget = (id: string) =>
      Effect.gen(function* () {
        yield* db.run(`DELETE FROM memories WHERE id = ?`, [id])
      })

    // ====================================================
    // 列出所有记忆
    // ====================================================
    const list = (options?: { category?: MemoryCategory; limit?: number }) =>
      Effect.gen(function* () {
        const limit = options?.limit ?? 50

        if (options?.category) {
          const rows = yield* db.query<MemoryRow>(
            `SELECT id, content, category, importance, source_session_id, created_at, updated_at
             FROM memories WHERE category = ?
             ORDER BY updated_at DESC LIMIT ?`,
            [options.category, limit]
          )
          return rows.map(toMemory)
        }

        const rows = yield* db.query<MemoryRow>(
          `SELECT id, content, category, importance, source_session_id, created_at, updated_at
           FROM memories ORDER BY updated_at DESC LIMIT ?`,
          [limit]
        )
        return rows.map(toMemory)
      })

    return { remember, retrieve, get, forget, list }
  })
)

// ====================================================
// 辅助
// ====================================================

interface MemoryRow {
  id: string
  content: string
  category: string
  importance: number
  source_session_id: string | null
  created_at: number
  updated_at: number
}

const toMemory = (row: MemoryRow): MemoryEntry => ({
  id: row.id,
  content: row.content,
  category: row.category as MemoryCategory,
  importance: row.importance,
  sourceSessionId: row.source_session_id ?? undefined,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
})
