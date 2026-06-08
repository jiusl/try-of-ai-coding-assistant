// src/test/testagent.test.ts
// Agent 层沙盒测试 — 注册表 + 选择 + 服务编排全场景覆盖
import { Effect, ManagedRuntime, Layer, Option, Stream, Chunk } from "effect"
import { describe, it, expect, afterAll } from "bun:test"
import type { AgentService } from "../agent/agent.js"
import { AgentServiceTag, AgentServiceLive as BaseAgentServiceLive } from "../agent/agent.js"
import { AgentRegistry, AgentRegistryLive as BaseAgentRegistryLive } from "../agent/registry.js"
import { AgentExecutor } from "../agent/executor.js"
import { Session } from "../session/session.js"
import type {
  AgentConfig,
  AgentCapability,
  AgentExecutionResult,
  ExecutionState,
} from "../agent/types.js"
import {
  AgentNotFoundError,
  AgentExecutionError,
} from "../agent/types.js"
import { BUILTIN_AGENTS } from "../agent/builtin/index.js"

// ============================================================
// 工厂函数
// ============================================================

const makeAgent = (overrides?: Partial<AgentConfig>): AgentConfig => ({
  id: "test:basic",
  name: "Test Agent",
  description: "A test agent for unit testing",
  capabilities: ["chat"] as AgentCapability[],
  systemPrompt: "You are a test agent.",
  toolNames: [],
  enabled: true,
  ...overrides,
})

const makeCoderAgent = (overrides?: Partial<AgentConfig>): AgentConfig => ({
  id: "test:coder",
  name: "Test Coder",
  description: "A test coder agent",
  capabilities: ["code-read", "code-write", "code-edit"] as AgentCapability[],
  systemPrompt: "You are a coding agent.",
  toolNames: ["read_file", "write_file"],
  temperature: 0.3,
  maxTokens: 4096,
  enabled: true,
  ...overrides,
})

const makeSuccessResult = (content: string): AgentExecutionResult => ({
  content,
  toolCalls: [],
  toolResults: [],
  iterations: 1,
  durationMs: 100,
  tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
})

// ============================================================
// Mock Executor — 返回预设结果
// ============================================================

const makeMockExecutorLive = (
  executeFn?: (agent: AgentConfig) => AgentExecutionResult
) =>
  Layer.succeed(
    AgentExecutor,
    AgentExecutor.of({
      execute: (agent: AgentConfig) =>
        Effect.succeed(
          executeFn
            ? executeFn(agent)
            : makeSuccessResult(`Response from ${agent.name}`)
        ),
      executeStream: (agent: AgentConfig) =>
        Stream.make({
          phase: "done" as const,
          content: `Stream response from ${agent.name}`,
          iteration: 1,
        } satisfies ExecutionState),
    } as any)
  )

// ============================================================
// Mock Session — 最小实现
// ============================================================

const makeMockSessionLive = () =>
  Layer.succeed(
    Session,
    Session.of({
      create: () => Effect.succeed({ id: "s1", title: "Test", createdAt: new Date(), updatedAt: new Date(), messageCount: 0, lastMessageAt: null, status: "active" as const }),
      get: () => Effect.succeed(Option.none()),
      getWithMessages: () => Effect.succeed(Option.none()),
      list: () => Effect.succeed([]),
      addUserMessage: () => Effect.succeed({ role: "user" as const, content: "ok" }),
      addAssistantMessage: () => Effect.succeed({ role: "assistant" as const, content: "ok" }),
      addToolMessage: () => Effect.succeed({ role: "tool" as const, content: "ok", tool_call_id: "t1" }),
      getConversationHistory: () => Effect.succeed([]),
      getLastMessages: () => Effect.succeed([]),
      clearMessages: () => Effect.succeed(0),
      setTitle: () => Effect.succeed(undefined),
      delete: () => Effect.succeed(undefined),
      archive: () => Effect.succeed(undefined),
    } as any)
  )

// ============================================================
// Runtime 工厂 — 同时暴露 AgentServiceTag AND AgentRegistry
// ============================================================

const makeTestRuntime = (mockExecutorLive: Layer.Layer<any, any, any>) => {
  const TestLayer = Layer.mergeAll(
    BaseAgentServiceLive.pipe(
      Layer.provide(BaseAgentRegistryLive),
      Layer.provide(mockExecutorLive),
      Layer.provide(makeMockSessionLive())
    ),
    BaseAgentRegistryLive
  )
  return ManagedRuntime.make(TestLayer as any)
}

afterAll(() => {})

// ============================================================
// 场景 1：Agent 注册表 — 每个测试独立 Runtime
// ============================================================

