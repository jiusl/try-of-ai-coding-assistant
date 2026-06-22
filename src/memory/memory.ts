// src/memory/memory.ts
import { Context, Effect, Either, Layer, Option } from "effect"
import { Database, type DatabaseService } from "../infra/database.js"
import type {
  MemoryEntry,
  CreateMemoryInput,
  MemoryCategory,
  RetrieveOptions,
  ScoredMemory,
  EmbeddingVector,
} from "./types.js"
import { EmbeddingService } from "./embedding.js"
import { cosineSimilarity, timeDecayFactor } from "./embedding.js"

// ====================================================
// 服务接口
// ====================================================

export interface MemoryService {
  /** 存储一条记忆（带去重检测） */
  readonly remember: (
    input: CreateMemoryInput,
    options?: { autoDedup?: boolean }
  ) => Effect.Effect<MemoryEntry, Error>

  /**
   * 混合检索：embedding 语义相似度 + FTS5 全文 + 重要度 + 时间衰减。
   * 当 embedding 不可用时自动降级为 FTS5 + 重要度 + 时间衰减。
   */
  readonly retrieve: (options: RetrieveOptions) => Effect.Effect<ScoredMemory[], Error>

  /** 兼容旧接口：按文本检索 */
  readonly search: (query: string, limit?: number) => Effect.Effect<ScoredMemory[], Error>

  /** 获取单条记忆（同时更新访问时间） */
  readonly get: (id: string) => Effect.Effect<Option.Option<MemoryEntry>, Error>

  /** 删除记忆 */
  readonly forget: (id: string) => Effect.Effect<void, Error>

  /** 列出所有记忆 */
  readonly list: (options?: {
    category?: MemoryCategory
    limit?: number
    offset?: number
  }) => Effect.Effect<MemoryEntry[], Error>

  /** 记忆统计 */
  readonly stats: () => Effect.Effect<MemoryStats, Error>

  /** 清理低价值记忆 */
  readonly prune: (options?: {
    minImportance?: number
    maxAgeDays?: number
    dryRun?: boolean
  }) => Effect.Effect<PruneResult, Error>
}

export class Memory extends Context.Tag("Memory")<Memory, MemoryService>() {}

// ====================================================
// 统计类型
// ====================================================

export interface MemoryStats {
  total: number
  byCategory: Record<string, number>
  avgImportance: number
  oldestEntry: Date | null
  newestEntry: Date | null
}

export interface PruneResult {
  removed: number
  kept: number
  removedIds?: string[]
}

// ====================================================
// Live Layer（SQLite + FTS5 + embedding）
// ====================================================

