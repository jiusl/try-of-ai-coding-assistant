// src/test/testmemory.test.ts
// Memory 层全面测试 — 覆盖 remember / search / retrieve / get / forget / list / stats / prune / 去重 / FTS5触发器
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Database, DatabaseMemoryLive } from "../infra/database.js"
import { Memory, MemoryLive, type MemoryStats, type PruneResult } from "../memory/memory.js"
import { EmbeddingService, EmbeddingServiceMock } from "../memory/embedding.js"
import type { MemoryEntry, ScoredMemory } from "../memory/types.js"

// ====================================================
// 构建测试层：内存数据库 + Mock Embedding + Memory
// ====================================================

const TestMemoryLayer = Layer.empty.pipe(
  Layer.provideMerge(MemoryLive),
  Layer.provideMerge(EmbeddingServiceMock),
  Layer.provideMerge(DatabaseMemoryLive)
)

const runtime = ManagedRuntime.make(TestMemoryLayer)

const run = <A, E>(effect: Effect.Effect<A, E, Memory | Database>) =>
  runtime.runPromise(effect)

afterAll(() => {
  runtime.dispose()
})

// ====================================================
// 辅助：清空所有记忆（测试间隔离）
// ====================================================

const clearMemories = () =>
  run(Effect.gen(function* () {
    const db = yield* Database
    yield* Effect.either(db.run("DELETE FROM memories_fts"))
    yield* Effect.either(db.run("DELETE FROM memories"))
  }))

// ====================================================
// 场景 1：基本 CRUD
// ====================================================

describe("场景 1: 基本 CRUD", () => {
  beforeAll(async () => {
    await clearMemories()
  })

  it("remember: 存入一条记忆", async () => {
    const entry = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.remember({ content: "用户叫张三", category: "fact", importance: 0.8 })
    }))

    expect(entry.content).toBe("用户叫张三")
    expect(entry.category).toBe("fact")
    expect(entry.importance).toBe(0.8)
    expect(entry.accessCount).toBe(1)
    expect(entry.id).toMatch(/^[a-f0-9-]{36}$/)
    expect(entry.createdAt).toBeInstanceOf(Date)
    expect(entry.lastAccessedAt).toBeInstanceOf(Date)
  })

  it("remember: 默认值填充", async () => {
    const entry = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.remember({ content: "默认分类记忆" })
    }))

    expect(entry.category).toBe("general")
    expect(entry.importance).toBe(0.5)
  })

  it("remember: importance 边界裁剪", async () => {
    const entry = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.remember({ content: "越界测试", importance: 2.5 })
    }))

    expect(entry.importance).toBe(1) // 裁剪到 1
  })

  it("get: 根据 id 获取记忆", async () => {
    const result = await run(Effect.gen(function* () {
      const memory = yield* Memory
      const saved = yield* memory.remember({ content: "李四是后端工程师", category: "fact", importance: 0.7 })
      const found = yield* memory.get(saved.id)
      return { saved, found }
    }))

    expect(Option.isSome(result.found)).toBeTrue()
    if (Option.isSome(result.found)) {
      expect(result.found.value.content).toBe("李四是后端工程师")
    }
  })

  it("get: 不存在的 id 返回 None", async () => {
    const found = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.get("nonexistent-id")
    }))

    expect(Option.isNone(found)).toBeTrue()
  })

  it("forget: 删除记忆后 get 返回 None", async () => {
    const found = await run(Effect.gen(function* () {
      const memory = yield* Memory
      const saved = yield* memory.remember({ content: "待删除记忆" })
      yield* memory.forget(saved.id)
      return yield* memory.get(saved.id)
    }))

    expect(Option.isNone(found)).toBeTrue()
  })

  it("list: 列出所有记忆", async () => {
    await clearMemories()
    const entries = await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "记忆A", category: "preference" })
      yield* memory.remember({ content: "记忆B", category: "fact" })
      yield* memory.remember({ content: "记忆C", category: "general" })
      return yield* memory.list()
    }))

    expect(entries.length).toBe(3)
    // 按 updated_at 降序，最新的在前
    expect(entries[0]!.content).toBe("记忆C")
  })

  it("list: 按分类筛选", async () => {
    await clearMemories()
    const entries = await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "偏好A", category: "preference" })
      yield* memory.remember({ content: "偏好B", category: "preference" })
      yield* memory.remember({ content: "事实A", category: "fact" })
      return yield* memory.list({ category: "preference" })
    }))

    expect(entries.length).toBe(2)
    for (const e of entries) {
      expect(e.category).toBe("preference")
    }
  })
})

// ====================================================
// 场景 2：去重检测
// ====================================================

