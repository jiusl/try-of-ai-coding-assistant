// src/test/testpermission.ts
// Permission 沙盒测试 — 规则引擎 + 权限检查全场景覆盖
// 两套独立 Runtime：引擎测试用纯净环境，权限测试用完整服务
import { Effect, ManagedRuntime, Layer, Option } from "effect"
import { describe, it, expect, afterAll } from "bun:test"
import {
  Permission,
  PermissionLive,
} from "../permission/permission.js"
import type { PermissionRule } from "../permission/types.js"
import { RuleEngineService, RuleEngineLive } from "../permission/rule-engine.js"
import { Config } from "../config/config.js"
import { PermissionDeniedError, PermissionAskError } from "../permission/types.js"

// ============================================================
// 两套独立沙盒
// ============================================================

// --- 引擎沙盒（纯净，无任何预设规则）---
const EngineRuntime = ManagedRuntime.make(RuleEngineLive)
const runEngine = <A, E>(effect: Effect.Effect<A, E, RuleEngineService>) =>
  EngineRuntime.runPromise(effect)

// --- 权限沙盒（带 DEFAULT_RULES）---
const EmptyConfigLive = Layer.succeed(Config, {
  get: () => Effect.succeed({} as any),
  getvalue: <K>() => Effect.fail(new Error("not implemented")) as any,
  getModel: () => Effect.succeed({ provider: "openai" as const, model: "test" }),
  setModel: (_model: any) => Effect.succeed(undefined),
  getPermissions: () => Effect.succeed([]),
  isAllowed: () => Effect.succeed(true),
  reload: () => Effect.succeed({} as any),
  save: () => Effect.succeed(undefined),
})

const PermLayer = PermissionLive.pipe(
  Layer.provideMerge(EmptyConfigLive),
  Layer.provideMerge(RuleEngineLive)
)
const PermRuntime = ManagedRuntime.make(PermLayer)
const runPerm = <A, E>(effect: Effect.Effect<A, E, Permission | RuleEngineService>) =>
  PermRuntime.runPromise(effect)

afterAll(() => {
  EngineRuntime.dispose()
  PermRuntime.dispose()
})

// ============================================================
// 场景 1：RuleEngine — 规则匹配 & 优先级（纯净引擎）
// ============================================================

describe("场景 1: RuleEngine 规则匹配", () => {
  it("matchRule — 匹配到正确规则", async () => {
    const result = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "test-read-src",
        action: "read",
        pattern: "src/**",
        decision: "allow",
        priority: 10,
      })
      return yield* engine.matchRule("read", "src/index.ts")
    }))

    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.id).toBe("test-read-src")
      expect(result.value.decision).toBe("allow")
    }
  })

  it("matchRule — 不匹配时应返回 none", async () => {
    const result = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "only-read",
        action: "read",
        pattern: "*.ts",
        decision: "allow",
        priority: 10,
      })
      return yield* engine.matchRule("write", "test.ts")
    }))
    expect(Option.isNone(result)).toBe(true)
  })

  it("matchRule — 高优先级规则先匹配", async () => {
    const result = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "low-prio",
        action: "write",
        pattern: "src/**",
        decision: "deny",
        priority: 5,
      })
      yield* engine.addRule({
        id: "high-prio",
        action: "write",
        pattern: "src/**",
        decision: "allow",
        priority: 50,
      })
      return yield* engine.matchRule("write", "src/app.ts")
    }))

    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.id).toBe("high-prio")
      expect(result.value.decision).toBe("allow")
    }
  })

  it("matchRule — 支持 RegExp 模式", async () => {
    const result = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "regex-rule",
        action: "network",
        pattern: /^https:\/\/api\./,
        decision: "allow",
        priority: 10,
      })
      return yield* engine.matchRule("network", "https://api.example.com/data")
    }))

    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.id).toBe("regex-rule")
    }
  })

  it("matchRule — RegExp 不匹配", async () => {
    const result = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "regex-rule-2",
        action: "network",
        pattern: /^https:\/\/safe\./,
        decision: "allow",
        priority: 10,
      })
      return yield* engine.matchRule("network", "https://evil.com/data")
    }))
    expect(Option.isNone(result)).toBe(true)
  })
})

