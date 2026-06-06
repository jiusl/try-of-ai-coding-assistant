// src/provider/auth.ts
import { Context, Effect, Layer, Option } from "effect"
import { Config } from "../config/config.js"
import { Env } from "../infra/env.js"
import { Fs } from "../infra/fs-util.js"

// ====================================================
// 类型定义
// ====================================================

export interface AuthConfig {
  /** 当前默认使用的 provider */
  defaultProvider?: "openai" | "anthropic" | "deepseek"
  /** 各 provider 的认证配置 */
  providers: {
    openai?: {
      apiKey: string
      baseUrl?: string
      organization?: string
    }
    anthropic?: {
      apiKey: string
      baseUrl?: string
    }
    deepseek?: {
      apiKey: string
      baseUrl?: string
    }
    [key: string]: unknown  // 支持扩展其他 provider
  }
}

export interface AuthService {
  /** 获取 API Key */
  readonly getApiKey: (provider?: string) => Effect.Effect<string, Error>
  
  /** 获取 Base URL */
  readonly getBaseUrl: (provider?: string) => Effect.Effect<string | undefined, Error>
  
  /** 获取 Organization (OpenAI 专用) */
  readonly getOrganization: (provider?: string) => Effect.Effect<string | undefined, Error>
  
  /** 验证 API Key 是否有效 */
  readonly validateApiKey: (provider?: string) => Effect.Effect<boolean, Error>
}

export class Auth extends Context.Tag("Auth")<Auth, AuthService>() {}

// ====================================================
// 默认配置
// ====================================================

const DEFAULT_AUTH_CONFIG: AuthConfig = {
  defaultProvider: "openai",
  providers: {}
}

// ====================================================
// 配置文件路径
// ====================================================

const AUTH_CONFIG_PATHS = [
  "auth.json",
  ".auth.json",
  "config/auth.json",
  "secrets/auth.json"
]

// ====================================================
// 认证配置加载
// ====================================================

const findAuthConfigPath = () =>
  Effect.gen(function* () {
    for (const path of AUTH_CONFIG_PATHS) {
      const fs = yield* Fs  
      const exists = yield* fs.exists(path)
      if (exists) {
        return Option.some(path)
      }
    }
    return Option.none()
  })

const parseJSON = <T>(content: string, filePath: string): Effect.Effect<T, Error> =>
  Effect.try({
    try: () => JSON.parse(content) as T,
    catch: () => new Error(`Failed to parse auth file: ${filePath}`)
  })

const loadAuthConfig = Effect.gen(function* () {
  const fs = yield* Fs
  const env = yield* Env
  
  let authConfig: AuthConfig = { ...DEFAULT_AUTH_CONFIG }
  
  // 1. 尝试从 auth.json 加载
  const configPathOption = yield* findAuthConfigPath()
  
  if (Option.isSome(configPathOption)) {
    const path = configPathOption.value
    const content = yield* fs.readFile(path)
    const fileConfig = yield* parseJSON<Partial<AuthConfig>>(content, path)
    authConfig = { ...authConfig, ...fileConfig }
    console.log(`🔐 加载认证配置: ${path}`)
  } else {
    console.log("🔐 未找到 auth.json，将使用环境变量")
  }
  
  // 2. 环境变量覆盖（优先级更高）
  // 各 provider 的 API Key 环境变量会覆盖 auth.json 中的值
  const openaiKey = yield* env.get("OPENAI_API_KEY")
  if (openaiKey) {
    authConfig.providers.openai = {
      ...authConfig.providers.openai,
      apiKey: openaiKey
    }
  }
  
  const anthropicKey = yield* env.get("ANTHROPIC_API_KEY")
  if (anthropicKey) {
    authConfig.providers.anthropic = {
      ...authConfig.providers.anthropic,
      apiKey: anthropicKey
    }
  }
  
  const deepseekKey = yield* env.get("DEEPSEEK_API_KEY")
  if (deepseekKey) {
    authConfig.providers.deepseek = {
      ...authConfig.providers.deepseek,
      apiKey: deepseekKey
    }
  }
  
  // 各 provider 的 Base URL 环境变量覆盖
  const openaiBaseUrl = yield* env.get("OPENAI_BASE_URL")
  if (openaiBaseUrl) {
    authConfig.providers.openai = {
      ...authConfig.providers.openai,
      baseUrl: openaiBaseUrl,
      apiKey: authConfig.providers.openai?.apiKey ?? "",
    }
  }
  
  const anthropicBaseUrl = yield* env.get("ANTHROPIC_BASE_URL")
  if (anthropicBaseUrl) {
    authConfig.providers.anthropic = {
      ...authConfig.providers.anthropic,
      baseUrl: anthropicBaseUrl,
      apiKey: authConfig.providers.anthropic?.apiKey ?? "",
    }
  }
  
  const deepseekBaseUrl = yield* env.get("DEEPSEEK_BASE_URL")
  if (deepseekBaseUrl) {
    authConfig.providers.deepseek = {
      ...authConfig.providers.deepseek,
      baseUrl: deepseekBaseUrl,
      apiKey: authConfig.providers.deepseek?.apiKey ?? "",
    }
  }
  
  return authConfig
})

// ====================================================
// Live Layer
// ====================================================

export const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    let currentAuthConfig = yield* loadAuthConfig
    const config = yield* Config
    
    /** provider 的基础配置字段 */
    type ProviderEntry = {
      apiKey?: string
      baseUrl?: string
      organization?: string
    }

    const getProviderConfig = (provider?: string) =>
      Effect.gen(function* () {
        const targetProvider = provider ?? 
          currentAuthConfig.defaultProvider ?? 
          (yield* config.getvalue("model")).provider
        
        const providerConfig = currentAuthConfig.providers[targetProvider] as
          | ProviderEntry
          | undefined
        
        if (!providerConfig) {
          return yield* Effect.fail(
            new Error(`No auth config found for provider: ${targetProvider}`)
          )
        }
        
        return { targetProvider, providerConfig }
      })
    
    const getApiKey = (provider?: string) =>
      Effect.gen(function* () {
        const { targetProvider, providerConfig } = yield* getProviderConfig(provider)
        
        if (!providerConfig.apiKey) {
          return yield* Effect.fail(
            new Error(`Missing API key for ${targetProvider}. Set in auth.json or .env`)
          )
        }
        
        return providerConfig.apiKey
      })
    
    const getBaseUrl = (provider?: string) =>
      Effect.gen(function* () {
        const { providerConfig } = yield* getProviderConfig(provider)
        return providerConfig.baseUrl
      })
    
    const getOrganization = (provider?: string) =>
      Effect.gen(function* () {
        const { targetProvider, providerConfig } = yield* getProviderConfig(provider)
        if (targetProvider === "openai" && "organization" in providerConfig) {
          return (providerConfig as { organization?: string }).organization
        }
        return undefined
      })
    
    const validateApiKey = (provider?: string) =>
      Effect.gen(function* () {
        const key = yield* getApiKey(provider)
        // 简单验证：非空且以 sk- 开头（OpenAI 格式）或长度合理
        return key.length > 10
      })
    
    return {
      getApiKey,
      getBaseUrl,
      getOrganization,
      validateApiKey
    }
  })
)