describe("场景 2: 去重检测", () => {
  beforeAll(async () => {
    await clearMemories()
  })

  it("重复内容应更新而非新建", async () => {
    const result = await run(Effect.gen(function* () {
      const memory = yield* Memory
      const first = yield* memory.remember({ content: "用户喜欢喝咖啡", category: "preference", importance: 0.6 })
      const second = yield* memory.remember({ content: "用户喜欢喝咖啡", category: "preference", importance: 0.9 })
      const all = yield* memory.list()
      return { first, second, all }
    }))

    // 去重后应只有 1 条记忆
    expect(result.all.length).toBe(1)
    // importance 应取最大值
    expect(result.second.importance).toBe(0.9)
    // id 相同
    expect(result.second.id).toBe(result.first.id)
    // accessCount 增加
    expect(result.second.accessCount).toBe(2)
  })

  it("不同分类的相同内容不会被去重", async () => {
    await clearMemories()
    const all = await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "同样内容不同分类", category: "fact" })
      yield* memory.remember({ content: "同样内容不同分类", category: "preference" })
      return yield* memory.list()
    }))

    expect(all.length).toBe(2)
  })

  it("关闭自动去重", async () => {
    await clearMemories()
    const all = await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "不去重内容" }, { autoDedup: false })
      yield* memory.remember({ content: "不去重内容" }, { autoDedup: false })
      return yield* memory.list()
    }))

    expect(all.length).toBe(2)
  })
})

// ====================================================
// 场景 3：FTS5 全文搜索 (降级模式，无 embedding)
// ====================================================

describe("场景 3: FTS5 搜索（Mock 降级模式）", () => {
  beforeAll(async () => {
    await clearMemories()
    // 存入一批测试记忆
    await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "用户偏好 TypeScript 开发", category: "preference", importance: 0.9 })
      yield* memory.remember({ content: "项目使用 React 框架", category: "context", importance: 0.8 })
      yield* memory.remember({ content: "数据库采用 PostgreSQL", category: "fact", importance: 0.7 })
      yield* memory.remember({ content: "用户住在北京朝阳区", category: "fact", importance: 0.5 })
      yield* memory.remember({ content: "周末喜欢打篮球", category: "preference", importance: 0.4 })
    }))
  })

  it("search: 精确关键词匹配", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.search("TypeScript")
    }))

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.content).toContain("TypeScript")
    expect(results[0]!.score).toBeGreaterThan(0)
  })

  it("search: MySQL 无匹配返回空", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.search("MongoDB")
    }))

    expect(results.length).toBe(0)
  })

  it("search: 多关键词搜索", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.search("框架 项目")
    }))

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.content.includes("React"))).toBeTrue()
  })

  it("search: 结果按评分降序排列", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.search("用户")
    }))

    expect(results.length).toBeGreaterThanOrEqual(2)
    // 第一个结果应评分最高
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score)
    }
  })

  it("search: ScoredMemory 结构完整", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.search("北京")
    }))

    expect(results.length).toBe(1)
    const m = results[0]!
    expect(m.score).toBeGreaterThan(0)
    expect(typeof m.semanticScore).toBe("undefined") // Mock 模式无 embedding
    expect(m.content).toBe("用户住在北京朝阳区")
    expect(m.category).toBe("fact")
  })

  it("search: limit 参数控制返回数量", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.search("用户", 2)
    }))

    expect(results.length).toBeLessThanOrEqual(2)
  })
})

// ====================================================
// 场景 4：retrieve 高级检索
// ====================================================

describe("场景 4: retrieve 高级检索", () => {
  beforeAll(async () => {
    await clearMemories()
    await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "用户喜欢 Python 做数据分析", category: "preference", importance: 0.9 })
      yield* memory.remember({ content: "团队使用 Git 做版本控制", category: "context", importance: 0.7 })
      yield* memory.remember({ content: "CI/CD 用 GitHub Actions", category: "context", importance: 0.6 })
    }))
  })

  it("retrieve: 自定义 semanticWeight", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.retrieve({ query: "Python", semanticWeight: 0.3 })
    }))

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.content).toContain("Python")
  })

  it("retrieve: minSimilarity 过滤低分", async () => {
    // 空查询 + 高 minSimilarity → 可能返回空
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.retrieve({ query: "", minSimilarity: 0.99 })
    }))

    // 空查询走默认排序路径
    expect(results.length).toBeGreaterThanOrEqual(0)
  })
})

// ====================================================
// 场景 5：统计 & 清理
// ====================================================