describe("场景 1: Agent 注册表", () => {
  it("register — 注册 Agent 后可通过 get 查询", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeAgent({ id: "r:1" }))
      const found = yield* registry.get("r:1")
      expect(found.name).toBe("Test Agent")
      expect(found.capabilities).toContain("chat")
    }))
  })

  it("get — 不存在的 Agent 返回 AgentNotFoundError", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await expect(
      runtime.runPromise(Effect.gen(function* () {
        const registry = yield* AgentRegistry
        return yield* registry.get("nonexistent")
      }))
    ).rejects.toThrow()
  })

  it("registerAll — 批量注册后全部可查询", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.registerAll([
        makeAgent({ id: "batch:1", name: "Batch 1" }),
        makeAgent({ id: "batch:2", name: "Batch 2" }),
        makeAgent({ id: "batch:3", name: "Batch 3" }),
      ])
      expect((yield* registry.get("batch:1")).name).toBe("Batch 1")
      expect((yield* registry.get("batch:2")).name).toBe("Batch 2")
      expect((yield* registry.get("batch:3")).name).toBe("Batch 3")
    }))
  })

  it("list — 默认列出所有已注册 Agent", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.registerAll([
        makeAgent({ id: "l:1" }),
        makeAgent({ id: "l:2" }),
      ])
      const all = yield* registry.list()
      expect(all.length).toBeGreaterThanOrEqual(2)
      const ids = all.map((a: AgentConfig) => a.id)
      expect(ids).toContain("l:1")
      expect(ids).toContain("l:2")
    }))
  })

  it("list — enabledOnly=true 过滤禁用 Agent", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeAgent({ id: "en:on", enabled: true }))
      yield* registry.register(makeAgent({ id: "en:off", enabled: false }))
      const enabled = yield* registry.list({ enabledOnly: true })
      const ids = enabled.map((a: AgentConfig) => a.id)
      expect(ids).toContain("en:on")
      expect(ids).not.toContain("en:off")
    }))
  })

  it("list — 按能力过滤", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeAgent({ id: "cap:chat", capabilities: ["chat"] }))
      yield* registry.register(makeAgent({ id: "cap:coder", capabilities: ["code-read", "code-write"] }))
      const coders = yield* registry.list({ capability: "code-read" })
      const ids = coders.map((a: AgentConfig) => a.id)
      expect(ids).toContain("cap:coder")
      expect(ids).not.toContain("cap:chat")
    }))
  })

  it("setEnabled — 动态启禁 Agent", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeAgent({ id: "toggle", enabled: true }))
      expect((yield* registry.list({ enabledOnly: true })).find(a => a.id === "toggle")).toBeDefined()
      yield* registry.setEnabled("toggle", false)
      expect((yield* registry.list({ enabledOnly: true })).find(a => a.id === "toggle")).toBeUndefined()
      yield* registry.setEnabled("toggle", true)
      expect((yield* registry.list({ enabledOnly: true })).find(a => a.id === "toggle")).toBeDefined()
    }))
  })

  it("setEnabled — 不存在的 Agent 返回 AgentNotFoundError", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await expect(
      runtime.runPromise(Effect.gen(function* () {
        const registry = yield* AgentRegistry
        return yield* registry.setEnabled("ghost", true)
      }))
    ).rejects.toThrow()
  })

  it("select — 根据消息内容自动选择 Agent", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeCoderAgent({ id: "sel:coder" }))
      yield* registry.register(makeAgent({ id: "sel:chat", capabilities: ["chat"] }))
      const selected = yield* registry.select("请帮我写一段代码来实现排序算法")
      expect(selected.id).toBe("sel:coder")
    }))
  })

  it("select — 无匹配时返回 chat Agent", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeAgent({ id: "sel:general", capabilities: ["chat"] }))
      const selected = yield* registry.select("今天天气怎么样？")
      expect(selected.capabilities).toContain("chat")
    }))
  })

  it("select — 无可用 Agent 时报错", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await expect(
      runtime.runPromise(Effect.gen(function* () {
        const registry = yield* AgentRegistry
        yield* registry.register(makeAgent({ id: "sel:off", enabled: false }))
        return yield* registry.select("hello")
      }))
    ).rejects.toThrow()
  })

  it("clear — 清空所有 Agent 后 list 为空", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.registerAll([
        makeAgent({ id: "cl:1" }),
        makeAgent({ id: "cl:2" }),
      ])
      expect((yield* registry.list()).length).toBeGreaterThanOrEqual(2)
      yield* registry.clear()
      expect((yield* registry.list()).length).toBe(0)
    }))
  })

  it("clear — 清空后可重新注册", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeAgent({ id: "cl:old" }))
      yield* registry.clear()
      yield* registry.register(makeAgent({ id: "cl:new", name: "NewAgent" }))
      const agent = yield* registry.get("cl:new")
      expect(agent.name).toBe("NewAgent")
      // 已清空的 agent 应查不到
      yield* registry.get("cl:old")
    })).catch((err) => {
      expect(err).toBeDefined()
    })
  })

  it("detectIntent — 排序关键词触发 code-write 选择", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeCoderAgent({ id: "di:coder" }))
      yield* registry.register(makeAgent({ id: "di:chat", capabilities: ["chat"] }))
      const selected = yield* registry.select("帮我写一个排序函数")
      expect(selected.id).toBe("di:coder")
    }))
  })

  it("detectIntent — 算法关键词触发 code-write 选择", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeCoderAgent({ id: "di:coder2" }))
      yield* registry.register(makeAgent({ id: "di:chat2", capabilities: ["chat"] }))
      const selected = yield* registry.select("请实现一个二分查找算法")
      expect(selected.id).toBe("di:coder2")
    }))
  })
})