// ============================================================
// 场景 2：RuleEngine — 规则 CRUD（纯净引擎）
// ============================================================

describe("场景 2: RuleEngine 规则管理", () => {
  it("addRule → getAllRules → removeRule 完整流程", async () => {
    const result = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "crud-test",
        action: "execute",
        pattern: "npm test",
        decision: "allow",
        priority: 10,
      })
      const all = yield* engine.getAllRules()
      const found = all.filter(r => r.id === "crud-test")
      yield* engine.removeRule("crud-test")
      const after = yield* engine.getAllRules()
      return {
        beforeCount: found.length,
        afterCount: after.filter(r => r.id === "crud-test").length,
      }
    }))
    expect(result.beforeCount).toBe(1)
    expect(result.afterCount).toBe(0)
  })

  it("addRule — 重复 id 会覆盖旧规则", async () => {
    const result = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "overwrite-me",
        action: "read",
        pattern: "*.ts",
        decision: "allow",
        priority: 10,
      })
      yield* engine.addRule({
        id: "overwrite-me",
        action: "read",
        pattern: "*.ts",
        decision: "deny",
        priority: 20,
      })
      const all = yield* engine.getAllRules()
      const rule = all.find(r => r.id === "overwrite-me")
      return {
        count: all.filter(r => r.id === "overwrite-me").length,
        decision: rule?.decision,
      }
    }))
    expect(result.count).toBe(1)
    expect(result.decision).toBe("deny")
  })

  it("addRules — 批量添加", async () => {
    const count = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRules([
        { id: "batch-1", action: "read", pattern: "*.md", decision: "allow", priority: 10 },
        { id: "batch-2", action: "read", pattern: "*.json", decision: "allow", priority: 10 },
        { id: "batch-3", action: "read", pattern: "*.yaml", decision: "deny", priority: 20 },
      ])
      const all = yield* engine.getAllRules()
      return all.filter(r => r.id.startsWith("batch-")).length
    }))
    expect(count).toBe(3)
  })
})

// ============================================================
// 场景 3：RuleEngine — evaluate & 临时覆盖（纯净引擎）
// ============================================================

describe("场景 3: RuleEngine evaluate & 临时覆盖", () => {
  const makeCtx = () => ({
    sessionId: "test-session",
    projectPath: "/test",
    isCI: false,
    isInteractive: true,
    recentApprovals: new Set<string>(),
  })

  it("evaluate — 匹配到 allow 规则，返回 allow", async () => {
    const decision = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "eval-allow",
        action: "read",
        pattern: "README.md",
        decision: "allow",
        priority: 10,
      })
      return yield* engine.evaluate({
        action: "read",
        target: "README.md",
        context: makeCtx(),
      })
    }))
    expect(decision).toBe("allow")
  })

  it("evaluate — 匹配到 deny 规则，以成功值返回 'deny'", async () => {
    const decision = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "eval-deny",
        action: "delete",
        pattern: "**",
        decision: "deny",
        priority: 100,
      })
      return yield* engine.evaluate({ action: "delete", target: "important.ts", context: makeCtx() })
    }))
    // evaluate 返回 Decision，deny 作为成功值返回，不抛错
    // 只有 Permission.request() 才将 deny 转为 PermissionDeniedError
    expect(decision).toBe("deny")
  })

  it("evaluate — 没有匹配规则时默认返回 deny", async () => {
    const decision = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      // evaluate 永远返回 Decision，不会抛异常；无规则匹配时默认 deny
      return yield* engine.evaluate({ action: "network", target: "https://unknown.api/endpoint", context: makeCtx() })
    }))
    expect(decision).toBe("deny")
  })

  it("temporaryOverride — 覆盖规则决策为 allow", async () => {
    const decision = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "deny-read-env",
        action: "read",
        pattern: ".env",
        decision: "deny",
        priority: 50,
      })
      yield* engine.temporaryOverride("deny-read-env", "allow")
      return yield* engine.evaluate({
        action: "read",
        target: ".env",
        context: makeCtx(),
      })
    }))
    expect(decision).toBe("allow")
  })

  it("clearOverrides — 清除覆盖后恢复原决策", async () => {
    const decision = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "clear-test",
        action: "execute",
        pattern: "rm *",
        decision: "deny",
        priority: 50,
      })
      yield* engine.temporaryOverride("clear-test", "allow")
      yield* engine.clearOverrides()
      // evaluate 返回 Decision，清除覆盖后恢复为 deny
      return yield* engine.evaluate({ action: "execute", target: "rm -rf /", context: makeCtx() })
    }))
    expect(decision).toBe("deny")
  })
})

