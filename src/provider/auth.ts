// src/provider/auth.ts
import { Context, Effect, Layer, Option } from "effect"
import { Config } from "../config/config.js"
import { Fs } from "../infra/fs-util.js"
import { logger } from "../infra/logger.js"

// ====================================================
// 类型定义
// ====================================================

export interface AuthConfig {
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
    ollama?: {
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
  
  let authConfig: AuthConfig = { ...DEFAULT_AUTH_CONFIG }
  
  // 从 auth.json 加载
  const configPathOption = yield* findAuthConfigPath()
  
  if (Option.isSome(configPathOption)) {
    const path = configPathOption.value
    const content = yield* fs.readFile(path)
    const fileConfig = yield* parseJSON<Partial<AuthConfig>>(content, path)
    authConfig = { ...authConfig, ...fileConfig }
    logger.info(`加载认证配置: ${path}`)
  } else {
    logger.info("未找到 auth.json，使用默认配置")
  }

  // Ollama 默认值（无需 auth.json 也能用本地模型）
  if (!authConfig.providers.ollama) {
    authConfig.providers.ollama = {
      apiKey: "ollama",
      baseUrl: "http://localhost:11434/v1",
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
        // provider 选择优先级：显式传入 > try.json.model.provider
        const targetProvider = (provider ??
          (yield* config.getvalue("model")).provider) as string
        
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
            new Error(`Missing API key for ${targetProvider}. Set in auth.json`)
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