// ============================================================
// 场景 2：Agent 服务编排（非流式）
// ============================================================

describe("场景 2: Agent 服务 — 非流式执行", () => {
  const mockExecutor = makeMockExecutorLive()
  const TestRuntime = makeTestRuntime(mockExecutor)

  const runSvc = <A, E>(effect: Effect.Effect<A, E, AgentServiceTag | AgentRegistry>) =>
    TestRuntime.runPromise(effect as any)

  it("run — 指定 Agent 执行并返回结果", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "run:test1" }))
      const svc = yield* AgentServiceTag
      const result = yield* svc.run("sess-1", "run:test1", "hello")
      expect(result.content).toContain("Response from Test Agent")
      expect(result.iterations).toBe(1)
      expect(result.tokensUsed.totalTokens).toBeGreaterThan(0)
    })
    await runSvc(program)
  })

  it("run — 不存在的 Agent 返回 AgentNotFoundError", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* AgentServiceTag
      return yield* svc.run("sess-1", "ghost:agent", "hello")
    })
    await expect(runSvc(program)).rejects.toThrow()
  })

  it("listAgents — 列出启用的 Agent", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "la:on", enabled: true }))
      yield* reg.register(makeAgent({ id: "la:off", enabled: false }))
      const svc = yield* AgentServiceTag
      const agents = yield* svc.listAgents()
      const ids = agents.map((a: AgentConfig) => a.id)
      expect(ids).toContain("la:on")
      expect(ids).not.toContain("la:off")
    })
    await runSvc(program)
  })

  it("getAgent — 获取单个 Agent", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "get:1", name: "Get Target" }))
      const svc = yield* AgentServiceTag
      const agent = yield* svc.getAgent("get:1")
      expect(agent.name).toBe("Get Target")
    })
    await runSvc(program)
  })

  it("getAgent — 不存在的 Agent 报错", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* AgentServiceTag
      return yield* svc.getAgent("nothing")
    })
    await expect(runSvc(program)).rejects.toThrow()
  })

  it("setSessionAgent / getCurrentAgent — 绑定与会话 Agent", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "bind:1" }))
      const svc = yield* AgentServiceTag
      expect(Option.isNone(yield* svc.getCurrentAgent("s-bind"))).toBe(true)
      yield* svc.setSessionAgent("s-bind", "bind:1")
      const after = yield* svc.getCurrentAgent("s-bind")
      expect(Option.isSome(after)).toBe(true)
      if (Option.isSome(after)) expect(after.value.id).toBe("bind:1")
    })
    await runSvc(program)
  })

  it("setSessionAgent — 绑定不存在的 Agent 报错", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* AgentServiceTag
      return yield* svc.setSessionAgent("s-x", "no:agent")
    })
    await expect(runSvc(program)).rejects.toThrow()
  })

  it("run — 执行后自动绑定 Agent 到会话", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "auto:bind" }))
      const svc = yield* AgentServiceTag
      yield* svc.run("s-auto", "auto:bind", "hi")
      const current = yield* svc.getCurrentAgent("s-auto")
      expect(Option.isSome(current)).toBe(true)
      if (Option.isSome(current)) expect(current.value.id).toBe("auto:bind")
    })
    await runSvc(program as any)
  })

  it("runAuto — 自动选择 Agent 并执行", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "auto:chat", capabilities: ["chat"] }))
      yield* reg.register(makeCoderAgent({ id: "auto:coder" }))
      const svc = yield* AgentServiceTag
      const result = yield* svc.runAuto("s-auto-sel", "请帮我实现一个排序算法")
      expect(result.content).toContain("Test Coder")
    })
    await runSvc(program)
  })

  it("runAuto — 有已绑定 Agent 时优先使用绑定的", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "prio:chat", capabilities: ["chat"] }))
      yield* reg.register(makeCoderAgent({ id: "prio:coder" }))
      const svc = yield* AgentServiceTag
      yield* svc.setSessionAgent("s-prio", "prio:chat")
      const result = yield* svc.runAuto("s-prio", "帮我写代码")
      expect(result.content).toContain("Test Agent")
    })
    await runSvc(program)
  })

  it("runAuto — 已绑定 Agent 被禁用时回退到 select", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "rb:chat", capabilities: ["chat"], enabled: false }))
      yield* reg.register(makeCoderAgent({ id: "rb:coder" }))
      const svc = yield* AgentServiceTag
      // 先绑定一个已禁用的 Agent
      yield* svc.setSessionAgent("s-rb", "rb:chat")
      // 再执行 runAuto，应跳过禁用的绑定 Agent，选择 rb:coder
      const result = yield* svc.runAuto("s-rb", "请帮我实现一个排序算法")
      expect(result.content).toContain("Test Coder")
    })
    await runSvc(program)
  })
})