// ============================================================
// 场景 4：Permission — 默认规则沙盒（完整权限服务）
// ============================================================

describe("场景 4: Permission 默认规则", () => {
  it("读 src 源码 → allow", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("read", "src/index.ts"))
    }))
    expect(result._tag).toBe("Right")
  })

  it("读 .env → deny", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("read", ".env"))
    }))
    expect(result._tag).toBe("Left")
  })

  it("写 src/foo.ts → allow", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("write", "src/foo.ts"))
    }))
    expect(result._tag).toBe("Right")
  })

  it("写 package.json → ask (requires confirmation)", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("write", "package.json"))
    }))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PermissionAskError)
    }
  })

  it("删除任意文件 → deny", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("delete", "src/old.ts"))
    }))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PermissionDeniedError)
    }
  })

  it("安全 npm 命令 → allow", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("execute", "npm test"))
    }))
    expect(result._tag).toBe("Right")
  })

  it("危险命令 rm -rf → deny", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("execute", "rm -rf node_modules"))
    }))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PermissionDeniedError)
    }
  })

  it("OpenAI API 网络请求 → allow", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(
        perm.request("network", "https://api.openai.com/v1/chat/completions")
      )
    }))
    expect(result._tag).toBe("Right")
  })

  it("NODE_ENV 环境变量 → allow", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("env", "NODE_ENV"))
    }))
    expect(result._tag).toBe("Right")
  })

  it("OPENAI_API_KEY 敏感环境变量 → ask", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("env", "OPENAI_API_KEY"))
    }))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PermissionAskError)
    }
  })
})

// ============================================================
// 场景 5：Permission — check vs request
// ============================================================

describe("场景 5: check vs request 语义", () => {
  it("check — allow 返回 'allow'，不抛错", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* perm.check("read", "src/utils.ts")
    }))
    expect(decision).toBe("allow")
  })

  it("check — deny 返回 'deny'，不抛错", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* perm.check("read", ".env")
    }))
    expect(decision).toBe("deny")
  })

  it("check — ask 规则返回 'ask'，不抛 PermissionAskError", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* perm.check("write", "package.json")
    }))
    expect(decision).toBe("ask")
  })

  it("request — allow 返回成功", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("read", "docs/README.md"))
    }))
    expect(result._tag).toBe("Right")
  })

  it("request — deny 抛出 PermissionDeniedError", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("delete", "anything.txt"))
    }))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      const err = result.left
      expect(err).toBeInstanceOf(PermissionDeniedError)
      expect(err.action).toBe("delete")
    }
  })

  it("request — ask 抛出 PermissionAskError 携带 requestId", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("write", "tsconfig.json"))
    }))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      const err = result.left
      expect(err).toBeInstanceOf(PermissionAskError)
      if (err instanceof PermissionAskError) {
        expect(err.requestId).toBeTruthy()
        expect(err.requestId.length).toBeGreaterThan(10)
        expect(err.message).toContain("Permission Request")
      }
    }
  })
})

// ============================================================
// 场景 6：Permission — respond 决策流程
// ============================================================

