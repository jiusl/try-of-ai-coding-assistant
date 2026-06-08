// src/test/testskill.test.ts
// Skill 层测试 — 加载器 + 注册表 + 上下文注入 + 执行器全场景覆盖
import { Effect, ManagedRuntime, Layer } from "effect"
import { describe, it, expect, afterAll } from "bun:test"
import * as path from "path"
import {
  SkillRegistry,
  SkillRegistryLive,
  SkillContextInjector,
  SkillContextInjectorLive,
  SkillLoader,
  SkillLoaderLive,
  SkillExecutor,
  SkillExecutorLive,
  SkillSystem,
  SkillSystemLive,
} from "../skill/index.js"
import type { SkillDefinition, SkillType, SkillSource } from "../skill/index.js"

// ============================================================
// 辅助函数
// ============================================================

const workspaceRoot = path.resolve(import.meta.dirname, "../..")

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "测试 Skill",
    author: "tester",
    tags: ["test", "demo"],
    category: "testing",
    type: "document" as SkillType,
    source: "builtin" as SkillSource,
    skillDir: "/fake/skills/builtin/test-skill",
    mdPath: "/fake/skills/builtin/test-skill/SKILL.md",
    content: "## 测试内容\n这是一段测试文档。",
    frontmatter: {
      name: "test-skill",
      version: "1.0.0",
      description: "测试 Skill",
      author: "tester",
      tags: ["test", "demo"],
      category: "testing",
    },
    mtime: new Date(),
    ...overrides,
  }
}

// ============================================================
// Registry 独立测试（纯逻辑，无 FS 依赖）
// ============================================================

describe("SkillRegistry", () => {
  const testLayer = SkillRegistryLive
  const runtime = ManagedRuntime.make(testLayer)
  const run = <A, E>(eff: Effect.Effect<A, E, SkillRegistry>) =>
    runtime.runPromise(eff)

  afterAll(() => runtime.dispose())

  it("初始状态：list 为空", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      return yield* reg.list()
    })
    const skills = await run(program)
    expect(skills.length).toBe(0)
  })

  it("注册并获取 Skill", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      const skill = makeSkill({ name: "my-skill" })
      yield* reg.register(skill)
      const found = yield* reg.get("my-skill")
      expect(found.name).toBe("my-skill")
      expect(found.type).toBe("document")
    })
    await run(program)
  })

  it("注册多个 Skill 并列出", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      const s1 = makeSkill({ name: "skill-a", tags: ["tag1"], category: "cat-a" })
      const s2 = makeSkill({ name: "skill-b", tags: ["tag2"], category: "cat-b" })
      yield* reg.registerAll([s1, s2])
      const list = yield* reg.list()
      expect(list.length).toBe(3) // s1, s2 + my-skill
    })
    await run(program)
  })

  it("按 source 筛选", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      const list = yield* reg.list({ source: "builtin" })
      for (const s of list) {
        expect(s.source).toBe("builtin")
      }
    })
    await run(program)
  })

  it("按 type 筛选", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      const list = yield* reg.list({ type: "document" })
      for (const s of list) {
        expect(s.type).toBe("document")
      }
    })
    await run(program)
  })

  it("按 tag 筛选", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      const list = yield* reg.list({ tag: "tag1" })
      expect(list.length).toBe(1)
      expect(list[0]!.name).toBe("skill-a")
    })
    await run(program)
  })

  it("按 category 筛选", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      const list = yield* reg.list({ category: "cat-b" })
      expect(list.length).toBe(1)
      expect(list[0]!.name).toBe("skill-b")
    })
    await run(program)
  })

  it("findByTags 按标签搜索", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      const list = yield* reg.findByTags(["tag1"])
      expect(list.length).toBe(1)
      expect(list[0]!.name).toBe("skill-a")
    })
    await run(program)
  })

  it("findByCategory 按分类搜索", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      const list = yield* reg.findByCategory("cat-b")
      expect(list.length).toBe(1)
      expect(list[0]!.name).toBe("skill-b")
    })
    await run(program)
  })

  it("获取不存在的 Skill 抛异常", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      return yield* reg.get("nonexistent")
    })
    await expect(run(program)).rejects.toThrow()
  })

  it("findByName 对不存在的返回 undefined", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      return yield* reg.findByName("nonexistent")
    })
    const found = await run(program)
    expect(found).toBeUndefined()
  })

  it("allTags 列出所有标签", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      return yield* reg.allTags()
    })
    const tags = await run(program)
    expect(tags).toContain("tag1")
    expect(tags).toContain("tag2")
  })

  it("allCategories 列出所有分类", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      return yield* reg.allCategories()
    })
    const cats = await run(program)
    expect(cats).toContain("cat-a")
    expect(cats).toContain("cat-b")
  })

  it("clear 清空所有注册", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      yield* reg.clear()
      const list = yield* reg.list()
      expect(list.length).toBe(0)
    })
    await run(program)
  })
})