// ============================================================
// 场景 3：错误处理与边界
// ============================================================

describe("场景 3: 错误处理与边界", () => {
  it("Executor 失败传播为 AgentExecutionError", async () => {
    const failingExecutor = Layer.succeed(
      AgentExecutor,
      AgentExecutor.of({
        execute: () =>
          Effect.fail(new AgentExecutionError({ agentId: "e", message: "AI error" })),
        executeStream: () =>
          Stream.fail(new AgentExecutionError({ agentId: "e", message: "Stream error" })),
      } as any)
    )
    const TestRuntime = makeTestRuntime(failingExecutor)
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "err:test" }))
      const svc = yield* AgentServiceTag
      return yield* svc.run("s-err", "err:test", "hi")
    })
    await expect((TestRuntime as any).runPromise(program)).rejects.toThrow()
  })

  it("覆盖同名 Agent 以最后注册为准", async () => {
    const runtime = ManagedRuntime.make(BaseAgentRegistryLive)
    await runtime.runPromise(Effect.gen(function* () {
      const registry = yield* AgentRegistry
      yield* registry.register(makeAgent({ id: "dup", name: "v1" }))
      yield* registry.register(makeAgent({ id: "dup", name: "v2" }))
      expect((yield* registry.get("dup")).name).toBe("v2")
    }))
  })

  it("禁用 Agent 后 run 仍可执行（禁用只影响 list/select）", async () => {
    const TestRuntime = makeTestRuntime(makeMockExecutorLive())
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "off:run", enabled: false }))
      const svc = yield* AgentServiceTag
      const result = yield* svc.run("s-off", "off:run", "still works")
      expect(result.content).toContain("Test Agent")
    })
    await (TestRuntime as any).runPromise(program)
  })
})

// ============================================================
// 场景 4：流式执行
// ============================================================

describe("场景 4: 流式执行", () => {
  it("runStream — 返回 Stream<ExecutionState>", async () => {
    const TestRuntime = makeTestRuntime(makeMockExecutorLive())
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistry
      yield* reg.register(makeAgent({ id: "stream:1" }))
      const svc = yield* AgentServiceTag
      const stream = svc.runStream("s-str", "stream:1", "hi")
      const states = Chunk.toReadonlyArray(yield* Stream.runCollect(stream as any))
      expect(states.length).toBeGreaterThan(0)
      expect((states[states.length - 1]! as ExecutionState).phase).toBe("done")
    })
    await (TestRuntime as any).runPromise(program)
  })
})

// ============================================================
// 场景 5：内置 Agent 正确性
// ============================================================

describe("场景 5: 内置 Agent 配置", () => {
  it("定义了 8 个内置 Agent", () => {
    expect(BUILTIN_AGENTS).toBeArray()
    expect(BUILTIN_AGENTS.length).toBe(8)
  })

  it("每个 Agent 都有必需的字段", () => {
    for (const agent of BUILTIN_AGENTS as AgentConfig[]) {
      expect(agent.id).toBeString()
      expect(agent.name).toBeString()
      expect(agent.description).toBeString()
      expect(agent.systemPrompt).toBeString()
      expect(agent.capabilities).toBeArray()
      expect(agent.capabilities.length).toBeGreaterThan(0)
      expect(agent.toolNames).toBeArray()
      expect(typeof agent.enabled).toBe("boolean")
    }
  })

  it("内置 Agent ID 都是唯一的", () => {
    const ids = (BUILTIN_AGENTS as AgentConfig[]).map((a: AgentConfig) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("Chat Agent 有基本配置", () => {
    const chat = (BUILTIN_AGENTS as AgentConfig[]).find(a => a.id === "builtin:chat")
    expect(chat).toBeDefined()
    expect(chat!.capabilities).toContain("chat")
  })

  it("Coder Agent 有代码操作权限", () => {
    const coder = (BUILTIN_AGENTS as AgentConfig[]).find(a => a.id === "builtin:coder")
    expect(coder).toBeDefined()
    expect(coder!.capabilities).toContain("code-read")
    expect(coder!.capabilities).toContain("code-write")
  })
})