describe("场景 6: respond 用户决策", () => {
  it("ask 被 deny → 无临时授权，再次请求仍抛 ask", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      const r1 = yield* Effect.either(perm.request("write", "tsconfig.json"))
      let requestId = ""
      if (r1._tag === "Left" && r1.left instanceof PermissionAskError) {
        requestId = r1.left.requestId
      }
      yield* perm.respond(requestId, false)
      return yield* Effect.either(perm.request("write", "tsconfig.json"))
    }))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PermissionAskError)
    }
  })

  it("ask 被 approve（不 remember）→ 临时授权，第二次直接通过", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      const r1 = yield* Effect.either(perm.request("write", "tsconfig.json"))
      let requestId = ""
      if (r1._tag === "Left" && r1.left instanceof PermissionAskError) {
        requestId = r1.left.requestId
      }
      yield* perm.respond(requestId, true, false)
      return yield* Effect.either(perm.request("write", "tsconfig.json"))
    }))
    expect(result._tag).toBe("Right")
  })

  it("ask 被 approve + remember → 创建永久规则，check 变 allow", async () => {
    const { checkBefore, checkAfter } = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      // 用较低优先级 50，确保 remember 创建的规则（priority=100）能覆盖
      yield* perm.addRule({
        id: "remember-test-rule",
        action: "write",
        pattern: "secrets/keys.json",
        decision: "ask",
        priority: 50,
        requireConfirm: true,
      })
      const r1 = yield* Effect.either(perm.request("write", "secrets/keys.json"))
      let requestId = ""
      if (r1._tag === "Left" && r1.left instanceof PermissionAskError) {
        requestId = r1.left.requestId
      }
      const checkBefore = yield* perm.check("write", "secrets/keys.json")
      yield* perm.respond(requestId, true, true)
      const checkAfter = yield* perm.check("write", "secrets/keys.json")
      return { checkBefore, checkAfter }
    }))
    expect(checkBefore).toBe("ask")
    expect(checkAfter).toBe("allow")
  })

  it("respond 不存在的 requestId → 静默返回", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.respond("non-existent-id", true))
    }))
    expect(result._tag).toBe("Right")
  })
})

// ============================================================
// 场景 7：Permission — grantTemporary 临时授权
// ============================================================

describe("场景 7: grantTemporary 临时授权", () => {
  it("grantTemporary 后 check 返回 allow", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      yield* perm.grantTemporary("read", ".env", 5000)
      return yield* perm.check("read", ".env")
    }))
    expect(decision).toBe("allow")
  })

  it("grantTemporary 后 request 也直接通过", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      yield* perm.grantTemporary("delete", "test.txt", 5000)
      return yield* Effect.either(perm.request("delete", "test.txt"))
    }))
    expect(result._tag).toBe("Right")
  })

  it("grantTemporary 过期后恢复原规则", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      yield* perm.grantTemporary("read", ".env", 10)
      yield* Effect.sleep(50)
      return yield* perm.check("read", ".env")
    }))
    expect(result).toBe("deny")
  })
})

// ============================================================
// 场景 8：Permission — 自定义规则
// ============================================================

describe("场景 8: 自定义规则", () => {
  it("addRule — 新规则生效", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      yield* perm.addRule({
        id: "custom-allow-secrets",
        action: "read",
        pattern: "secrets/**",
        decision: "allow",
        priority: 200,
      })
      return yield* perm.check("read", "secrets/tokens.json")
    }))
    expect(decision).toBe("allow")
  })

  it("addRule — 高优先级 deny 覆盖低优先级 allow", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      yield* perm.addRule({
        id: "allow-all-read",
        action: "read",
        pattern: "**",
        decision: "allow",
        priority: 1,
      })
      yield* perm.addRule({
        id: "deny-secrets",
        action: "read",
        pattern: "secrets/**",
        decision: "deny",
        priority: 201,
      })
      return yield* perm.check("read", "secrets/credentials.txt")
    }))
    expect(decision).toBe("deny")
  })

  it("addRule — requireConfirm 规则的 check 返回 ask", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      yield* perm.addRule({
        id: "confirm-critical",
        action: "execute",
        pattern: "deploy.sh",
        decision: "allow",
        priority: 200,
        requireConfirm: true,
      })
      return yield* perm.check("execute", "deploy.sh")
    }))
    expect(decision).toBe("ask")
  })
})

// ============================================================
// 场景 9：Permission — loadDefaultRules 重置
// ============================================================

