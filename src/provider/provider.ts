// src/provider/provider.ts
import { Context, Effect, Layer, Stream, Schedule, Duration } from "effect"
import type { 
  Message, 
  GenerateOptions, 
  GenerateResponse, 
  StreamChunk,
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
import { Config } from "../config/config.js"
import { Auth } from "./auth.js"

// ====================================================
// SDK 动态加载（懒加载，避免强制依赖）
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

const sdkCache: SDKRegistry = {
  openai: null,
  anthropic: null,
  deepseek: null
}

const loadOpenAISDK = () =>
  Effect.gen(function* () {
    if (sdkCache.openai) {
      return sdkCache.openai
    }
    
    try {
      const module = yield* Effect.promise(() => import("openai"))
      sdkCache.openai = module as unknown as { OpenAI: new (config: OpenAIConfig) => OpenAIClient }
      return sdkCache.openai
    } catch (error) {
      return yield* Effect.fail(
        new SDKNotInstalledErrorClass({
          provider: "openai",
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

const loadDeepSeekSDK = () =>
  Effect.gen(function* () {
    if (sdkCache.deepseek) {
      return sdkCache.deepseek
    }
    
    try {
      // DeepSeek 兼容 OpenAI SDK，复用 openai 包
      const module = yield* Effect.promise(() => import("openai"))
      sdkCache.deepseek = module as unknown as { OpenAI: new (config: OpenAIConfig) => OpenAIClient }
      return sdkCache.deepseek
    } catch (error) {
      return yield* Effect.fail(
        new SDKNotInstalledErrorClass({
          provider: "deepseek",
          installCommand: "bun add openai"
        })
      )
    }
  })

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

const getProviderFromModel = (model?: string): Effect.Effect<ProviderType, ProviderErrorClass> =>
  Effect.gen(function* () {
    if (!model) {
      return "openai" as ProviderType  // 默认
    }
    
    // 根据模型名称判断 provider
    const openaiModels = ["gpt-", "o1-", "o3-"]
    const anthropicModels = ["claude-"]
    const deepseekModels = ["deepseek-"]
    
    for (const prefix of openaiModels) {
      if (model.includes(prefix)) return "openai"
    }
    for (const prefix of anthropicModels) {
      if (model.includes(prefix)) return "anthropic"
    }
    for (const prefix of deepseekModels) {
      if (model.includes(prefix)) return "deepseek"
    }
    
    // 默认返回 openai
    return "openai"
  }).pipe(
    Effect.mapError(error => new ProviderErrorClass({
      provider: "openai",
      message: `无法根据模型名称推断 Provider: ${error}`
    }))
  )

// ====================================================
// Provider 实现
// ====================================================

export const ProviderLive = Layer.effect(
  Provider,
  Effect.gen(function* () {
    const config = yield* Config
    const auth = yield* Auth
    
    // 将 Auth 层返回的通用 Error 转为 AuthError
    const getApiKey = (provider: string) =>
      auth.getApiKey(provider).pipe(
        Effect.mapError(e => new AuthErrorClass({
          provider: provider as ProviderType,
          message: e instanceof Error ? e.message : String(e)
        }))
      )
    const getBaseUrl = (provider: string) =>
      auth.getBaseUrl(provider).pipe(
        Effect.mapError(e => new AuthErrorClass({
          provider: provider as ProviderType,
          message: e instanceof Error ? e.message : String(e)
        }))
      )
    const getOrganization = (provider: string) =>
      auth.getOrganization(provider).pipe(
        Effect.mapError(e => new AuthErrorClass({
          provider: provider as ProviderType,
          message: e instanceof Error ? e.message : String(e)
        }))
      )
    const validateApiKey = (provider?: string) =>
      auth.validateApiKey(provider).pipe(
        Effect.mapError(e => new AuthErrorClass({
          provider: (provider ?? "openai") as ProviderType,
          message: e instanceof Error ? e.message : String(e)
        }))
      )
    
    // 获取当前模型配置
    const getModelConfig = () =>
      Effect.gen(function* () {
        const modelConfig = yield* config.getModel().pipe(
          Effect.mapError(e => new ProviderErrorClass({
            provider: "openai",
            message: e instanceof Error ? e.message : String(e)
          }))
        )
        return modelConfig
      })
    
    // OpenAI 非流式调用
    const callOpenAI = (
      messages: Message[],
      model: string,
      temperature: number,
      maxTokens: number,
      tools?: ToolDefinition[]
    ) =>
      Effect.gen(function* () {
        const sdk = yield* loadOpenAISDK()
        const apiKey = yield* getApiKey("openai")
        const baseUrl = yield* getBaseUrl("openai")
        const organization = yield* getOrganization("openai")
        
        const clientConfig: Record<string, unknown> = { apiKey }
        if (baseUrl) clientConfig.baseURL = baseUrl
        if (organization) clientConfig.organization = organization
        const client = new sdk.OpenAI(clientConfig as unknown as OpenAIConfig)
        
        const requestParams: Record<string, unknown> = {
          model,
          messages: messages.map(m => {
            const msg: Record<string, unknown> = { role: m.role, content: m.content }
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
            if (m.tool_calls) msg.tool_calls = m.tool_calls
            return msg
          }),
          temperature,
          max_tokens: maxTokens
        }
        if (tools) requestParams.tools = tools
        
        const response = yield* Effect.tryPromise({
          try: () => client.chat.completions.create(requestParams as unknown as OpenAIRequest),
          catch: (error: any) => new ProviderErrorClass({
            provider: "openai",
            statusCode: error.status,
            message: error.message,
            cause: error
          })
        })
        
        const choice = response.choices[0]
        if (!choice) {
          return yield* Effect.fail(new ProviderErrorClass({
            provider: "openai",
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
    
    // Anthropic 非流式调用
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
        
        const clientConfig: Record<string, unknown> = { apiKey }
        if (baseUrl) clientConfig.baseURL = baseUrl
        const client = new sdk.Anthropic(clientConfig as unknown as AnthropicConfig)
        
        // 提取 system message
        const systemMessage = messages.find(m => m.role === "system")
        const chatMessages = messages
          .filter(m => m.role !== "system")
          .map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content
          }))
        
        const requestParams: Record<string, unknown> = {
          model,
          messages: chatMessages,
          temperature,
          max_tokens: maxTokens
        }
        if (systemMessage?.content) requestParams.system = systemMessage.content
        if (tools) requestParams.tools = tools
        
        const response = yield* Effect.tryPromise({
          try: () => client.messages.create(requestParams as unknown as AnthropicRequest),
          catch: (error: any) => new ProviderErrorClass({
            provider: "anthropic",
            statusCode: error.status,
            message: error.message,
            cause: error
          })
        })
        
        const textContent = response.content.find(c => c.type === "text")?.text ?? ""
        
        return {
          content: textContent,
          model: response.model,
          usage: {
            promptTokens: response.usage?.input_tokens ?? 0,
            completionTokens: response.usage?.output_tokens ?? 0,
            totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
          }
        } as GenerateResponse
      })
    
    // DeepSeek 非流式调用（兼容 OpenAI API）
    const callDeepSeek = (
      messages: Message[],
      model: string,
      temperature: number,
      maxTokens: number,
      tools?: ToolDefinition[]
    ) =>
      Effect.gen(function* () {
        const sdk = yield* loadDeepSeekSDK()
        const apiKey = yield* getApiKey("deepseek")
        const baseUrl = yield* getBaseUrl("deepseek")
        
        const clientConfig: Record<string, unknown> = {
          apiKey,
          baseURL: baseUrl || "https://api.deepseek.com/v1"
        }
        const client = new sdk.OpenAI(clientConfig as unknown as OpenAIConfig)
        
        const requestParams: Record<string, unknown> = {
          model,
          messages: messages.map(m => {
            const msg: Record<string, unknown> = { role: m.role, content: m.content }
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
            if (m.tool_calls) msg.tool_calls = m.tool_calls
            return msg
          }),
          temperature,
          max_tokens: maxTokens
        }
        if (tools) requestParams.tools = tools
        
        const response = yield* Effect.tryPromise({
          try: () => client.chat.completions.create(requestParams as unknown as OpenAIRequest),
          catch: (error: any) => new ProviderErrorClass({
            provider: "deepseek",
            statusCode: error.status,
            message: error.message,
            cause: error
          })
        })
        
        const choice = response.choices[0]
        if (!choice) {
          return yield* Effect.fail(new ProviderErrorClass({
            provider: "deepseek",
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
    
    // OpenAI 流式调用
    const streamOpenAI = (
      messages: Message[],
      model: string,
      temperature: number,
      maxTokens: number,
      tools?: ToolDefinition[]
    ) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sdk = yield* loadOpenAISDK()
          const apiKey = yield* getApiKey("openai")
          const baseUrl = yield* getBaseUrl("openai")
          const organization = yield* getOrganization("openai")
          
          const clientConfig: Record<string, unknown> = { apiKey }
          if (baseUrl) clientConfig.baseURL = baseUrl
          if (organization) clientConfig.organization = organization
          const client = new sdk.OpenAI(clientConfig as unknown as OpenAIConfig)
          
          const requestParams: Record<string, unknown> = {
            model,
            messages: messages.map(m => {
              const msg: Record<string, unknown> = { role: m.role, content: m.content }
              if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
              if (m.tool_calls) msg.tool_calls = m.tool_calls
              return msg
            }),
            temperature,
            max_tokens: maxTokens,
            stream: true as const
          }
          if (tools) requestParams.tools = tools
          
          const streamResponse = yield* Effect.tryPromise({
            try: () => client.chat.completions.create(requestParams as unknown as OpenAIRequest),
            catch: (error: any) => new ProviderErrorClass({
              provider: "openai",
              statusCode: error.status,
              message: error.message,
              cause: error
            })
          })
          
          async function* generateChunks(): AsyncGenerator<StreamChunk> {
            const iterable = streamResponse as unknown as AsyncIterable<any>
            for await (const chunk of iterable) {
              const content = chunk.choices?.[0]?.delta?.content || ""
              const toolCalls = chunk.choices?.[0]?.delta?.tool_calls
              
              if (content) {
                yield { type: "content", content } as StreamChunk
              }
              
              if (toolCalls && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                  yield {
                    type: "tool_call",
                    tool_call: tc as ToolCall
                  } as StreamChunk
                }
              }
            }
            yield { type: "done" } as StreamChunk
          }
          
          return Stream.fromAsyncIterable(generateChunks(), (error: any) =>
            new ProviderErrorClass({
              provider: "openai",
              message: error.message ?? String(error),
              cause: error
            })
          )
        })
      )
    
    // Anthropic 流式调用
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
          
          const clientConfig: Record<string, unknown> = { apiKey }
          if (baseUrl) clientConfig.baseURL = baseUrl
          const client = new sdk.Anthropic(clientConfig as unknown as AnthropicConfig)
          
          const systemMessage = messages.find(m => m.role === "system")
          const chatMessages = messages
            .filter(m => m.role !== "system")
            .map(m => ({
              role: m.role as "user" | "assistant",
              content: m.content
            }))
          
          const requestParams: Record<string, unknown> = {
            model,
            messages: chatMessages,
            temperature,
            max_tokens: maxTokens,
            stream: true as const
          }
          if (systemMessage?.content) requestParams.system = systemMessage.content
          if (tools) requestParams.tools = tools
          
          const streamResponse = yield* Effect.tryPromise({
            try: () => client.messages.create(requestParams as unknown as AnthropicRequest),
            catch: (error: any) => new ProviderErrorClass({
              provider: "anthropic",
              statusCode: error.status,
              message: error.message,
              cause: error
            })
          })
          
          async function* generateChunks(): AsyncGenerator<StreamChunk> {
            const iterable = streamResponse as unknown as AsyncIterable<any>
            for await (const chunk of iterable) {
              if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
                yield { type: "content", content: chunk.delta.text } as StreamChunk
              }
            }
            yield { type: "done" } as StreamChunk
          }
          
          return Stream.fromAsyncIterable(generateChunks(), (error: any) =>
            new ProviderErrorClass({
              provider: "anthropic",
              message: error.message ?? String(error),
              cause: error
            })
          )
        })
      )
    
    // DeepSeek 流式调用（兼容 OpenAI API）
    const streamDeepSeek = (
      messages: Message[],
      model: string,
      temperature: number,
      maxTokens: number,
      tools?: ToolDefinition[]
    ) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sdk = yield* loadDeepSeekSDK()
          const apiKey = yield* getApiKey("deepseek")
          const baseUrl = yield* getBaseUrl("deepseek")
          
          const clientConfig: Record<string, unknown> = {
            apiKey,
            baseURL: baseUrl || "https://api.deepseek.com/v1"
          }
          const client = new sdk.OpenAI(clientConfig as unknown as OpenAIConfig)
          
          const requestParams: Record<string, unknown> = {
            model,
            messages: messages.map(m => {
              const msg: Record<string, unknown> = { role: m.role, content: m.content }
              if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
              if (m.tool_calls) msg.tool_calls = m.tool_calls
              return msg
            }),
            temperature,
            max_tokens: maxTokens,
            stream: true as const
          }
          if (tools) requestParams.tools = tools
          
          const streamResponse = yield* Effect.tryPromise({
            try: () => client.chat.completions.create(requestParams as unknown as OpenAIRequest),
            catch: (error: any) => new ProviderErrorClass({
              provider: "deepseek",
              statusCode: error.status,
              message: error.message,
              cause: error
            })
          })
          
          async function* generateChunks(): AsyncGenerator<StreamChunk> {
            const iterable = streamResponse as unknown as AsyncIterable<any>
            for await (const chunk of iterable) {
              const content = chunk.choices?.[0]?.delta?.content || ""
              const toolCalls = chunk.choices?.[0]?.delta?.tool_calls
              
              if (content) {
                yield { type: "content", content } as StreamChunk
              }
              
              if (toolCalls && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                  yield {
                    type: "tool_call",
                    tool_call: tc as ToolCall
                  } as StreamChunk
                }
              }
            }
            yield { type: "done" } as StreamChunk
          }
          
          return Stream.fromAsyncIterable(generateChunks(), (error: any) =>
            new ProviderErrorClass({
              provider: "deepseek",
              message: error.message ?? String(error),
              cause: error
            })
          )
        })
      )
    
    // 重试策略配置
    const retryPolicy = Schedule.intersect(
      Schedule.exponential(Duration.millis(500), 2.0),
      Schedule.recurs(3)
    )
    
    // 公开的 generate 方法
    const generate = (messages: Message[], options?: GenerateOptions) =>
      Effect.gen(function* () {
        const modelConfig = yield* getModelConfig()
        
        // 确定使用的模型和 provider
        const targetModel = options?.model ?? modelConfig.model
        const provider = yield* getProviderFromModel(targetModel)
        const temperature = options?.temperature ?? modelConfig.temperature ?? 0.7
        const maxTokens = options?.maxTokens ?? modelConfig.maxTokens ?? 4096
        const tools = options?.tools
        
        let result: GenerateResponse
        
        switch (provider) {
          case "openai":
            result = yield* callOpenAI(messages, targetModel, temperature, maxTokens, tools)
            break
          case "anthropic":
            result = yield* callAnthropic(messages, targetModel, temperature, maxTokens, tools)
            break
          case "deepseek":
            result = yield* callDeepSeek(messages, targetModel, temperature, maxTokens, tools)
            break
          default:
            return yield* Effect.fail(new ProviderErrorClass({
              provider: provider as ProviderType,
              message: `不支持的 Provider: ${provider}`
            }))
        }
        
        return result
      }).pipe(
        Effect.retry(retryPolicy)
      )
    
    // 公开的 stream 方法
    const stream = (messages: Message[], options?: GenerateOptions) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const modelConfig = yield* getModelConfig()
          
          const targetModel = options?.model ?? modelConfig.model
          const provider = yield* getProviderFromModel(targetModel)
          const temperature = options?.temperature ?? modelConfig.temperature ?? 0.7
          const maxTokens = options?.maxTokens ?? modelConfig.maxTokens ?? 4096
          const tools = options?.tools
          
          switch (provider) {
            case "openai":
              return streamOpenAI(messages, targetModel, temperature, maxTokens, tools)
            case "anthropic":
              return streamAnthropic(messages, targetModel, temperature, maxTokens, tools)
            case "deepseek":
              return streamDeepSeek(messages, targetModel, temperature, maxTokens, tools)
            default:
              return Stream.fail(new ProviderErrorClass({
                provider: provider as ProviderType,
                message: `Streaming not supported for provider: ${provider}`
              }))
          }
        })
      )
    
    const isAvailable = (provider?: string) =>
      Effect.gen(function* () {
        const targetProvider = provider ?? (yield* getModelConfig()).provider
        return yield* validateApiKey(targetProvider)
      }).pipe(
        Effect.catchAll(() => Effect.succeed(false))
      )
    
    return {
      generate,
      stream,
      isAvailable
    }
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