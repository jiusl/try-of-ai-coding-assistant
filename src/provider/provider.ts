// src/provider/provider.ts
import { Context, Effect, Layer, Stream, Schedule, Duration } from "effect"
import type { 
  Message, 
  GenerateOptions, 
  GenerateResponse, 
  StreamChunk,
  TokenUsage,
  ProviderType,
  ProviderError,
  SDKNotInstalledError,
  AuthError,
  ToolCall,
  ToolDefinition
} from "./types.js"
import { 
  ProviderError as ProviderErrorClass,
  SDKNotInstalledError as SDKNotInstalledErrorClass,
  AuthError as AuthErrorClass
} from "./types.js"
import { logger } from "../infra/logger.js"
import { Config } from "../config/config.js"
import { Auth } from "./auth.js"

// ====================================================
// SDK 动态加载
// ====================================================

interface SDKRegistry {
  openai: {
    OpenAI: new (config: OpenAIConfig) => OpenAIClient
  } | null
  anthropic: {
    Anthropic: new (config: AnthropicConfig) => AnthropicClient
  } | null
  deepseek: {
    OpenAI: new (config: OpenAIConfig) => OpenAIClient
  } | null
  ollama: {
    OpenAI: new (config: OpenAIConfig) => OpenAIClient
  } | null
  llama: {
    getLlama: () => Promise<LlamaCpp>
    LlamaChatSession: new (config: LlamaChatSessionConfig) => LlamaChatSession
  } | null
}

interface OpenAIClient {
  chat: {
    completions: {
      create(params: OpenAIRequest): Promise<OpenAIResponse>
    }
  }
}

interface AnthropicClient {
  messages: {
    create(params: AnthropicRequest): Promise<AnthropicResponse>
  }
}

interface OpenAIConfig {
  apiKey: string
  baseURL?: string
  organization?: string
}

interface AnthropicConfig {
  apiKey: string
  baseURL?: string
}

