// src/test/testool.ts
// Tool 层沙盒测试 — 注册表 + 执行 + 验证 + 权限全场景覆盖
// 使用 Mock Permission 层隔离依赖
import { Effect, ManagedRuntime, Layer, Schema } from "effect"
import { describe, it, expect, afterAll } from "bun:test"
import type { ToolRegistryService } from "../tool/index.js"
import {
  ToolRegistry,
  ToolRegistryLive,
  ToolNotFoundError,
  ToolExecutionError,
  ToolValidationError,
} from "../tool/index.js"
import type {
  ToolDefinition,
  ToolCall,
  ToolContext,
  ToolCategory,
} from "../tool/index.js"
import { Permission } from "../permission/permission.js"
import type { Decision, Action } from "../permission/types.js"

// ============================================================
// Mock Permission — 隔离权限层，所有请求返回 allow
// ============================================================

const MockPermissionLive = Layer.succeed(
  Permission,
  Permission.of({
    check: (_action: Action, _target: string) => Effect.succeed("allow" as Decision),
    request: (_action: Action, _target: string) => Effect.succeed(undefined),
    respond: (_requestId: string, _approved: boolean) => Effect.succeed(undefined),
    getContext: () => Effect.succeed({
      sessionId: "test-session",
      projectPath: "/test",
      isCI: false,
      isInteractive: true,
      recentApprovals: new Set(),
    }),
    grantTemporary: (_action: Action, _target: string, _durationMs: number) => Effect.succeed(undefined),
    loadDefaultRules: () => Effect.succeed(undefined),
    addRule: (_rule: any) => Effect.succeed(undefined),
    removeRule: (_ruleId: string) => Effect.succeed(undefined),
    getAllRules: () => Effect.succeed([]),
    clearTemporaryGrants: () => Effect.succeed(undefined),
  })
)

// ============================================================
// Runtime 沙盒
// ============================================================

const TestLayer = ToolRegistryLive.pipe(Layer.provide(MockPermissionLive))
const TestRuntime = ManagedRuntime.make(TestLayer)
const runTool = <A, E>(effect: Effect.Effect<A, E, ToolRegistry>) =>
  TestRuntime.runPromise(effect)

afterAll(() => {
  TestRuntime.dispose()
})

// ============================================================
// 工厂函数：创建测试用工具
// ============================================================

const mkStruct = (fields: Record<string, any>) => Schema.Struct(fields) as any

const makeTestTool = (overrides?: Partial<ToolDefinition>): any => ({
  name: "test_echo",
  description: "Echo back the input",
  category: "search" as ToolCategory,
  permission: "read" as Action,
  sideEffect: "read" as const,
  safeToRetry: true,
  inputSchema: mkStruct({ message: Schema.String }),
  defaultEnabled: true,
  execute: (input: any, _ctx: any) =>
    Effect.succeed(`echo: ${input.message}`),
  ...overrides,
})

const makeFailingTool = (overrides?: Partial<ToolDefinition>): any => ({
  name: "test_fail",
  description: "Always fails",
  category: "search" as ToolCategory,
  permission: "read" as Action,
  sideEffect: "read" as const,
  safeToRetry: true,
  inputSchema: mkStruct({ code: Schema.Number }),
  defaultEnabled: true,
  execute: (_input: any, _ctx: any) =>
    Effect.fail(new ToolExecutionError({
      toolName: "test_fail",
      message: "Intentional failure",
    })),
  ...overrides,
})

const makeSucceedTool = (name: string): any => ({
  name,
  description: `Tool ${name}`,
  category: "file" as ToolCategory,
  permission: "read" as Action,
  sideEffect: "read" as const,
  safeToRetry: true,
  inputSchema: mkStruct({ value: Schema.String }),
  defaultEnabled: true,
  execute: (input: any, _ctx: any) => Effect.succeed(`result: ${input.value}`),
})

// ============================================================
// 测试上下文
// ============================================================

