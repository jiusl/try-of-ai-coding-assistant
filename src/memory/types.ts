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