export const MemoryLive = Layer.effect(
  Memory,
  Effect.gen(function* () {
    const db = yield* Database
    const embeddingService = yield* EmbeddingService

    // --- 建表 ---
    // 主表：新增 access_count, last_accessed_at, embedding
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        importance REAL DEFAULT 0.5,
        source_session_id TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed_at INTEGER,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // FTS5 全文索引（内容列，无前缀索引以减少体积）
    yield* db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content_rowid='rowid',
        tokenize='unicode61'
      )
    `)

    // 尝试对已有数据做迁移（补加新列，如果旧表无此列）
    // 必须在索引创建之前执行，否则旧表缺失列会导致索引创建失败
    yield* migrateSchema(db)

    // 普通索引
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)`)
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)`)
    yield* Effect.either(db.run(`CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed_at)`))
    yield* db.run(`CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at)`)

    // --- 辅助函数 ---
    const generateId = () => crypto.randomUUID()

    /**
     * CJK 分词：在 CJK 字符周围插入空格，使 FTS5 unicode61 能正确 tokenize
     * Bun SQLite 的 unicode61 不会自动分割 CJK，需要手动插入空格
     */
    const cjkSegment = (text: string): string =>
      text.replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, " $& ")

    /**
     * 将嵌入向量序列化为 Float32Array → Buffer → 存 BLOB
     */
    const serializeEmbedding = (vec: EmbeddingVector): Buffer =>
      Buffer.from(new Float32Array(vec).buffer)

    /**
     * 从 BLOB 反序列化为 number[]
     */
    const deserializeEmbedding = (buf: Buffer): EmbeddingVector =>
      Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))

    /**
     * 检查 embedding 是否可用（缓存结果）
     */
    let embeddingAvailable: boolean | null = null
    const checkEmbedding = (): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (embeddingAvailable !== null) return embeddingAvailable
        embeddingAvailable = yield* embeddingService.isAvailable
        return embeddingAvailable
      })

    // ====================================================
    // 去重检测：检查是否已有高度相似的记忆
    // ====================================================
    const findDuplicate = (
      content: string,
      category: MemoryCategory
    ): Effect.Effect<Option.Option<MemoryEntry>, Error> =>
      Effect.gen(function* () {
        // 策略1: FTS5 匹配——用内容的前 100 个字符做精确匹配
        // CJK 分词 + 整体短语匹配（避免 "偏好A" 与 "偏好B" 错误去重）
        const segmented = cjkSegment(content.slice(0, 100))
        const escaped = segmented.replace(/['"]/g, "").replace(/[*()\/+\-~!@#$%^&:;<>?[\]{}|\\]/g, " ").replace(/\s+/g, " ").trim()
        if (escaped.length === 0) return Option.none()
        const ftsQuery = `"${escaped}"`
        const rows = yield* db.query<MemoryRow>(
          `SELECT m.* FROM memories m
           JOIN memories_fts fts ON m.rowid = fts.rowid
           WHERE memories_fts MATCH ? AND m.category = ?
           LIMIT 1`,
          [ftsQuery, category]
        )
        if (rows.length > 0) {
          return Option.some(toMemory(rows[0]!))
        }
        return Option.none()
      })

    // ====================================================
    // 存储记忆（带去重 + embedding 生成）
    // ====================================================
    const remember = (
      input: CreateMemoryInput,
      options?: { autoDedup?: boolean }
    ) =>
      Effect.gen(function* () {
        const category = input.category ?? "general"
        const importance = Math.min(1, Math.max(0, input.importance ?? 0.5))
        const autoDedup = options?.autoDedup ?? true

        // 去重检查
        if (autoDedup) {
          const dup = yield* findDuplicate(input.content, category)
          if (Option.isSome(dup)) {
            // 更新重要度（取最大值）和访问时间，手动同步 FTS5
            const existing = dup.value
            const newImportance = Math.max(existing.importance, importance)
            const now = Date.now()
            yield* db.run(
              `UPDATE memories SET importance = ?, updated_at = ?, last_accessed_at = ?, access_count = access_count + 1
               WHERE id = ?`,
              [newImportance, now, now, existing.id]
            )
            // 手动同步 FTS5（INSERT OR REPLACE = overwrite if exists）
            yield* db.run(
              `INSERT OR REPLACE INTO memories_fts (rowid, content)
               VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)`,
              [existing.id, cjkSegment(input.content)]
            )
            return {
              ...existing,
              importance: newImportance,
              accessCount: existing.accessCount + 1,
              lastAccessedAt: new Date(now),
              updatedAt: new Date(now),
            } satisfies MemoryEntry
          }
        }

        // 生成 embedding（异步，不阻塞写入）
        let embeddingBuf: Buffer | null = null
        const embAvailable = yield* checkEmbedding()
        if (embAvailable) {
          const embResult = yield* Effect.either(embeddingService.embed(input.content))
          if (Either.isRight(embResult)) {
            embeddingBuf = serializeEmbedding(embResult.right)
          }
        }

        const id = generateId()
        const now = Date.now()

        yield* db.run(
          `INSERT INTO memories (id, content, category, importance, source_session_id,
           access_count, last_accessed_at, embedding, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            id, input.content, category, importance,
            input.sourceSessionId ?? null, now,
            embeddingBuf, now, now,
          ]
        )

        // 手动同步 FTS5 索引（CJK 分词后存入，确保 Bun SQLite 可检索）
        yield* db.run(
          `INSERT OR REPLACE INTO memories_fts (rowid, content)
           VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)`,
          [id, cjkSegment(input.content)]
        )

        return {
          id,
          content: input.content,
          category,
          importance,
          sourceSessionId: input.sourceSessionId ?? undefined,
          accessCount: 1,
          lastAccessedAt: new Date(now),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        } satisfies MemoryEntry
      })

    // ====================================================
    // 混合检索：embedding + FTS5 + importance + 时间衰减
    // ====================================================
    const retrieve = (options: RetrieveOptions): Effect.Effect<ScoredMemory[], Error> =>
      Effect.gen(function* () {
        const { query, limit = 10, semanticWeight = 0.6, minSimilarity = 0.1 } = options

        // 1. FTS5 全文搜索（始终可用）
        // CJK 分词后拆分，确保 Bun SQLite 能检索中文
        const ftsQuery = cjkSegment(query)
          .split(/\s+/)
          .filter(k => k.length > 0)
          .map(k => k.replace(/[*()\/+\-~!@#$%^&:;<>?[\]{}|\\]/g, "").trim())
          .filter(k => k.length > 0)
          .join(" OR ")

        let rows: MemoryRow[]
        if (ftsQuery.length > 0) {
          rows = yield* db.query<MemoryRow>(
            `SELECT m.* FROM memories m
             JOIN memories_fts fts ON m.rowid = fts.rowid
             WHERE memories_fts MATCH ?
             ORDER BY m.importance DESC, m.updated_at DESC
             LIMIT ?`,
            [ftsQuery, limit * 2] // 多取一些用于 rerank
          )
        } else {
          // 空查询：返回高重要度记忆
          rows = yield* db.query<MemoryRow>(
            `SELECT * FROM memories
             ORDER BY importance DESC, last_accessed_at DESC
             LIMIT ?`,
            [limit * 2]
          )
        }

        if (rows.length === 0) return []

        // 2. 尝试 embedding 语义检索
        const embAvailable = yield* checkEmbedding()
        let queryEmbedding: number[] | null = null

        if (embAvailable) {
          const embResult = yield* Effect.either(embeddingService.embed(query))
          if (Either.isRight(embResult)) {
            queryEmbedding = embResult.right
          }
        }

        // 3. 混合评分
        type ScoredRow = MemoryRow & { score: number; semanticScore?: number }
        const scored: ScoredRow[] = rows.map(row => {
          let score = 0

          // 重要度权重 (0-1)
          const importanceScore = row.importance

          // 时间衰减 (0-1)
          const accessedAt = row.last_accessed_at ?? row.updated_at
          const decayScore = timeDecayFactor(new Date(accessedAt))

          if (queryEmbedding && row.embedding) {
            // 混合模式：语义 + 重要度 + 时间衰减
            const rowEmb = deserializeEmbedding(row.embedding as unknown as Buffer)
            const semanticScore = cosineSimilarity(queryEmbedding, rowEmb)
            if (semanticScore < minSimilarity) return { ...row, score: -1, semanticScore }

            const semanticW = semanticWeight
            const impW = (1 - semanticW) * 0.6
            const decayW = (1 - semanticW) * 0.4

            score = semanticW * semanticScore + impW * importanceScore + decayW * decayScore
            return { ...row, score, semanticScore }
          } else {
            // 降级模式：重要度 + 时间衰减
            score = 0.65 * importanceScore + 0.35 * decayScore
            return { ...row, score }
          }
        })

        // 过滤低分 + 排序 + 截断
        const result = scored
          .filter(s => s.score >= 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)

        // 批量更新访问统计
        const resultIds = result.map(r => r.id)
        if (resultIds.length > 0) {
          const now = Date.now()
          const placeholders = resultIds.map(() => "?").join(",")
          yield* db.run(
            `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?
             WHERE id IN (${placeholders})`,
            [now, ...resultIds]
          )
        }

        return result.map(r => ({
          ...toMemory(r),
          score: r.score,
          semanticScore: r.semanticScore,
          accessCount: r.access_count + 1, // 反映本次访问
          lastAccessedAt: new Date(Date.now()),
        } satisfies ScoredMemory))
      })

    // ====================================================
    // 兼容旧接口
    // ====================================================
    const search = (query: string, limit = 10): Effect.Effect<ScoredMemory[], Error> =>
      retrieve({ query, limit, semanticWeight: 0.6 })

    // ====================================================
    // 获取单条记忆
    // ====================================================
    const get = (id: string) =>
      Effect.gen(function* () {
        const rows = yield* db.query<MemoryRow>(
          `SELECT * FROM memories WHERE id = ? LIMIT 1`, [id]
        )
        if (rows.length === 0) return Option.none()
        // 更新访问统计
        const now = Date.now()
        yield* db.run(
          `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`,
          [now, id]
        )
        const entry = toMemory(rows[0]!)
        return Option.some({
          ...entry,
          accessCount: entry.accessCount + 1,
          lastAccessedAt: new Date(now),
        } satisfies MemoryEntry)
      })

    // ====================================================
    // 删除记忆
    // ====================================================
    const forget = (id: string) =>
      Effect.gen(function* () {
        // 先清理 FTS5 索引（此时 row 还在）
        yield* db.run(
          `DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`,
          [id]
        )
        yield* db.run(`DELETE FROM memories WHERE id = ?`, [id])
      })

    // ====================================================
    // 列出所有记忆
    // ====================================================
    const list = (options?: {
      category?: MemoryCategory
      limit?: number
      offset?: number
    }) =>
      Effect.gen(function* () {
        const limit = options?.limit ?? 50
        const offset = options?.offset ?? 0

        if (options?.category) {
          const rows = yield* db.query<MemoryRow>(
            `SELECT * FROM memories WHERE category = ?
             ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
            [options.category, limit, offset]
          )
          return rows.map(toMemory)
        }

        const rows = yield* db.query<MemoryRow>(
          `SELECT * FROM memories ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
          [limit, offset]
        )
        return rows.map(toMemory)
      })

    // ====================================================
    // 记忆统计
    // ====================================================
    const stats = (): Effect.Effect<MemoryStats, Error> =>
      Effect.gen(function* () {
        const countRows = yield* db.query<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM memories`
        )
        const catRows = yield* db.query<{ category: string; cnt: number }>(
          `SELECT category, COUNT(*) as cnt FROM memories GROUP BY category`
        )
        const avgRows = yield* db.query<{ avg: number }>(
          `SELECT AVG(importance) as avg FROM memories`
        )
        const rangeRows = yield* db.query<{
          min_ts: number | null
          max_ts: number | null
        }>(
          `SELECT MIN(created_at) as min_ts, MAX(updated_at) as max_ts FROM memories`
        )

        const byCategory: Record<string, number> = {}
        for (const r of catRows) {
          byCategory[r.category] = r.cnt
        }

        return {
          total: countRows[0]?.cnt ?? 0,
          byCategory,
          avgImportance: Math.round((avgRows[0]?.avg ?? 0) * 100) / 100,
          oldestEntry: rangeRows[0]?.min_ts ? new Date(rangeRows[0].min_ts) : null,
          newestEntry: rangeRows[0]?.max_ts ? new Date(rangeRows[0].max_ts) : null,
        }
      })

    // ====================================================
    // 清理低价值记忆
    // ====================================================
    const prune = (options?: {
      minImportance?: number
      maxAgeDays?: number
      dryRun?: boolean
    }): Effect.Effect<PruneResult, Error> =>
      Effect.gen(function* () {
        const minImp = options?.minImportance ?? 0.15
        const maxAgeDays = options?.maxAgeDays ?? 90
        const dryRun = options?.dryRun ?? false
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

        // 查询符合条件的记忆：低重要度 + 长期未访问
        const toRemove = yield* db.query<{ id: string }>(
          `SELECT id FROM memories
           WHERE importance < ? AND (last_accessed_at < ? OR (last_accessed_at IS NULL AND updated_at < ?))
           AND access_count < 3`,
          [minImp, cutoff, cutoff]
        )

        if (!dryRun && toRemove.length > 0) {
          const placeholders = toRemove.map(() => "?").join(",")
          const ids = toRemove.map(r => r.id)
          yield* db.run(
            `DELETE FROM memories WHERE id IN (${placeholders})`,
            ids
          )
          // 同步清理 FTS5
          yield* db.run(
            `DELETE FROM memories_fts WHERE rowid NOT IN (SELECT rowid FROM memories)`
          )
        }

        const totalRows = yield* db.query<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM memories`
        )

        return {
          removed: toRemove.length,
          kept: (totalRows[0]?.cnt ?? 0),
          ...(dryRun ? { removedIds: toRemove.map(r => r.id) } : {}),
        }
      })

    return { remember, retrieve, search, get, forget, list, stats, prune }
  })
)

