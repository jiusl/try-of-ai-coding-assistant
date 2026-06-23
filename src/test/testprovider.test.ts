// src/test/testprovider.ts
import { Effect, Layer, Stream, Option } from "effect"
import { describe, it, expect } from "bun:test"
import {
  Provider,
  ProviderLive,
  ProviderMockLive
} from "../provider/provider.js"
import type { ProviderService } from "../provider/provider.js"
import {
  ProviderError,
  SDKNotInstalledError,
  AuthError
} from "../provider/types.js"
import { Config, ConfigMockLive } from "../config/config.js"
import { Auth, AuthLive } from "../provider/auth.js"
import { Env, EnvLive } from "../infra/env.js"
import { Fs, FsLive } from "../infra/fs-util.js"
import type {
  Message,
  GenerateOptions,
  GenerateResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  ProviderType,
  Role
} from "../provider/types.js"

// ====================================================
// 测试辅助
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
    writeFile: (_path: string, _content: string) => Effect.succeed(undefined),
    exists: (path: string) => Effect.succeed(!!files[path])
  }))

// ====================================================
// ProviderService 接口契约测试（使用 Mock）
// ====================================================

describe("ProviderService (Mock)", () => {

  describe("generate 方法", () => {
    const testLayer = ProviderMockLive

    it("应返回 mock 响应", async () => {
      const program = Effect.gen(function* () {
        const provider = yield* Provider
        const result = yield* provider.generate([
          { role: "user", content: "Hello" }
        ])
        return result
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      )

      expect(result.content).toContain("Mock response")
      expect(result.content).toContain("Hello")
      expect(result.model).toBe("mock-model")
      expect(result.usage.promptTokens).toBe(10)
      expect(result.usage.completionTokens).toBe(20)
      expect(result.usage.totalTokens).toBe(30)
    })

    it("应处理多条消息", async () => {
      const program = Effect.gen(function* () {
        const provider = yield* Provider
        const result = yield* provider.generate([
          { role: "system", content: "你是一个助手" },
          { role: "user", content: "问题1" },
          { role: "assistant", content: "回答1" },
          { role: "user", content: "问题2" }
        ])
        return result
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      )

      expect(result.content).toContain("问题1")
      expect(result.content).toContain("问题2")
    })
  })

  describe("stream 方法", () => {
    const testLayer = ProviderMockLive

    it("应返回流式响应", async () => {
      const program = Effect.gen(function* () {
        const provider = yield* Provider
        const stream = provider.stream([
          { role: "user", content: "Hello" }
        ])

        const chunks = yield* Stream.runCollect(stream)
        return chunks
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      )

      // Chunk 转数组
      const arr = Array.from(result)
      expect(arr.length).toBe(4)
      expect(arr[0]).toEqual({ type: "content", content: "Mock " })
      expect(arr[1]).toEqual({ type: "content", content: "stream " })
      expect(arr[2]).toEqual({ type: "content", content: "response" })
      expect(arr[3]).toEqual({ type: "done" })
    })
  })

  describe("isAvailable 方法", () => {
    const testLayer = ProviderMockLive

    it("应返回 true", async () => {
      const program = Effect.gen(function* () {
        const provider = yield* Provider
        const available = yield* provider.isAvailable()
        return available
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      )

      expect(result).toBe(true)
    })

    it("可指定 provider 检查", async () => {
      const program = Effect.gen(function* () {
        const provider = yield* Provider
        const openaiAvailable = yield* provider.isAvailable("openai")
        const anthropicAvailable = yield* provider.isAvailable("anthropic")
        const deepseekAvailable = yield* provider.isAvailable("deepseek")
        return { openaiAvailable, anthropicAvailable, deepseekAvailable }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      )

      expect(result.openaiAvailable).toBe(true)
      expect(result.anthropicAvailable).toBe(true)
      expect(result.deepseekAvailable).toBe(true)
    })
  })
})

// ====================================================
// 错误类型测试
// ====================================================

describe("Provider 错误类型", () => {

  describe("ProviderError", () => {
    it("应正确创建 ProviderError", () => {
      const error = new ProviderError({
        provider: "openai" as ProviderType,
        statusCode: 429,
        message: "Rate limit exceeded"
      })

      expect(error._tag).toBe("ProviderError")
      expect(error.provider).toBe("openai")
      expect(error.statusCode).toBe(429)
      expect(error.message).toBe("Rate limit exceeded")
      expect(error.cause).toBeUndefined()
    })

    it("应支持 cause 属性", () => {
      const cause = new Error("network timeout")
      const error = new ProviderError({
        provider: "anthropic" as ProviderType,
        message: "Request failed",
        cause
      })

      expect(error.cause).toBe(cause)
    })

    it("statusCode 为可选", () => {
      const error = new ProviderError({
        provider: "deepseek" as ProviderType,
        message: "Unknown error"
      })

      expect(error.statusCode).toBeUndefined()
    })
  })

  describe("SDKNotInstalledError", () => {
    it("应正确创建 SDKNotInstalledError", () => {
      const error = new SDKNotInstalledError({
        provider: "openai" as ProviderType,
        installCommand: "bun add openai"
      })

      expect(error._tag).toBe("SDKNotInstalled")
      expect(error.provider).toBe("openai")
      expect(error.installCommand).toBe("bun add openai")
    })
  })

  describe("AuthError", () => {
    it("应正确创建 AuthError", () => {
      const error = new AuthError({
        provider: "anthropic" as ProviderType,
        message: "Missing API key"
      })

      expect(error._tag).toBe("AuthError")
      expect(error.provider).toBe("anthropic")
      expect(error.message).toBe("Missing API key")
    })
  })
})

// ====================================================
// generate 请求参数传递测试
// ====================================================

describe("GenerateOptions", () => {
  const testLayer = ProviderMockLive

  it("可传入 model 参数", async () => {
    const program = Effect.gen(function* () {
      const provider = yield* Provider
      const result = yield* provider.generate(
        [{ role: "user", content: "test" }],
        { model: "gpt-4o" }
      )
      return result
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer))
    )

    // Mock 返回固定模型名，但调用不报错
    expect(result.model).toBe("mock-model")
  })

  it("可传入 temperature 和 maxTokens", async () => {
    const program = Effect.gen(function* () {
      const provider = yield* Provider
      const result = yield* provider.generate(
        [{ role: "user", content: "test" }],
        { temperature: 0.3, maxTokens: 2000 }
      )
      return result
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer))
    )

    expect(result.usage.totalTokens).toBe(30)
  })

  it("可传入 tools 参数", async () => {
    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "获取天气",
          parameters: { location: "string" }
        }
      }
    ]

    const program = Effect.gen(function* () {
      const provider = yield* Provider
      const result = yield* provider.generate(
        [{ role: "user", content: "今天天气怎么样" }],
        { tools }
      )
      return result
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer))
    )

    expect(result.content).toContain("Mock response")
  })
})