// ============================================================
// ContextInjector 测试（依赖 Registry）
// ============================================================

describe("SkillContextInjector", () => {
  // provideMerge: 从 Injector 出发，merge Registry 的输出到上下文
  // 这样 Injector 构造时可获取 Registry，runtime 层也能访问 Registry
  const testLayer = SkillContextInjectorLive.pipe(
    Layer.provideMerge(SkillRegistryLive),
  )
  const runtime = ManagedRuntime.make(testLayer)
  const run = <A, E>(
    eff: Effect.Effect<A, E, SkillContextInjector | SkillRegistry>,
  ) => runtime.runPromise(eff)

  afterAll(() => runtime.dispose())

  it("buildInjection 生成正确的注入文本", async () => {
    const program = Effect.gen(function* () {
      const injector = yield* SkillContextInjector
      return injector.buildInjection(
        makeSkill({ name: "test", content: "Hello World" }),
      )
    })
    const raw = await run(program)
    expect(raw).toContain("Hello World")
    expect(raw).toContain('<skill_injection name="test"')
    expect(raw).toContain("</skill_injection>")
  })

  it("injectSkills 按名称注入", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      yield* reg.register(
        makeSkill({ name: "inj-test", content: "注入测试内容" }),
      )
      const injector = yield* SkillContextInjector
      return yield* injector.injectSkills(["inj-test"])
    })
    const result = await run(program)
    expect(result).toContain("注入测试内容")
  })

  it("injectRelevantSkills 根据消息匹配相关 Skill", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      yield* reg.registerAll([
        makeSkill({
          name: "reviewer",
          description: "代码审查工具",
          tags: ["review", "quality"],
          category: "code-quality",
        }),
        makeSkill({
          name: "builder",
          description: "项目构建工具",
          tags: ["build", "compile"],
          category: "build",
        }),
      ])
      const injector = yield* SkillContextInjector
      return yield* injector.injectRelevantSkills("帮我 review 这段代码")
    })
    const result = await run(program)
    expect(result).toContain("reviewer")
  })

  it("injectRelevantSkills 无匹配时返回空字符串", async () => {
    const program = Effect.gen(function* () {
      const injector = yield* SkillContextInjector
      return yield* injector.injectRelevantSkills("今天天气怎么样")
    })
    const result = await run(program)
    expect(result).toBe("")
  })
})

// ============================================================
// Loader 测试（需要真实 skills/ 目录）
// ============================================================