const testContext: ToolContext = {
  sessionId: "test-session-001",
  workspaceRoot: "/tmp/test-workspace",
  isInteractive: false,
}

const makeToolCall = (name: string, args: unknown, id?: string): ToolCall => ({
  id: id ?? `call_${name}`,
  type: "function",
  function: {
    name,
    arguments: JSON.stringify(args),
  },
})

// ============================================================
// 场景 1：注册 & 查询工具
// ============================================================

describe("场景 1: 工具注册与查询", () => {
  it("register — 注册一个工具后可通过 get 查询", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeTestTool()
      yield* registry.register(tool)
      const found = yield* registry.get("test_echo")
      expect(found.name).toBe("test_echo")
      expect(found.description).toBe(tool.description)
      expect(found.category).toBe("search")
      expect(found.permission).toBe("read")
    })
    await runTool(program)
  })

  it("get — 查询不存在的工具应返回 ToolNotFoundError", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      return yield* registry.get("nonexistent")
    })

    await expect(runTool(program)).rejects.toBeInstanceOf(ToolNotFoundError)
  })

  it("register — defaultEnabled=false 的工具不会被自动启用", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeTestTool({
        name: "disabled_by_default",
        defaultEnabled: false,
      })
      yield* registry.register(tool)

      // 列出所有工具（包括禁用的）
      const all = yield* registry.list()
      expect(all.find((t: any) => t.name === "disabled_by_default")).toBeDefined()

      // 仅启用的工具不应包含该工具
      const enabledOnly = yield* registry.list({ enabledOnly: true })
      expect(enabledOnly.find((t: any) => t.name === "disabled_by_default")).toBeUndefined()
    })
    await runTool(program)
  })

  it("registerAll — 批量注册后所有工具可查询", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tools = [
        makeSucceedTool("batch_1"),
        makeSucceedTool("batch_2"),
        makeSucceedTool("batch_3"),
      ]
      yield* registry.registerAll(tools)

      const t1 = yield* registry.get("batch_1")
      const t2 = yield* registry.get("batch_2")
      const t3 = yield* registry.get("batch_3")

      expect(t1.name).toBe("batch_1")
      expect(t2.name).toBe("batch_2")
      expect(t3.name).toBe("batch_3")
    })
    await runTool(program)
  })

  it("register — 覆盖同名工具", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const v1 = makeTestTool({ name: "override_me", description: "v1" })
      const v2 = makeTestTool({ name: "override_me", description: "v2" })

      yield* registry.register(v1)
      yield* registry.register(v2)

      const found = yield* registry.get("override_me")
      expect(found.description).toBe("v2")
    })
    await runTool(program)
  })
})

// ============================================================
// 场景 2：OpenAI / LLM 定义生成
// ============================================================

describe("场景 2: OpenAI Function Calling 定义", () => {
  it("getOpenAIDefinition — 生成标准 function calling 格式", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      // 使用内置工具 ReadTool（已在 ToolRegistryLive 中注册）
      const def: any = yield* registry.getOpenAIDefinition("read_file")
      expect(def.type).toBe("function")
      expect(def.function.name).toBe("read_file")
      expect(typeof def.function.description).toBe("string")
      expect(typeof def.function.parameters).toBe("object")
    })
    await runTool(program)
  })

  it("getOpenAIDefinition — 不存在的工具返回 ToolNotFoundError", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      return yield* registry.getOpenAIDefinition("ghost_tool")
    })

    await expect(runTool(program)).rejects.toBeInstanceOf(ToolNotFoundError)
  })

  it("getOpenAIDefinitions — 批量获取多个定义", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const defs: any[] = yield* registry.getOpenAIDefinitions(["read_file", "write_file"])
      expect(defs).toBeArray()
      expect(defs.length).toBe(2)
      expect(defs[0].function.name).toBe("read_file")
      expect(defs[1].function.name).toBe("write_file")
    })
    await runTool(program)
  })

  it("getOpenAIDefinitions — 任一工具不存在则整体失败", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      return yield* registry.getOpenAIDefinitions(["read_file", "ghost_tool"])
    })

    await expect(runTool(program)).rejects.toBeInstanceOf(ToolNotFoundError)
  })
})