// ====================================================
// stream 分块类型测试
// ====================================================

describe("StreamChunk 类型", () => {

  it("content 分块结构正确", () => {
    const chunk: StreamChunk = {
      type: "content",
      content: "Hello World"
    }

    expect(chunk.type).toBe("content")
    expect(chunk.content).toBe("Hello World")
  })

  it("tool_call 分块结构正确", () => {
    const toolCall: ToolCall = {
      id: "call_123",
      type: "function",
      function: {
        name: "get_weather",
        arguments: '{"location":"Beijing"}'
      }
    }

    const chunk: StreamChunk = {
      type: "tool_call",
      tool_call: toolCall
    }

    expect(chunk.type).toBe("tool_call")
    expect(chunk.tool_call?.id).toBe("call_123")
    expect(chunk.tool_call?.function.name).toBe("get_weather")
  })

  it("done 分块结构正确", () => {
    const chunk: StreamChunk = { type: "done" }

    expect(chunk.type).toBe("done")
    expect(chunk.content).toBeUndefined()
  })

  it("error 分块结构正确", () => {
    const err = new Error("stream error")
    const chunk: StreamChunk = {
      type: "error",
      error: err
    }

    expect(chunk.type).toBe("error")
    expect(chunk.error).toBe(err)
  })
})

// ====================================================
// Message 类型测试
// ====================================================

describe("Message 类型", () => {

  it("应支持所有 Role 类型", () => {
    const messages: Message[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "user message" },
      { role: "assistant", content: "assistant message" },
      { role: "tool", content: "tool result", tool_call_id: "call_123" }
    ]

    expect(messages.length).toBe(4)
    expect(messages[0]!.role).toBe("system")
    expect(messages[3]!.tool_call_id).toBe("call_123")
  })

  it("name 和 tool_call_id 为可选字段", () => {
    const msg1: Message = { role: "user", content: "hi" }
    const msg2: Message = {
      role: "tool",
      content: "result",
      name: "weather_tool",
      tool_call_id: "call_abc"
    }

    expect(msg1.name).toBeUndefined()
    expect(msg2.name).toBe("weather_tool")
    expect(msg2.tool_call_id).toBe("call_abc")
  })
})

// ====================================================
// ProviderMockLive 与 ProviderLive 接口一致测试
// ====================================================