describe("SkillLoader", () => {
  const testLayer = SkillLoaderLive
  const runtime = ManagedRuntime.make(testLayer)
  const run = <A, E>(eff: Effect.Effect<A, E, SkillLoader>) =>
    runtime.runPromise(eff)

  afterAll(() => runtime.dispose())

  it("loadAll 加载 builtin 目录下的 Skill", async () => {
    const program = Effect.gen(function* () {
      const loader = yield* SkillLoader
      return yield* loader.loadAll(workspaceRoot)
    })
    const skills = await run(program)
    const names = skills.map((s) => s.name)
    expect(names).toContain("code-review")
  })

  it("加载的 Skill 包含正确的字段", async () => {
    const program = Effect.gen(function* () {
      const loader = yield* SkillLoader
      return yield* loader.loadAll(workspaceRoot)
    })
    const skills = await run(program)
    const cr = skills.find((s) => s.name === "code-review")
    expect(cr).toBeDefined()
    if (cr) {
      expect(cr.type).toBe("document")
      expect(cr.source).toBe("builtin")
      expect(cr.version).toBe("1.0.0")
      expect(cr.tags).toContain("review")
      expect(cr.category).toBe("code-quality")
      expect(cr.content.length).toBeGreaterThan(0)
      expect(cr.skillDir).toContain("code-review")
      expect(cr.mdPath).toContain("SKILL.md")
    }
  })

  it("reloadSource 重新加载指定来源", async () => {
    const program = Effect.gen(function* () {
      const loader = yield* SkillLoader
      return yield* loader.reloadSource(workspaceRoot, "builtin")
    })
    const skills = await run(program)
    const names = skills.map((s) => s.name)
    expect(names).toContain("code-review")
  })

  it("加载空目录返回空数组", async () => {
    const program = Effect.gen(function* () {
      const loader = yield* SkillLoader
      return yield* loader.reloadSource(workspaceRoot, "user")
    })
    const result = await run(program)
    expect(result.length).toBe(0)
  })
})

// ============================================================
// SkillSystem 集成测试
// ============================================================

describe("SkillSystem", () => {
  const testLayer = SkillSystemLive
  const runtime = ManagedRuntime.make(testLayer)
  const run = <A, E>(
    eff: Effect.Effect<A, E, SkillSystem>,
  ) => runtime.runPromise(eff)

  afterAll(() => runtime.dispose())

  it("initialize 加载并注册所有 Skill", async () => {
    const program = Effect.gen(function* () {
      const sys = yield* SkillSystem
      const count = yield* sys.initialize(workspaceRoot)
      // 应有 3 个 builtin: code-review, pr-template, architecture-guide
      expect(count).toBeGreaterThanOrEqual(3)
    })
    await run(program)
  })

  it("reload 重新初始化", async () => {
    const program = Effect.gen(function* () {
      const sys = yield* SkillSystem
      const count = yield* sys.reload(workspaceRoot)
      expect(count).toBeGreaterThanOrEqual(1)
    })
    await run(program)
  })
})

// ============================================================
// Executor 测试（混合型 Skill 执行）
// ============================================================

describe("SkillExecutor", () => {
  // provideMerge: 从 Executor 出发，merge Registry 的输出到上下文
  const testLayer = SkillExecutorLive.pipe(
    Layer.provideMerge(SkillRegistryLive),
  )
  const runtime = ManagedRuntime.make(testLayer)
  const run = <A, E>(
    eff: Effect.Effect<A, E, SkillExecutor | SkillRegistry>,
  ) => runtime.runPromise(eff)

  afterAll(() => runtime.dispose())

  it("isExecutable 对纯文档型返回 false", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      yield* reg.register(makeSkill({ name: "doc-skill", type: "document" }))
      const exec = yield* SkillExecutor
      return yield* exec.isExecutable("doc-skill")
    })
    const result = await run(program)
    expect(result).toBe(false)
  })

  it("isExecutable 对混合型返回 true", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      yield* reg.register(
        makeSkill({
          name: "hybrid-skill",
          type: "hybrid",
          frontmatter: {
            name: "hybrid-skill",
            version: "1.0.0",
            description: "混合型测试",
            author: "test",
            tags: [],
            category: "test",
            execution: {
              type: "script",
              entry: "./test.ts",
              timeout: 1000,
              requireConfirm: false,
            },
          },
        }),
      )
      const exec = yield* SkillExecutor
      return yield* exec.isExecutable("hybrid-skill")
    })
    const result = await run(program)
    expect(result).toBe(true)
  })

  it("execute 对纯文档型抛异常", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* SkillRegistry
      yield* reg.register(makeSkill({ name: "pure-doc", type: "document" }))
      const exec = yield* SkillExecutor
      return yield* exec.execute("pure-doc")
    })
    await expect(run(program)).rejects.toThrow()
  })
})