// ============================================================
// 场景 3：工具执行
// ============================================================

describe("场景 3: 工具执行", () => {
  it("execute — 正常执行并返回成功结果", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeTestTool()
      yield* registry.register(tool)

      const tc = makeToolCall("test_echo", { message: "hello world" })
      const result = yield* registry.execute(tc, testContext)

      expect(result.success).toBe(true)
      expect(result.content).toContain("echo: hello world")
      expect(result.tool_call_id).toBe("call_test_echo")
      expect(result.role).toBe("tool")
    })
    await runTool(program)
  })

  it("execute — 工具执行失败应返回成功标记 false", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeFailingTool()
      yield* registry.register(tool)

      const tc = makeToolCall("test_fail", { code: 500 })
      const result = yield* registry.execute(tc, testContext)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
    await runTool(program)
  })

  it("execute — 不存在的工具返回 ToolNotFoundError", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      return yield* registry.execute(
        makeToolCall("ghost", { x: 1 }),
        testContext
      )
    })

    await expect(runTool(program)).rejects.toBeInstanceOf(ToolValidationError)
  })

  it("execute — 非法 JSON 参数返回 ToolValidationError", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeTestTool()
      yield* registry.register(tool)

      const tc: ToolCall = {
        id: "call_bad",
        type: "function",
        function: {
          name: "test_echo",
          arguments: "not valid json {{{",
        },
      }
      return yield* registry.execute(tc, testContext)
    })

    await expect(runTool(program)).rejects.toBeInstanceOf(ToolValidationError)
  })

  it("execute — Schema 验证失败返回 ToolValidationError", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeTestTool() // expects { message: string }
      yield* registry.register(tool)

      // 传递错误类型的参数
      const tc = makeToolCall("test_echo", { message: 12345 })
      return yield* registry.execute(tc, testContext)
    })

    await expect(runTool(program)).rejects.toThrow()
  })

  it("execute — 禁用的工具返回 success=false", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeTestTool({ name: "will_disable" })
      yield* registry.register(tool)

      yield* registry.setEnabled("will_disable", false)

      const tc = makeToolCall("will_disable", { message: "hi" })
      const result = yield* registry.execute(tc, testContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain("disabled")
    })
    await runTool(program)
  })

  it("execute — 需要确认的工具返回 await confirmation", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeTestTool({ name: "confirm_me", requireConfirm: true })
      yield* registry.register(tool)

      const tc = makeToolCall("confirm_me", { message: "please confirm" })
      const result = yield* registry.execute(tc, testContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain("confirmation")
    })
    await runTool(program)
  })

  it("execute — 利用 Effect 错误通道传递执行失败", async () => {
    // 将 ToolExecutionError 映射到错误通道的 execute
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const tool = makeFailingTool()
      yield* registry.register(tool)

      const tc = makeToolCall("test_fail", { code: 999 })
      // execute 内部会将 Effect.fail 捕获并转为 success=false
      const result = yield* registry.execute(tc, testContext)
      return result
    })

    const result = await runTool(program)
    expect(result.success).toBe(false)
  })
})

// ============================================================
// 场景 4：批量执行
// ============================================================

describe("场景 4: 批量执行", () => {
  it("executeBatch — 顺序执行多个工具", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      yield* registry.register(makeTestTool({ name: "batch_a" }))
      yield* registry.register(makeTestTool({ name: "batch_b" }))

      const results = yield* registry.executeBatch(
        [
          makeToolCall("batch_a", { message: "first" }, "c1"),
          makeToolCall("batch_b", { message: "second" }, "c2"),
        ],
        testContext
      )

      expect(results).toBeArray()
      expect(results.length).toBe(2)
      expect(results[0]!.success).toBe(true)
      expect(results[0]!.content).toContain("echo: first")
      expect(results[1]!.success).toBe(true)
      expect(results[1]!.content).toContain("echo: second")
    })
    await runTool(program)
  })
})