// ====================================================
// 辅助函数
// ====================================================

interface MemoryRow {
  id: string
  content: string
  category: string
  importance: number
  source_session_id: string | null
  access_count: number
  last_accessed_at: number | null
  embedding: Buffer | null
  created_at: number
  updated_at: number
}

const toMemory = (row: MemoryRow): MemoryEntry => ({
  id: row.id,
  content: row.content,
  category: row.category as MemoryCategory,
  importance: row.importance,
  sourceSessionId: row.source_session_id ?? undefined,
  accessCount: row.access_count,
  lastAccessedAt: row.last_accessed_at
    ? new Date(row.last_accessed_at)
    : new Date(row.created_at),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
})

// --- 迁移辅助：为旧表补加新列 + 清理旧 FTS5 触发器 ---
const migrateSchema = (db: DatabaseService): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    // 尝试添加新列，如果已存在则忽略错误
    const newColumns = [
      `ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0`,
      `ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER`,
      `ALTER TABLE memories ADD COLUMN embedding BLOB`,
    ]
    for (const sql of newColumns) {
      yield* Effect.either(db.run(sql))
    }

    // 删除旧版 FTS5 触发器（Bun SQLite 不兼容 FTS5 触发器，改为手动同步）
    // 这些触发器仅在从旧版本迁移时需要清理
    const oldTriggers = [
      `DROP TRIGGER IF EXISTS memories_ai`,
      `DROP TRIGGER IF EXISTS memories_ad`,
      `DROP TRIGGER IF EXISTS memories_au`,
    ]
    for (const sql of oldTriggers) {
      yield* Effect.either(db.run(sql))
    }
  })