interface OpenAIRequest {
  model: string
  messages: { role: string; content: string }[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
  tools?: ToolDefinition[]
}

interface OpenAIResponse {
  id: string
  model: string
  choices: {
    index: number
    message: {
      role: string
      content: string | null
      tool_calls?: ToolCall[]
    }
    finish_reason: string
  }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface AnthropicRequest {
  model: string
  messages: { role: "user" | "assistant"; content: string }[]
  system?: string
  temperature?: number
  max_tokens: number
  stream?: boolean
  tools?: ToolDefinition[]
}

interface AnthropicResponse {
  id: string
  model: string
  content: { type: "text"; text: string }[]
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

// ========== node-llama-cpp 类型 ==========

interface LlamaCpp {
  loadModel(config: { modelPath: string }): Promise<LlamaModel>
}

interface LlamaModel {
  createContext(config?: { contextSize?: number }): Promise<LlamaContext>
  readonly trainContextSize: number
}

interface LlamaContext {
  getSequence(): LlamaContextSequence
}

interface LlamaContextSequence {}

interface LlamaChatSessionConfig {
  contextSequence: LlamaContextSequence
  systemPrompt?: string | undefined
}

interface LlamaChatSession {
  prompt(prompt: string, options?: {
    onTextChunk?: (chunk: string) => void
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
  }): Promise<string>
  dispose(): void
}

const sdkCache: SDKRegistry = {
  openai: null,
  anthropic: null,
  deepseek: null,
  ollama: null,
  llama: null
}

const loadOpenAICompatibleSDK = (provider: "openai" | "deepseek" | "ollama") =>
  Effect.gen(function* () {
    if (sdkCache[provider]) {
      return sdkCache[provider]
    }
    try {
      const module = yield* Effect.promise(() => import("openai"))
      sdkCache[provider] = module as unknown as { OpenAI: new (config: OpenAIConfig) => OpenAIClient }
      return sdkCache[provider]
    } catch (error) {
      return yield* Effect.fail(
        new SDKNotInstalledErrorClass({
          provider,
          installCommand: "bun add openai"
        })
      )
    }
  })

const loadAnthropicSDK = () =>
  Effect.gen(function* () {
    if (sdkCache.anthropic) {
      return sdkCache.anthropic
    }
    try {
      const module = yield* Effect.promise(() => import("@anthropic-ai/sdk"))
      sdkCache.anthropic = module as unknown as { Anthropic: new (config: AnthropicConfig) => AnthropicClient }
      return sdkCache.anthropic
    } catch (error) {
      return yield* Effect.fail(
        new SDKNotInstalledErrorClass({
          provider: "anthropic",
          installCommand: "bun add @anthropic-ai/sdk"
        })
      )
    }
  })



/** llama-cpp 模型实例缓存（加载一次，全局复用） */
let cachedLlamaModel: LlamaModel | null = null
let cachedLlamaContext: LlamaContext | null = null
let cachedLlamaModelPath: string | null = null

const loadLlamaCppSDK = () =>
  Effect.gen(function* () {
    if (sdkCache.llama) {
      return sdkCache.llama
    }
    try {
      const module: any = yield* Effect.promise(() => import("node-llama-cpp"))
      const sdk: NonNullable<SDKRegistry["llama"]> = module as any
      sdkCache.llama = sdk
      return sdk
    } catch (error) {
      return yield* Effect.fail(
        new SDKNotInstalledErrorClass({
          provider: "llama",
          installCommand: "bun add node-llama-cpp"
        })
      )
    }
  })

const getLlamaSession = (modelPath: string, systemPrompt?: string): Effect.Effect<{ session: LlamaChatSession; dispose: () => void }, ProviderErrorClass | SDKNotInstalledErrorClass> =>
  Effect.gen(function* () {
    const sdk = yield* loadLlamaCppSDK()
    if (cachedLlamaModelPath !== modelPath || !cachedLlamaModel || !cachedLlamaContext) {
      const llama = yield* Effect.tryPromise({
        try: () => sdk!.getLlama(),
        catch: (error) => new ProviderErrorClass({
          provider: "llama",
          message: "初始化 llama.cpp 失败: " + ((error as any).message ?? String(error))
        })
      })
      cachedLlamaModel = yield* Effect.tryPromise({
        try: () => llama.loadModel({ modelPath }),
        catch: (error) => new ProviderErrorClass({
          provider: "llama",
          message: "加载模型失败 (" + modelPath + "): " + ((error as any).message ?? String(error))
        })
      })
      cachedLlamaContext = yield* Effect.tryPromise({
        try: () => cachedLlamaModel!.createContext(),
        catch: (error) => new ProviderErrorClass({
          provider: "llama",
          message: "创建推理上下文失败: " + ((error as any).message ?? String(error))
        })
      })
      cachedLlamaModelPath = modelPath
    }
    const sessionOptions: Record<string, unknown> = {
      contextSequence: cachedLlamaContext.getSequence()
    }
    if (systemPrompt) sessionOptions.systemPrompt = systemPrompt
    const session = new (sdk.LlamaChatSession as any)(sessionOptions)
    return { session, dispose: () => { try { session.dispose() } catch (_) {} } }
  })

// ====================================================
// 通用工具函数
// ====================================================

/** 将内部 Message 转为 OpenAI 兼容的消息格式 */
const convertMessagesToOpenAI = (messages: Message[]): Record<string, unknown>[] =>
  messages.map(m => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content }
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
    if (m.tool_calls) msg.tool_calls = m.tool_calls
    return msg
  })

/** 解析 OpenAI 兼容的 response 为统一 GenerateResponse */
const parseOpenAIResponse = (
  response: OpenAIResponse,
  provider: ProviderType
): Effect.Effect<GenerateResponse, ProviderErrorClass> =>
  Effect.gen(function* () {
    const choice = response.choices[0]
    if (!choice) {
      return yield* Effect.fail(new ProviderErrorClass({
        provider,
        message: "API 未返回任何回复内容"
      }))
    }
    const result: Record<string, unknown> = {
      content: choice.message.content ?? "",
      model: response.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0
      }
    }
    if (choice.message.tool_calls) {
      result.tool_calls = choice.message.tool_calls
    }
    return result as unknown as GenerateResponse
  })