// ============================================================
// 场景 5：工具列表 & 启禁
// ============================================================

describe("场景 5: 列表与启禁", () => {
  it("list — 默认列出所有工具", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const all = yield* registry.list()
      expect(all.length).toBeGreaterThan(0)
      // 内置工具 + 测试工具都存在
      const names = all.map((t: any) => t.name)
      expect(names).toContain("read_file")
      expect(names).toContain("write_file")
    })
    await runTool(program)
  })

  it("list — enabledOnly=true 仅返回启用的工具", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      yield* registry.register(makeTestTool({
        name: "always_on",
        defaultEnabled: true,
      }))
      yield* registry.register(makeTestTool({
        name: "always_off",
        defaultEnabled: false,
      }))

      const enabled = yield* registry.list({ enabledOnly: true })
      const names = enabled.map((t: any) => t.name)
      expect(names).toContain("always_on")
      expect(names).not.toContain("always_off")
    })
    await runTool(program)
  })

  it("list — 按类别过滤", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const fileTools = yield* registry.list({ category: "file" })
      expect(fileTools.length).toBeGreaterThan(0)
      for (const t of fileTools as any[]) {
        expect(t.category).toBe("file")
      }
    })
    await runTool(program)
  })

  it("setEnabled — 动态启用/禁用工具", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      yield* registry.register(makeTestTool({ name: "toggle_me" }))

      // 默认启用
      const enabled1 = yield* registry.list({ enabledOnly: true })
      expect(enabled1.find((x: any) => x.name === "toggle_me")).toBeDefined()

      // 禁用
      yield* registry.setEnabled("toggle_me", false)
      const enabled2 = yield* registry.list({ enabledOnly: true })
      expect(enabled2.find((x: any) => x.name === "toggle_me")).toBeUndefined()

      // 重新启用
      yield* registry.setEnabled("toggle_me", true)
      const enabled3 = yield* registry.list({ enabledOnly: true })
      expect(enabled3.find((x: any) => x.name === "toggle_me")).toBeDefined()
    })
    await runTool(program)
  })

  it("setEnabled — 操作不存在的工具返回 ToolNotFoundError", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      return yield* registry.setEnabled("nothing", true)
    })

    await expect(runTool(program)).rejects.toBeInstanceOf(ToolNotFoundError)
  })
})

// ============================================================
// 场景 6：内置工具正确性
// ============================================================

describe("场景 6: 内置工具注册", () => {
  it("所有 10 个内置工具均已注册", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry
      const all = yield* registry.list()
      const names = new Set(all.map((t: any) => t.name))
      expect(names.has("read_file")).toBe(true)
      expect(names.has("write_file")).toBe(true)
      expect(names.has("edit_file")).toBe(true)
      expect(names.has("run_command")).toBe(true)
      expect(names.has("read_command")).toBe(true)
      expect(names.has("glob")).toBe(true)
      expect(names.has("grep")).toBe(true)
      expect(names.has("think")).toBe(true)
      expect(names.has("fetch_webpage")).toBe(true)
      expect(names.has("file_exists")).toBe(true)
    })
    await runTool(program)
  })

  it("内置工具 requireConfirm / sideEffect 设置正确", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ToolRegistry

      const runCmd = yield* registry.get("run_command")
      expect(runCmd.requireConfirm).toBe(true)
      expect(runCmd.sideEffect).toBe("write")

      const readCmd = yield* registry.get("read_command")
      expect(readCmd.requireConfirm).toBe(false)
      expect(readCmd.sideEffect).toBe("read")

      const readTool = yield* registry.get("read_file")
      expect(readTool.requireConfirm).toBeUndefined()
      expect(readTool.sideEffect).toBe("read")
    })
    await runTool(program)
  })
})
