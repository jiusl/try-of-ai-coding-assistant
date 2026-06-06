// src/config/config.test.ts
import { Effect, Layer } from "effect"
import { describe, it, expect } from "bun:test"
import { Config, ConfigLive, ConfigMockLive } from "../config/config.js"
import { Fs, FsLive } from "../infra/fs-util.js"
import { Env, EnvLive } from "../infra/env.js"

// ====================================================
// 测试辅助函数
// ====================================================

const createTestEnv = (envVars: Record<string, string>) =>
  Layer.sync(Env, () => ({
    get: (key: string) => Effect.succeed(envVars[key]),
    require: (key: string) => 
      envVars[key] 
        ? Effect.succeed(envVars[key])
        : Effect.fail(new Error(`Missing env: ${key}`))
  }))

const createTestFs = (files: Record<string, string>) =>
  Layer.sync(Fs, () => ({
    readFile: (path: string) => 
      files[path] 
        ? Effect.succeed(files[path])
        : Effect.fail(new Error(`File not found: ${path}`)),
    writeFile: (path: string, content: string) => Effect.succeed(undefined),
    exists: (path: string) => Effect.succeed(!!files[path])
  }))

// ====================================================
// 测试用例
// ====================================================

describe("Config Service", () => {
  
  describe("无配置文件时", () => {
    const testLayer = ConfigLive.pipe(
      Layer.provide(EnvLive),
      Layer.provide(FsLive)
    )

    it("应使用默认配置", async () => {
      const program = Effect.gen(function* () {
        const config = yield* Config
        const appConfig = yield* config.get()
        
        expect(appConfig.model.provider).toBe("openai")
        expect(appConfig.model.model).toBe("gpt-4o-mini")
        expect(appConfig.maxConversationTurns).toBe(50)
      })

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
      expect(result).toBeUndefined()
    })
  })

  describe("有配置文件时", () => {
    const mockConfig = {
      model: {
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        temperature: 0.5
      },
      maxConversationTurns: 100
    }

    const testFs = createTestFs({
      "try.json": JSON.stringify(mockConfig)
    })

    const testLayer = ConfigLive.pipe(
      Layer.provide(EnvLive),
      Layer.provide(testFs)
    )

    it("应加载并合并配置文件", async () => {
      const program = Effect.gen(function* () {
        const config = yield* Config
        const appConfig = yield* config.get()
        
        // 配置文件中的值应覆盖默认值
        expect(appConfig.model.provider).toBe("anthropic")
        expect(appConfig.model.model).toBe("claude-3-5-sonnet")
        expect(appConfig.model.temperature).toBe(0.5)
        expect(appConfig.maxConversationTurns).toBe(100)
        
        // 未配置的值应保留默认值
        expect(appConfig.model.maxTokens).toBe(4096)
        expect(appConfig.permissions?.defaultAllow).toContain("read")
      })

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
      expect(result).toBeUndefined()
    })
  })

  describe("getvalue 方法", () => {
    const testLayer = ConfigMockLive

    it("应返回指定 key 的配置值", async () => {
      const program = Effect.gen(function* () {
        const config = yield* Config
        
        const model = yield* config.getvalue("model")
        expect(model.provider).toBe("openai")
        expect(model.model).toBe("gpt-4o-mini")
        
        const maxTurns = yield* config.getvalue("maxConversationTurns")
        expect(maxTurns).toBe(50)
        
        const systemPrompt = yield* config.getvalue("systemPrompt")
        expect(systemPrompt).toBeUndefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    })

    it("应保持类型安全（编译时检查）", async () => {
      const program = Effect.gen(function* () {
        const config = yield* Config
        
        // @ts-expect-error - "invalid" 不是 AppConfig 的有效 key
        const invalid = yield* config.getvalue("invalid")
        
        // 正确的 key 应该能通过
        const model = yield* config.getvalue("model")
        expect(model).toBeDefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    })
  })

  describe("getModel 方法", () => {
    const testLayer = ConfigMockLive

    it("应返回当前模型配置", async () => {
      const program = Effect.gen(function* () {
        const config = yield* Config
        const model = yield* config.getModel()
        
        expect(model.provider).toBe("openai")
        expect(model.model).toBe("gpt-4o-mini")
        expect(model.temperature).toBe(0.7)
        expect(model.maxTokens).toBe(4096)
      })

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    })
  })

  describe("getPermissions 方法", () => {
    const testLayer = ConfigMockLive

    it("应返回权限规则列表", async () => {
      const program = Effect.gen(function* () {
        const config = yield* Config
        const rules = yield* config.getPermissions()
        
        expect(rules.length).toBeGreaterThan(0)
        expect(rules[0]!.pattern).toBe("**/*.md")
        expect(rules[0]!.allow).toContain("read")
        expect(rules[0]!.allow).toContain("write")
      })

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    })
  })

  describe("isAllowed 方法", () => {
    const testLayer = ConfigMockLive

    it("应正确判断文件权限", async () => {
      const program = Effect.gen(function* () {
        const config = yield* Config
        
        // .md 文件允许 read 和 write
        const mdRead = yield* config.isAllowed("docs/readme.md", "read")
        expect(mdRead).toBe(true)
        
        const mdWrite = yield* config.isAllowed("docs/readme.md", "write")
        expect(mdWrite).toBe(true)
        
        // .env 文件不允许任何操作
        const envRead = yield* config.isAllowed(".env", "read")
        expect(envRead).toBe(false)
        
        const envWrite = yield* config.isAllowed(".env", "write")
        expect(envWrite).toBe(false)
      })

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    })
  })

  describe("reload 方法", () => {
    let currentConfigContent = {
      model: { provider: "openai", model: "gpt-4o-mini" }
    }

    const dynamicFs = Layer.sync(Fs, () => ({
      readFile: (path: string) => {
        return Effect.succeed(JSON.stringify(currentConfigContent))
      },
      writeFile: (path: string, content: string) => Effect.succeed(undefined),
      exists: (path: string) => Effect.succeed(true)
    }))

    it("应重新加载配置", async () => {
      const program = Effect.gen(function* () {
        const config = yield* Config
        
        // 获取初始配置
        let appConfig = yield* config.get()
        expect(appConfig.model.provider).toBe("openai")
        expect(appConfig.model.model).toBe("gpt-4o-mini")
        
        // 修改配置文件内容
        currentConfigContent = {
          model: { provider: "anthropic", model: "claude-3-5-sonnet" }
        }
        
        // 重新加载
        yield* config.reload()
        
        // 获取新配置
        appConfig = yield* config.get()
        expect(appConfig.model.provider).toBe("anthropic")
        expect(appConfig.model.model).toBe("claude-3-5-sonnet")
      })

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(ConfigLive),
          Effect.provide(EnvLive),
          Effect.provide(dynamicFs)
        )
      )
      expect(result).toBeUndefined()
    })
  })

  describe("错误处理", () => {
    it("配置文件格式错误时应返回错误", async () => {
      const invalidFs = createTestFs({
        "try.json": "{ invalid json }"
      })

      const testLayer = ConfigLive.pipe(
        Layer.provide(EnvLive),
        Layer.provide(invalidFs)
      )

      const program = Effect.gen(function* () {
        const config = yield* Config
        return yield* config.get()
      }).pipe(
        Effect.catchAll((e) =>
          Effect.succeed(e instanceof Error ? e.message : String(e))
        )
      )

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
      expect(result).toContain("Failed to parse config file")
    })

    it("配置文件不存在时应使用默认配置", async () => {
      const emptyFs = createTestFs({})  // 空文件系统

      const testLayer = ConfigLive.pipe(
        Layer.provide(EnvLive),
        Layer.provide(emptyFs)
      )

      const program = Effect.gen(function* () {
        const config = yield* Config
        const appConfig = yield* config.get()
        
        // 应使用默认配置
        expect(appConfig.model.provider).toBe("openai")
      })

      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
      expect(result).toBeUndefined()
    })
  })
})

// ====================================================
// 简单运行测试（非 bun test 环境）
// ====================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("🧪 运行配置服务测试...")
  console.log("   使用 `bun test` 运行所有测试")
}