/** 将 OpenAI 兼容的流式响应转为 StreamChunk 异步生成器 */
async function* generateOpenAIStreamChunks(
  streamResponse: unknown
): AsyncGenerator<StreamChunk> {
  const iterable = streamResponse as AsyncIterable<any>
  // 聚合分片 tool_call delta（index → 累加器）
  const toolCallAcc = new Map<number, { id: string; name: string; args: string }>()
  let lastUsage: TokenUsage | undefined

  for await (const chunk of iterable) {
    const delta = chunk.choices?.[0]?.delta
    const content: string = delta?.content || ""

    if (content) {
      yield { type: "content", content } as StreamChunk
    }

    // 聚合分片 tool_call delta（name + arguments 是分片到达的）
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        if (!toolCallAcc.has(idx)) {
          toolCallAcc.set(idx, { id: tc.id ?? "", name: "", args: "" })
        }
        const acc = toolCallAcc.get(idx)!
        if (tc.id) acc.id = tc.id
        if (tc.function?.name) acc.name += tc.function.name
        if (tc.function?.arguments) acc.args += tc.function.arguments
      }
    }

    // 捕获最后一帧的 usage（OpenAI/DeepSeek 流式最后 chunk 带 usage）
    if (chunk.usage) {
      lastUsage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        totalTokens: chunk.usage.total_tokens ?? 0,
      }
    }
  }

  // 流结束后 yield 聚合完成的 tool_calls
  for (const [, acc] of toolCallAcc) {
    if (acc.name) {
      yield {
        type: "tool_call",
        tool_call: {
          id: acc.id || crypto.randomUUID(),
          type: "function",
          function: { name: acc.name, arguments: acc.args },
        },
      } as StreamChunk
    }
  }

  yield { type: "done", usage: lastUsage } as StreamChunk
}

/** 增强 ProviderError，附加上下文信息 */
function enrichProviderError(
  error: unknown,
  provider: ProviderType,
  context: { model?: string; baseUrl?: string; endpoint?: string }
): ProviderErrorClass {
  if (error instanceof ProviderErrorClass) {
    if (!error.message.includes("url") && !error.message.includes("URL")) {
      const parts: string[] = []
      if (context.baseUrl) parts.push(`目标地址: ${context.baseUrl}`)
      if (context.model) parts.push(`模型: ${context.model}`)
      if (parts.length > 0) {
        const p: {
          provider: ProviderType
          message: string
          statusCode?: number
          cause?: unknown
        } = {
          provider: error.provider ?? provider,
          message: `${error.message}（${parts.join("，")}）`,
          cause: error.cause,
        }
        if (error.statusCode !== undefined) p.statusCode = error.statusCode
        return new ProviderErrorClass(p)
      }
    }
    return error
  }
  const msg = error instanceof Error ? error.message : String(error)
  const parts: string[] = []
  if (context.baseUrl) parts.push(`目标地址: ${context.baseUrl}`)
  if (context.model) parts.push(`模型: ${context.model}`)
  const fullMsg = parts.length > 0 ? `${msg}（${parts.join("，")}）` : msg
  return new ProviderErrorClass({ provider, message: fullMsg, cause: error })
}

/** 将 Auth 层通用 Error 包装为 AuthError */
const wrapAuthError = <A>(
  effect: Effect.Effect<A, Error>,
  provider: ProviderType
): Effect.Effect<A, AuthErrorClass> =>
  effect.pipe(
    Effect.mapError(e => new AuthErrorClass({
      provider,
      message: e instanceof Error ? e.message : String(e)
    }))
  )

// ====================================================
// 服务接口定义
// ====================================================

export interface ProviderService {
  /** 生成文本（非流式） */
  readonly generate: (
    messages: Message[],
    options?: GenerateOptions
  ) => Effect.Effect<GenerateResponse, ProviderErrorClass | SDKNotInstalledErrorClass | AuthErrorClass>
  
  /** 生成文本（流式）- 返回 Stream */
  readonly stream: (
    messages: Message[],
    options?: GenerateOptions
  ) => Stream.Stream<StreamChunk, ProviderErrorClass | SDKNotInstalledErrorClass | AuthErrorClass>
  
  /** 检查 Provider 是否可用 */
  readonly isAvailable: (provider?: string) => Effect.Effect<boolean>
}

export class Provider extends Context.Tag("Provider")<Provider, ProviderService>() {}

// ====================================================
// 辅助函数
// ====================================================

/**
 * 根据模型名推断 provider，同时接受 config 中配置的 provider 作为参考。
 * 返回 { provider, warning } — warning 非空时表示路由存在异常需提醒用户。
 */