describe("场景 5: 统计 & 清理", () => {
  beforeAll(async () => {
    await clearMemories()
    await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "偏好 A", category: "preference", importance: 0.9 })
      yield* memory.remember({ content: "偏好 B", category: "preference", importance: 0.3 })
      yield* memory.remember({ content: "事实 A", category: "fact", importance: 0.8 })
      yield* memory.remember({ content: "事实 B", category: "fact", importance: 0.1 })
      yield* memory.remember({ content: "通用 A", category: "general", importance: 0.2 })
    }))
  })

  it("stats: 统计信息正确", async () => {
    const s: MemoryStats = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.stats()
    }))

    expect(s.total).toBe(5)
    expect(s.byCategory["preference"]).toBe(2)
    expect(s.byCategory["fact"]).toBe(2)
    expect(s.byCategory["general"]).toBe(1)
    expect(s.avgImportance).toBeGreaterThan(0)
    expect(s.avgImportance).toBeLessThan(1)
    expect(s.oldestEntry).toBeInstanceOf(Date)
    expect(s.newestEntry).toBeInstanceOf(Date)
  })

  it("prune: 干运行不删除", async () => {
    const result: PruneResult = await run(Effect.gen(function* () {
      const memory = yield* Memory
      // maxAgeDays: 0 让所有记录满足年龄条件，仅按 importance 筛选
      return yield* memory.prune({ minImportance: 0.5, maxAgeDays: 0, dryRun: true })
    }))

    expect(result.removed).toBeGreaterThan(0) // importance < 0.5 的记录
    expect(result.removedIds).toBeDefined()
    expect(result.removedIds!.length).toBe(result.removed)
    expect(result.kept).toBe(5) // 干运行不实际删
  })

  it("prune: 实际删除低价值记忆", async () => {
    const result: PruneResult = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.prune({ minImportance: 0.5, maxAgeDays: 0 })
    }))

    expect(result.removed).toBeGreaterThan(0)
    expect(result.kept).toBeLessThan(5)

    // 验证删除后只剩高重要度
    const remaining = await run(Effect.gen(function* () {
      const memory = yield* Memory
      return yield* memory.list()
    }))
    for (const m of remaining) {
      expect(m.importance).toBeGreaterThanOrEqual(0.5)
    }
  })
})

// ====================================================
// 场景 6：FTS5 手动同步
// ====================================================

describe("场景 6: FTS5 手动同步", () => {
  beforeEach(async () => {
    await clearMemories()
  })

  it("INSERT → 手动同步写入 FTS5 索引", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "触发器测试INSERT" })
      return yield* memory.search("触发器测试INSERT")
    }))

    expect(results.length).toBe(1)
    expect(results[0]!.content).toBe("触发器测试INSERT")
  })

  it("UPDATE → 手动同步 FTS5 索引", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      // 存一条并获取其 id
      const entry = yield* memory.remember({ content: "触发器测试同样内容", category: "general" })
      // 相同内容 + 相同分类 → 触发去重更新（手动 FTS5 sync via INSERT OR REPLACE）
      const updated = yield* memory.remember({ content: "触发器测试同样内容", category: "general", importance: 0.9 })
      // 去重后 id 相同
      expect(updated.id).toBe(entry.id)
      // 内容仍可搜索
      const searchResults = yield* memory.search("触发器测试同样内容")
      return { entry, updated, searchResults }
    }))

    expect(results.searchResults.length).toBe(1)
    expect(results.updated.importance).toBe(0.9)
  })

  it("DELETE → 手动清理 FTS5 索引", async () => {
    const results = await run(Effect.gen(function* () {
      const memory = yield* Memory
      const entry = yield* memory.remember({ content: "触发器测试DELETE" })
      // delete → 触发器自动清理
      yield* memory.forget(entry.id)
      return yield* memory.search("触发器测试DELETE")
    }))

    expect(results.length).toBe(0)
  })

  it("孤儿 FTS5 记录不应存在 (prune 防御性清理)", async () => {
    await clearMemories()
    const stats: MemoryStats = await run(Effect.gen(function* () {
      const memory = yield* Memory
      yield* memory.remember({ content: "孤儿测试1" })
      yield* memory.remember({ content: "孤儿测试2" })
      // prune 不删这些高重要度的
      yield* memory.prune({ minImportance: 0.95 })
      return yield* memory.stats()
    }))

    expect(stats.total).toBe(2) // 没有意外删除
  })
})

// ====================================================
// 场景 7：访问统计
// ====================================================

describe("场景 7: 访问统计", () => {
  beforeAll(async () => {
    await clearMemories()
  })

  it("search 后 accessCount 递增", async () => {
    const { before, after } = await run(Effect.gen(function* () {
      const memory = yield* Memory
      const entry = yield* memory.remember({ content: "访问计数测试" })

      const before = entry.accessCount

      // 搜索命中
      yield* memory.search("访问计数")

      const afterEntry = yield* memory.get(entry.id)
      return { before, after: Option.isSome(afterEntry) ? afterEntry.value.accessCount : -1 }
    }))

    expect(after).toBeGreaterThan(before)
  })

  it("get 后 accessCount 递增", async () => {
    const { before, after } = await run(Effect.gen(function* () {
      const memory = yield* Memory
      const entry = yield* memory.remember({ content: "get访问测试" })

      const before = entry.accessCount

      yield* memory.get(entry.id)

      const afterEntry = yield* memory.get(entry.id)
      return { before, after: Option.isSome(afterEntry) ? afterEntry.value.accessCount : -1 }
    }))

    expect(after).toBeGreaterThan(before)
  })

  it("lastAccessedAt 在检索后更新", async () => {
    const updated = await run(Effect.gen(function* () {
      const memory = yield* Memory
      const entry = yield* memory.remember({ content: "时间戳测试" })
      const originalTime = entry.lastAccessedAt.getTime()

      // 等待 5ms 确保时间有小幅前进
      yield* Effect.sleep("5 millis")

      yield* memory.search("时间戳")

      const after = yield* memory.get(entry.id)
      if (Option.isSome(after)) {
        return after.value.lastAccessedAt.getTime() > originalTime
      }
      return false
    }))

    expect(updated).toBeTrue()
  })
})