describe("场景 9: loadDefaultRules 重置", () => {
  it("user_ 前缀规则在 loadDefaultRules 后仍保留", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      yield* perm.addRule({
        id: "user_my_rule",
        action: "read",
        pattern: "my-folder/**",
        decision: "allow",
        priority: 200,
      })
      yield* perm.loadDefaultRules()
      return yield* perm.check("read", "my-folder/data.txt")
    }))
    expect(decision).toBe("allow")
  })

  it("loadDefaultRules 后默认规则重新生效", async () => {
    const decision = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      yield* perm.addRule({
        id: "temp-allow-env",
        action: "read",
        pattern: ".env",
        decision: "allow",
        priority: 200,
      })
      const before = yield* perm.check("read", ".env")
      expect(before).toBe("allow")
      yield* perm.loadDefaultRules()
      return yield* perm.check("read", ".env")
    }))
    expect(decision).toBe("deny")
  })
})

// ============================================================
// 场景 10：getContext & 综合场景
// ============================================================

describe("场景 10: getContext & 边界验证", () => {
  it("getContext 返回有效结构", async () => {
    const ctx = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* perm.getContext()
    }))
    expect(ctx.sessionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(ctx.projectPath).toBeTruthy()
    expect(typeof ctx.isCI).toBe("boolean")
    expect(typeof ctx.isInteractive).toBe("boolean")
    expect(ctx.recentApprovals).toBeInstanceOf(Set)
  })

  it("没有匹配规则时 request 返回 deny", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(perm.request("shell", "echo hello"))
    }))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(PermissionDeniedError)
    }
  })

  it("metadata 可携带命令信息", async () => {
    const result = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      return yield* Effect.either(
        perm.request("execute", "npm install", { command: "npm install react" })
      )
    }))
    expect(result._tag).toBe("Right")
  })

  it("多个 action 类型互不干扰", async () => {
    const results = await runPerm(Effect.gen(function* () {
      const perm = yield* Permission
      const readResult = yield* perm.check("read", "src/main.ts")
      const writeResult = yield* perm.check("write", "src/main.ts")
      const deleteResult = yield* perm.check("delete", "src/main.ts")
      const networkResult = yield* perm.check("network", "https://api.openai.com/v1")
      const executeResult = yield* perm.check("execute", "npm install")
      return { readResult, writeResult, deleteResult, networkResult, executeResult }
    }))
    expect(results.readResult).toBe("allow")
    expect(results.writeResult).toBe("allow")
    expect(results.deleteResult).toBe("deny")
    expect(results.networkResult).toBe("allow")
    expect(results.executeResult).toBe("allow")
  })
})

// ============================================================
// 场景 11：RuleEngine — 条件评估（纯净引擎）
// ============================================================

describe("场景 11: 条件评估", () => {
  const ciContext = {
    sessionId: "ci-test",
    projectPath: "/ci",
    isCI: true,
    isInteractive: false,
    recentApprovals: new Set<string>(),
  }

  it("条件 context.isCI === true → allow", async () => {
    const decision = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "ci-only",
        action: "write",
        pattern: "**",
        decision: "allow",
        priority: 100,
        condition: "context.isCI === true",
      })
      return yield* engine.evaluate({
        action: "write",
        target: "any.txt",
        context: ciContext,
      })
    }))
    expect(decision).toBe("allow")
  })

  it("条件 context.isInteractive === true → allow", async () => {
    const decision = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      yield* engine.addRule({
        id: "interactive-only",
        action: "execute",
        pattern: "**",
        decision: "allow",
        priority: 100,
        condition: "context.isInteractive === true",
      })
      return yield* engine.evaluate({
        action: "execute",
        target: "any-cmd",
        context: {
          sessionId: "s",
          projectPath: "/",
          isCI: false,
          isInteractive: true,
          recentApprovals: new Set(),
        },
      })
    }))
    expect(decision).toBe("allow")
  })

  it("条件 context.isCI === false 在 CI 环境下 → deny", async () => {
    const decision = await runEngine(Effect.gen(function* () {
      const engine = yield* RuleEngineService
      // 使用独立 action "env" 避免与场景 11.1 的 ci-only (write) 冲突
      yield* engine.addRule({
        id: "not-ci-condition",
        action: "env",
        pattern: "**",
        decision: "allow",
        priority: 100,
        condition: "context.isCI === false",
      })
      // CI 环境下 isCI=true，条件不满足 → 规则不生效 → 默认 deny
      return yield* engine.evaluate({ action: "env", target: "ANY_VAR", context: ciContext })
    }))
    expect(decision).toBe("deny")
  })
})