const resolveProvider = (
  model?: string,
  configProvider?: string
): { provider: ProviderType; warning?: string } => {
  if (!model) {
    return { provider: (configProvider as ProviderType) || "openai" }
  }

  const openaiModels = ["gpt-", "o1-", "o3-"]
  const anthropicModels = ["claude-"]
  const deepseekModels = ["deepseek-"]
  const ollamaModels = [
    "llama", "qwen", "mistral", "mixtral", "gemma", "phi",
    "codellama", "yi-", "neural-chat", "solar", "dolphin",
    "nous-hermes", "wizard", "openchat", "tinyllama", "stablelm",
    "command-r", "orca", "falcon", "vicuna", "zephyr", "bakllava",
    "llava", "nomic-", "mxbai-", "all-minilm", "bge-", "e5-",
    "deepseek-r1", "deepseek-coder"
  ]

  let detected: ProviderType | null = null

  for (const prefix of openaiModels) {
    if (model.includes(prefix)) { detected = "openai"; break }
  }
  if (!detected) {
    for (const prefix of anthropicModels) {
      if (model.includes(prefix)) { detected = "anthropic"; break }
    }
  }
  if (!detected) {
    for (const prefix of deepseekModels) {
      if (model.includes("deepseek-r1") || model.includes("deepseek-coder")) continue
      if (model.includes(prefix)) { detected = "deepseek"; break }
    }
  }
  if (!detected) {
    for (const prefix of ollamaModels) {
      if (model.includes(prefix)) { detected = "ollama"; break }
    }
  }

  // 有明确的 config provider 时优先使用
  if (configProvider && configProvider !== "llama") {
    if (detected && detected !== configProvider) {
      const warn = `模型名 "${model}" 看起来像 ${detected} 模型，但当前配置的 provider 是 ${configProvider}，将使用 ${configProvider} 调用。如遇错误请检查设置面板中的 provider 和模型名是否匹配。`
      logger.warn(`[Provider] ${warn}`)
      return { provider: configProvider as ProviderType, warning: warn }
    }
    if (!detected) {
      // 未识别模型名但 config 指定了 provider，信任 config
      return { provider: configProvider as ProviderType }
    }
    return { provider: detected }
  }

  if (!detected) {
    const warn = `模型名 "${model}" 未被识别为任何已知云端 provider，将兜底使用本地 llama.cpp 推理。请检查模型名是否正确，或在设置面板中明确选择 provider。`
    logger.warn(`[Provider] ${warn}`)
    return { provider: "llama", warning: warn }
  }

  return { provider: detected }
}

// ====================================================
// Provider 实现
// ====================================================

