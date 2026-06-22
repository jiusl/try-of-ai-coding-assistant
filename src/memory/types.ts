// src/memory/types.ts

/** 记忆类别 */
export type MemoryCategory = "preference" | "fact" | "context" | "general"

/** 持久化记忆条目 */
export interface MemoryEntry {
  id: string
  content: string
  category: MemoryCategory
  /** 重要度 0-1，越高越可能被检索到 */
  importance: number
  /** 来源会话 ID（可选） */
  sourceSessionId?: string | undefined
  /** 已被访问次数 */
  accessCount: number
  /** 最后访问时间 */
  lastAccessedAt: Date
  createdAt: Date
  updatedAt: Date
}

/** 创建记忆的输入 */
export interface CreateMemoryInput {
  content: string
  category?: MemoryCategory
  importance?: number
  sourceSessionId?: string
}

/** 检索选项 */
export interface RetrieveOptions {
  query: string
  limit?: number
  /** 语义相似度权重 (0-1)，剩余权重分配给关键词匹配和重要度 */
  semanticWeight?: number
  /** 最小相似度阈值 */
  minSimilarity?: number
}

/** 检索结果（带评分） */
export interface ScoredMemory extends MemoryEntry {
  /** 综合评分 0-1 */
  score: number
  /** 语义相似度（仅当 embedding 可用时） */
  semanticScore: number | undefined
}

/** Embedding 向量 */
export type EmbeddingVector = number[]