describe("ProviderMockLive 接口一致性", () => {
  const testLayer = ProviderMockLive

  it("Mock generate 签名应与 ProviderService 兼容", async () => {
    const program = Effect.gen(function* () {
      const provider = yield* Provider

      // 不带 options
      const r1 = yield* provider.generate([
        { role: "user", content: "a" }
      ])

      // 带完整 options
      const r2 = yield* provider.generate(
        [{ role: "user", content: "b" }],
        { model: "gpt-4", temperature: 0.5, maxTokens: 1000 }
      )

      return { r1, r2 }
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer))
    )

    expect(result.r1.content).toBeDefined()
    expect(result.r2.content).toBeDefined()
  })

  it("Mock stream 签名应与 ProviderService 兼容", async () => {
    const program = Effect.gen(function* () {
      const provider = yield* Provider

      const stream1 = provider.stream([{ role: "user", content: "a" }])
      const r1 = yield* Stream.runCollect(stream1)

      const stream2 = provider.stream(
        [{ role: "user", content: "b" }],
        { model: "claude-3", temperature: 1.0 }
      )
      const r2 = yield* Stream.runCollect(stream2)

      return { r1, r2 }
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLayer))
    )

    expect(Array.from(result.r1).length).toBeGreaterThan(0)
    expect(Array.from(result.r2).length).toBeGreaterThan(0)
  })
})

// ====================================================
// 模型路由逻辑测试 (getProviderFromModel)
// ====================================================

describe("Provider 模型路由逻辑", () => {

  describe("有 API Key 时的集成测试", () => {
    // 构建一个提供 deepseek API key 的 auth mock 层
    const makeAuthLayer = (providers: Record<string, { apiKey: string; baseUrl?: string }>) =>
      Layer.succeed(Auth, {
        getApiKey: (provider?: string) => {
          const p = provider ?? "openai"
          const cfg = providers[p]
          return cfg?.apiKey
            ? Effect.succeed(cfg.apiKey)
            : Effect.fail(new Error(`No API key for ${p}`))
        },
        getBaseUrl: (provider?: string) => {
          const p = provider ?? "openai"
          return Effect.succeed(providers[p]?.baseUrl)
        },
        getOrganization: (_provider?: string) =>
          Effect.succeed(undefined),
        validateApiKey: (provider?: string) => {
          const p = provider ?? "openai"
          return Effect.succeed(!!providers[p]?.apiKey)
        }
      })

    const makeConfigLayer = (provider: ProviderType, modelName: string) =>
      Layer.succeed(Config, {
        get: () => Effect.succeed({
          model: { provider, model: modelName, temperature: 0.7, maxTokens: 4096 },
          models: [],
          permissions: { defaultAllow: ["read"] }
        } as any),
        getvalue: <K extends string>(key: K) => Effect.succeed(
          (key === "model"
            ? { provider, model: modelName, temperature: 0.7, maxTokens: 4096 }
            : undefined) as any
        ),
        getModel: () => Effect.succeed({
          provider,
          model: modelName,
          temperature: 0.7,
          maxTokens: 4096
        }),
        setModel: (_model: any) => Effect.succeed(undefined),
        getPermissions: () => Effect.succeed([]),
        isAllowed: () => Effect.succeed(true),
        reload: () => Effect.succeed({} as any),
        save: () => Effect.succeed(undefined),
      })

    it("无 API Key 时 isAvailable 应返回 false (集成)", async () => {
      const configLayer = makeConfigLayer("openai", "gpt-4o-mini")
      const authLayer = makeAuthLayer({})

      const program = Effect.gen(function* () {
        const provider = yield* Provider
        return yield* provider.isAvailable("openai")
      })

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(ProviderLive),
          Effect.provide(configLayer),
          Effect.provide(authLayer)
        )
      )

      expect(result).toBe(false)
    })

    it("有 API Key 时 isAvailable 应返回 true (集成)", async () => {
      const configLayer = makeConfigLayer("openai", "gpt-4o-mini")
      const authLayer = makeAuthLayer({
        openai: { apiKey: "sk-test-key-for-integration-testing" }
      })

      const program = Effect.gen(function* () {
        const provider = yield* Provider
        return yield* provider.isAvailable("openai")
      })

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(ProviderLive),
          Effect.provide(configLayer),
          Effect.provide(authLayer)
        )
      )

      expect(result).toBe(true)
    })
  })
})

// ====================================================
// 快速冒烟测试
// ====================================================

describe("Provider 快速冒烟", () => {

  it("Mock 快速生成测试", async () => {
    const program = Effect.gen(function* () {
      const provider = yield* Provider
      const result = yield* provider.generate([
        { role: "user", content: "1+1=?" }
      ])
      return result
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ProviderMockLive))
    )

    expect(result.content.length).toBeGreaterThan(0)
    expect(result.model.length).toBeGreaterThan(0)
    expect(result.usage).toBeDefined()
  })

  it("Mock 快速流式测试", async () => {
    const program = Effect.gen(function* () {
      const provider = yield* Provider
      const stream = provider.stream([
        { role: "user", content: "hello" }
      ])
      const chunks = yield* Stream.runCollect(stream)
      return Array.from(chunks)
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ProviderMockLive))
    )

    const doneChunk = result.find(c => c.type === "done")
    expect(doneChunk).toBeDefined()
  })

  it("Mock isAvailable 快速测试", async () => {
    const program = Effect.gen(function* () {
      const provider = yield* Provider
      return yield* provider.isAvailable()
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ProviderMockLive))
    )

    expect(result).toBe(true)
  })
})