export const ProviderLive = Layer.effect(
  Provider,
  Effect.gen(function* () {
    const config = yield* Config
    const auth = yield* Auth

    // Auth 包装器
    const getApiKey = (p: string) => wrapAuthError(auth.getApiKey(p), p as ProviderType)
    const getBaseUrl = (p: string) => wrapAuthError(auth.getBaseUrl(p), p as ProviderType)
    const getOrganization = (p: string) => wrapAuthError(auth.getOrganization(p), p as ProviderType)
    const validateApiKey = (p?: string) => wrapAuthError(auth.validateApiKey(p), (p ?? "openai") as ProviderType)

    const getModelConfig = () =>
      Effect.gen(function* () {
        const mc = yield* config.getModel().pipe(
          Effect.mapError(e => new ProviderErrorClass({
            provider: "openai",
            message: e instanceof Error ? e.message : String(e)
          }))
        )
        return mc
      })

    const DEFAULT_BASE_URLS: Record<string, string> = {
      deepseek: "https://api.deepseek.com/v1",
      ollama: "http://localhost:11434/v1"
    }

    // ========== 非流式调用 ==========

    const callOpenAICompatible = (
      provider: "openai" | "deepseek" | "ollama",
      messages: Message[],
      model: string,
      temperature: number,
      maxTokens: number,
      tools?: ToolDefinition[]
    ) =>
      Effect.gen(function* () {
        const sdk = yield* loadOpenAICompatibleSDK(provider)
        const apiKey = yield* getApiKey(provider)
        const baseUrl = yield* getBaseUrl(provider)

        const clientConfig: Record<string, unknown> = {
          apiKey,
          baseURL: baseUrl || DEFAULT_BASE_URLS[provider]
        }
        if (provider === "openai") {
          const org = yield* getOrganization("openai")
          if (org) clientConfig.organization = org
        }
        const client = new sdk.OpenAI(clientConfig as unknown as OpenAIConfig)

        const req: Record<string, unknown> = {
          model,
          messages: convertMessagesToOpenAI(messages),
          temperature,
          max_tokens: maxTokens
        }
        if (tools) req.tools = tools

        const response = yield* Effect.tryPromise({
          try: () => client.chat.completions.create(req as unknown as OpenAIRequest),
          catch: (error: any) => {
            const effectiveUrl = baseUrl || DEFAULT_BASE_URLS[provider] || undefined
            const ctx: { model?: string; baseUrl?: string } = { model }
            if (effectiveUrl) ctx.baseUrl = effectiveUrl
            return enrichProviderError(new ProviderErrorClass({
              provider,
              statusCode: error.status,
              message: error.message ?? String(error),
              cause: error,
            }), provider, ctx)
          },
        })
        return yield* parseOpenAIResponse(response, provider)
      })

    const callAnthropic = (
      messages: Message[],
      model: string,
      temperature: number,
      maxTokens: number,
      tools?: ToolDefinition[]
    ) =>
      Effect.gen(function* () {
        const sdk = yield* loadAnthropicSDK()
        const apiKey = yield* getApiKey("anthropic")
        const baseUrl = yield* getBaseUrl("anthropic")

        const cc: Record<string, unknown> = { apiKey }
        if (baseUrl) cc.baseURL = baseUrl
        const client = new sdk.Anthropic(cc as unknown as AnthropicConfig)

        const systemMessage = messages.find(m => m.role === "system")
        const chatMessages = messages
          .filter(m => m.role !== "system")
          .map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content
          }))

        const req: Record<string, unknown> = {
          model,
          messages: chatMessages,
          temperature,
          max_tokens: maxTokens
        }
        if (systemMessage?.content) req.system = systemMessage.content
        if (tools) req.tools = tools

        const response = yield* Effect.tryPromise({
          try: () => client.messages.create(req as unknown as AnthropicRequest),
          catch: (error: any) => {
            const ctx: { model?: string; baseUrl?: string } = { model }
            if (baseUrl) ctx.baseUrl = baseUrl
            return enrichProviderError(new ProviderErrorClass({
              provider: "anthropic",
              statusCode: error.status,
              message: error.message ?? String(error),
              cause: error,
            }), "anthropic", ctx)
          },
        })

        return {
          content: response.content.find(c => c.type === "text")?.text ?? "",
          model: response.model,
          usage: {
            promptTokens: response.usage?.input_tokens ?? 0,
            completionTokens: response.usage?.output_tokens ?? 0,
            totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
          }
        } as GenerateResponse
      })

    // ========== 流式调用 ==========

    const streamOpenAICompatible = (
      provider: "openai" | "deepseek" | "ollama",
      messages: Message[],
      model: string,
      temperature: number,
      maxTokens: number,
      tools?: ToolDefinition[]
    ) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sdk = yield* loadOpenAICompatibleSDK(provider)
          const apiKey = yield* getApiKey(provider)
          const baseUrl = yield* getBaseUrl(provider)

          const cc: Record<string, unknown> = {
            apiKey,
            baseURL: baseUrl || DEFAULT_BASE_URLS[provider]
          }
          if (provider === "openai") {
            const org = yield* getOrganization("openai")
            if (org) cc.organization = org
          }
          const client = new sdk.OpenAI(cc as unknown as OpenAIConfig)

          const req: Record<string, unknown> = {
            model,
            messages: convertMessagesToOpenAI(messages),
            temperature,
            max_tokens: maxTokens,
            stream: true as const
          }
          if (tools) req.tools = tools

          const streamResponse = yield* Effect.tryPromise({
            try: () => client.chat.completions.create(req as unknown as OpenAIRequest),
            catch: (error: any) => {
              const effectiveUrl = baseUrl || DEFAULT_BASE_URLS[provider] || undefined
              const ctx: { model?: string; baseUrl?: string } = { model }
              if (effectiveUrl) ctx.baseUrl = effectiveUrl
              return enrichProviderError(new ProviderErrorClass({
                provider,
                statusCode: error.status,
                message: error.message ?? String(error),
                cause: error,
              }), provider, ctx)
            },
          })

          return Stream.fromAsyncIterable(
            generateOpenAIStreamChunks(streamResponse),
            (error: any) => new ProviderErrorClass({
              provider,
              message: error.message ?? String(error),
              cause: error
            })
          )
        })
      )

    const streamAnthropic = (
      messages: Message[],
      model: string,
      temperature: number,
      maxTokens: number,
      tools?: ToolDefinition[]
    ) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sdk = yield* loadAnthropicSDK()
          const apiKey = yield* getApiKey("anthropic")
          const baseUrl = yield* getBaseUrl("anthropic")

          const cc: Record<string, unknown> = { apiKey }
          if (baseUrl) cc.baseURL = baseUrl
          const client = new sdk.Anthropic(cc as unknown as AnthropicConfig)

          const systemMessage = messages.find(m => m.role === "system")
          const chatMessages = messages
            .filter(m => m.role !== "system")
            .map(m => ({
              role: m.role as "user" | "assistant",
              content: m.content
            }))

          const req: Record<string, unknown> = {
            model,
            messages: chatMessages,
            temperature,
            max_tokens: maxTokens,
            stream: true as const
          }
          if (systemMessage?.content) req.system = systemMessage.content
          if (tools) req.tools = tools

          const streamResponse = yield* Effect.tryPromise({
            try: () => client.messages.create(req as unknown as AnthropicRequest),
            catch: (error: any) => {
              const ctx: { model?: string; baseUrl?: string } = { model }
              if (baseUrl) ctx.baseUrl = baseUrl
              return enrichProviderError(new ProviderErrorClass({
                provider: "anthropic",
                statusCode: error.status,
                message: error.message ?? String(error),
                cause: error,
              }), "anthropic", ctx)
            },
          })

          async function* gen(): AsyncGenerator<StreamChunk> {
            const iterable = streamResponse as unknown as AsyncIterable<any>
            // Anthropic tool_use 聚合（index → 累加器）
            const toolAcc = new Map<number, { id: string; name: string; args: string }>()
            let anthroUsage: TokenUsage | undefined

            for await (const chunk of iterable) {
              // 文本增量
              if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
                yield { type: "content", content: chunk.delta.text } as StreamChunk
              }

              // tool_use 开始 — 记录 name + id
              if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
                const tu = chunk.content_block
                toolAcc.set(tu.index ?? 0, { id: tu.id ?? "", name: tu.name ?? "", args: "" })
              }

              // tool_use JSON 增量 — 拼接 arguments
              if (chunk.type === "content_block_delta" && chunk.delta?.type === "input_json_delta") {
                const idx = chunk.index ?? 0
                const partial = chunk.delta.partial_json ?? ""
                if (!toolAcc.has(idx)) toolAcc.set(idx, { id: "", name: "", args: "" })
                toolAcc.get(idx)!.args += partial
              }

              // 捕获 message 级 usage（Anthropic 在 message_start/delta/message_stop 中带 usage）
              if (chunk.type === "message_start" && chunk.message?.usage) {
                anthroUsage = {
                  promptTokens: chunk.message.usage.input_tokens ?? 0,
                  completionTokens: chunk.message.usage.output_tokens ?? 0,
                  totalTokens: (chunk.message.usage.input_tokens ?? 0) + (chunk.message.usage.output_tokens ?? 0),
                }
              }
              if (chunk.type === "message_delta" && chunk.usage) {
                anthroUsage = {
                  promptTokens: anthroUsage?.promptTokens ?? 0,
                  completionTokens: (anthroUsage?.completionTokens ?? 0) + (chunk.usage.output_tokens ?? 0),
                  totalTokens: (anthroUsage?.totalTokens ?? 0) + (chunk.usage.output_tokens ?? 0),
                }
              }
            }

            // yield 聚合好的 tool_calls
            for (const [, acc] of toolAcc) {
              if (acc.name) {
                yield {
                  type: "tool_call",
                  tool_call: {
                    id: acc.id || crypto.randomUUID(),
                    type: "function",
                    function: { name: acc.name, arguments: acc.args },
                  },
                } as StreamChunk
              }
            }

            yield { type: "done", usage: anthroUsage } as StreamChunk
          }

          return Stream.fromAsyncIterable(gen(), (error: any) =>
            new ProviderErrorClass({
              provider: "anthropic",
              message: error.message ?? String(error),
              cause: error
            })
          )
        })
      )



    // ========== 本地 llama.cpp 调用（兜底） ==========

    /** 自动探测 model/ 目录下的 .gguf 文件 */
    const findLocalModelPath = (): Effect.Effect<string, ProviderErrorClass> =>
      Effect.gen(function* () {
        const fsMod: any = yield* Effect.tryPromise(() => import("fs/promises")).pipe(
          Effect.catchAll(() => Effect.die("无法加载 fs/promises 模块"))
        )
        const pathMod: any = yield* Effect.tryPromise(() => import("path")).pipe(
          Effect.catchAll(() => Effect.die("无法加载 path 模块"))
        )
        const modelDir: string = pathMod.default.join(process.cwd(), "model")
        const entries: string[] = yield* Effect.tryPromise(() => fsMod.default.readdir(modelDir) as Promise<string[]>).pipe(
          Effect.orElseSucceed(() => [])
        )
        const ggufFiles: string[] = entries
          .filter((f: string) => f.endsWith(".gguf"))
          .map((f: string) => pathMod.default.join(modelDir, f))
          .sort()
        if (ggufFiles.length === 0) {
          return yield* Effect.fail(new ProviderErrorClass({
            provider: "llama",
            message: "model/ 目录下未找到 .gguf 模型文件，请放置一个 GGUF 模型用于本地推理兜底"
          }))
        }
        return ggufFiles[0]!
      })

    /** 将 Message[] 转为纯文本 prompt */
    const messagesToPrompt = (messages: Message[]): string =>
      messages.map((m: Message) => {
        switch (m.role) {
          case "system": return "<|system|>\n" + (m.content ?? "") + "</s>"
          case "user": return "<|user|>\n" + (m.content ?? "") + "</s>"
          case "assistant": return "<|assistant|>\n" + (m.content ?? "") + "</s>"
          case "tool": return "<|tool|>\n" + (m.content ?? "") + "</s>"
          default: return m.content ?? ""
        }
      }).join("\n") + "\n<|assistant|>\n"

    const callLlama = (
      messages: Message[],
      temperature: number,
      maxTokens: number
    ): Effect.Effect<GenerateResponse, ProviderErrorClass | SDKNotInstalledErrorClass> =>
      Effect.gen(function* () {
        const modelPath = yield* findLocalModelPath()
        const systemMsg: string | undefined = messages.find((m: Message) => m.role === "system")?.content || undefined
        const { session, dispose } = yield* getLlamaSession(modelPath, systemMsg)
        try {
          const prompt: string = messagesToPrompt(messages.filter((m: Message) => m.role !== "system"))
          const content = yield* Effect.tryPromise({
            try: () => session.prompt(prompt, { temperature, maxTokens }),
            catch: (error: unknown) => new ProviderErrorClass({
              provider: "llama",
              message: (error as any).message ?? String(error)
            })
          })
          return {
            content,
            model: modelPath.split(/[\\\/]/).pop()! ,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          }
        } finally {
          dispose()
        }
      })

    const streamLlama = (
      messages: Message[],
      temperature: number,
      maxTokens: number
    ): Stream.Stream<StreamChunk, ProviderErrorClass | SDKNotInstalledErrorClass> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const modelPath = yield* findLocalModelPath()
          const systemMsg: string | undefined = messages.find((m: Message) => m.role === "system")?.content || undefined
          const { session, dispose } = yield* getLlamaSession(modelPath, systemMsg)
          const prompt: string = messagesToPrompt(messages.filter((m: Message) => m.role !== "system"))

          async function* gen() {
            try {
              const bridge: StreamChunk[] = []
              await session.prompt(prompt, {
                temperature,
                maxTokens,
                onTextChunk(chunk: string) {
                  bridge.push({ type: "content" as const, content: chunk } as StreamChunk)
                }
              })
              for (const item of bridge) {
                yield item
              }
              yield { type: "done" as const } as StreamChunk
            } catch (error: unknown) {
              yield {
                type: "error" as const,
                error: new ProviderErrorClass({
                  provider: "llama",
                  message: (error as any).message ?? String(error)
                })
              }
            } finally {
              dispose()
            }
          }

          return Stream.fromAsyncIterable(gen(), (error: unknown) =>
            new ProviderErrorClass({
              provider: "llama",
              message: (error as any).message ?? String(error),
              cause: error
            })
          )
        })
      )

    // ========== 路由 ==========

    const retryPolicy = Schedule.intersect(
      Schedule.exponential(Duration.millis(500), 2.0),
      Schedule.recurs(3)
    )

    const generate = (messages: Message[], options?: GenerateOptions) =>
      Effect.gen(function* () {
        const mc = yield* getModelConfig()
        const targetModel = options?.model ?? mc.model
        const { provider, warning } = resolveProvider(targetModel, mc.provider)
        const temperature = options?.temperature ?? mc.temperature ?? 0.7
        const maxTokens = options?.maxTokens ?? mc.maxTokens ?? 4096
        const tools = options?.tools

        const result = yield* (() => { switch (provider) {
          case "openai":
          case "deepseek":
          case "ollama":
            return callOpenAICompatible(provider, messages, targetModel, temperature, maxTokens, tools)
          case "anthropic":
            return callAnthropic(messages, targetModel, temperature, maxTokens, tools)
          case "llama":
            return callLlama(messages, temperature, maxTokens)
          default:
            return Effect.fail(new ProviderErrorClass({
              provider: provider as ProviderType,
              message: `不支持的 Provider: ${provider}`
            }))
        } })() as Effect.Effect<GenerateResponse, ProviderErrorClass | SDKNotInstalledErrorClass>

        if (warning) {
          return { ...result, warning }
        }
        return result
      }).pipe(Effect.retry(retryPolicy))

    const stream = (messages: Message[], options?: GenerateOptions) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const mc = yield* getModelConfig()
          const targetModel = options?.model ?? mc.model
          const { provider, warning } = resolveProvider(targetModel, mc.provider)
          const temperature = options?.temperature ?? mc.temperature ?? 0.7
          const maxTokens = options?.maxTokens ?? mc.maxTokens ?? 4096
          const tools = options?.tools

          const baseStream = (() => { switch (provider) {
            case "openai":
            case "deepseek":
            case "ollama":
              return streamOpenAICompatible(provider, messages, targetModel, temperature, maxTokens, tools)
            case "anthropic":
              return streamAnthropic(messages, targetModel, temperature, maxTokens, tools)
            case "llama":
              return streamLlama(messages, temperature, maxTokens)
            default:
              return Stream.fail(new ProviderErrorClass({
                provider: provider as ProviderType,
                message: `Streaming not supported for provider: ${provider}`
              }))
          } })() as Stream.Stream<StreamChunk, ProviderErrorClass | SDKNotInstalledErrorClass>

          // 如果有警告，在流开头插入 warning chunk
          if (warning) {
            return Stream.concat(
              Stream.make({ type: "warning" as const, content: warning } as StreamChunk),
              baseStream
            )
          }
          return baseStream
        })
      )

    const isAvailable = (provider?: string) =>
      Effect.gen(function* () {
        const tp: string = provider ?? (yield* getModelConfig()).provider
        if (tp === "llama") {
          return yield* Effect.gen(function* () {
            yield* loadLlamaCppSDK()
            yield* findLocalModelPath()
            return true
          }).pipe(Effect.catchAll(() => Effect.succeed(false)))
        }
        return yield* validateApiKey(tp)
      }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    return { generate, stream, isAvailable }
  })
)

// ====================================================
// Mock 版本（用于测试）
// ====================================================

export const ProviderMockLive = Layer.succeed(Provider, {
  generate: (messages: Message[]) =>
    Effect.succeed({
      content: `Mock response to: ${messages.map(m => m.content).join(", ")}`,
      model: "mock-model",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
    }),
  stream: (messages: Message[]) =>
    Stream.fromIterable([
      { type: "content", content: "Mock " },
      { type: "content", content: "stream " },
      { type: "content", content: "response" },
      { type: "done" }
    ] as StreamChunk[]),
  isAvailable: () => Effect.succeed(true)
})
