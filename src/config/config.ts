import { Context, Effect, Layer, Option } from "effect"
import { Fs } from "../infra/fs-util.js"
import { Env } from "../infra/env.js"
import { logger } from "../infra/logger.js"
import { mergeDeep } from "remeda"
import { existsSync } from "fs"

/** 模型配置 */
export interface ModelConfig {
  /** 模型提供商: openai | anthropic | deepseek | ollama | llama */
  provider: "openai" | "anthropic" | "deepseek" | "ollama" | "llama"
  /** 模型名称 */
  model: string
  /** 温度参数 (0-2) */
  temperature?: number
  /** 最大输出 token 数 */
  maxTokens?: number
}

/** 权限规则 */
export interface PermissionRule {
  /** 匹配路径的模式（支持 glob） */
  pattern: string
  /** 允许的操作: read | write | edit | bash | all */
  allow: string[]
  /** 是否需要确认 */
  requireConfirm?: boolean
  /** 备注说明 */
  description?: string
}

/** 完整配置结构 */
export interface AppConfig {
  /** 当前使用的模型 */
  model: ModelConfig
  /** 可用模型列表 */
  models?: ModelConfig[]
  /** 权限配置 */
  permissions?: {
    /** 默认允许的规则 */
    defaultAllow?: string[]
    /** 规则列表 */
    rules?: PermissionRule[]
  }
  /** 系统提示词 */
  systemPrompt?: string
  /** 最大对话轮数 */
  maxConversationTurns?: number
  /** 工作目录 */
  workspaceRoot?: string
}

const DEFAULT_CONFIG: AppConfig = {
  model: {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 4096
  },
  permissions: {
    defaultAllow: ["read"],
    rules: [
      { pattern: "**/*.md", allow: ["read", "write"], requireConfirm: false },
      { pattern: "**/*.json", allow: ["read"], requireConfirm: false },
      { pattern: "**/.env", allow: [], description: "禁止读取环境变量文件" }
    ]
  },
  maxConversationTurns: 50,
  workspaceRoot: process.cwd()
}

export interface ConfigService {
  readonly get: ()
    => Effect.Effect<AppConfig, Error>

  readonly getvalue: <K extends keyof AppConfig>(
    key: K
  )
    => Effect.Effect<AppConfig[K], Error>

  readonly getModel: ()
    => Effect.Effect<ModelConfig, Error>

  readonly setModel: (model: ModelConfig)
    => Effect.Effect<void, Error>

  readonly getPermissions: ()
    => Effect.Effect<PermissionRule[], Error>

  readonly isAllowed: (
    path: string,
    operation: string
  )
    => Effect.Effect<boolean, Error>

  readonly reload: ()
    => Effect.Effect<AppConfig, Error|boolean,Fs|Env>

  /** 持久化当前配置到 try.json */
  readonly save: ()
    => Effect.Effect<void, Error|boolean,Fs|Env>
}

export class Config extends Context.Tag("Config")<Config, ConfigService>() { }

const CONFIG_FILENAMES = [
  "try.json",
  ".try.json",
  "config/try.json"
]

const findConfigPath = () =>
  Effect.gen(function* () {
    for (const filename of CONFIG_FILENAMES) {
      const fs = yield* Fs
      const exists = yield* fs.exists(filename)
      if (exists) {
        return Option.some(filename)
      }
    }
    return Option.none()
  })

const parseJSON = <T>(content: string, filePath: string): Effect.Effect<T, Error> =>
  Effect.try({
    try: () => JSON.parse(content) as T,
    catch: () => new Error(`Failed to parse config file: ${filePath}`)
  })

function mergeConfig(target: AppConfig, source: Partial<AppConfig>): AppConfig {
  return mergeDeep(target, source) as AppConfig
}

const loadConfig = Effect.gen(function* () {
  const fs = yield* Fs
  const env = yield* Env

  // 0. 检测 .env 文件（Bun 运行时会自动加载，此处仅记录）
  if (existsSync(".env")) {
    logger.info("已检测到 .env 文件，Bun 将自动加载其中的环境变量")
  }

  // 1. 尝试读取配置文件
  const configPathOption = yield* findConfigPath()
  let fileConfig: Partial<AppConfig> = {}

  if (Option.isSome(configPathOption)) {
    const path = configPathOption.value
    const content = yield* fs.readFile(path)
    fileConfig = yield* parseJSON<Partial<AppConfig>>(content, path)
    logger.info(`加载配置文件: ${path}`)
  } else {
    logger.info("未找到配置文件，使用默认配置")
  }

  // 2. 环境变量覆盖（优先级高于配置文件）
  // 注：Provider / Model / Temperature 不通过环境变量覆盖，统一在 try.json 管理

  // Workspace 根目录覆盖
  const envWorkspace = yield* env.get("TRY_WORKSPACE")
  if (envWorkspace) {
    fileConfig.workspaceRoot = envWorkspace
  }

  // Max conversation turns 覆盖
  const envMaxTurns = yield* env.get("TRY_MAX_TURNS")
  if (envMaxTurns) {
    const turns = parseInt(envMaxTurns, 10)
    if (!isNaN(turns) && turns > 0) {
      fileConfig.maxConversationTurns = turns
    }
  }

  // 3. 合并配置
  const config = mergeConfig(DEFAULT_CONFIG, fileConfig)

  return config
})

export const ConfigLive = Layer.effect(
  Config,
  Effect.gen(function* () {
    let currentConfig = yield* loadConfig
    // 记录实际加载的配置文件路径（用于 save）
    let currentConfigPath: string | null = null
    // 初始化时确定路径
    const initPathOpt = yield* findConfigPath()
    if (Option.isSome(initPathOpt)) currentConfigPath = initPathOpt.value
    else currentConfigPath = CONFIG_FILENAMES[0]! // 默认写入 try.json

    const service: ConfigService = {
      get: () => Effect.succeed(currentConfig),

      getvalue: (
        key
      ) => Effect.succeed(currentConfig[key]),

      getModel: () => Effect.succeed(currentConfig.model),

      setModel: (model: ModelConfig) =>
        Effect.succeed(void (currentConfig = { ...currentConfig, model })),

      getPermissions: () => Effect.succeed(currentConfig.permissions?.rules ?? []),
      
      isAllowed: (path, operation) =>
        Effect.succeed(currentConfig.permissions?.rules?.some(rule => {
          const micromatch = require("micromatch")
          return micromatch.isMatch(path, rule.pattern) && (rule.allow.includes(operation) || rule.allow.includes("all"))
        }) ?? false),

      reload: () => 
        Effect.gen(function* () {
        currentConfig = yield* loadConfig
        logger.info("配置已重新加载")
        return currentConfig
      }),

      save: () =>
        Effect.gen(function* () {
          const fs = yield* Fs
          const path = currentConfigPath ?? CONFIG_FILENAMES[0]!
          // 只保存可序列化的用户配置（不含环境变量覆盖部分）
          const toSave: Record<string, unknown> = {}
          if (currentConfig.model) toSave.model = currentConfig.model
          if (currentConfig.models) toSave.models = currentConfig.models
          if (currentConfig.permissions) toSave.permissions = currentConfig.permissions
          if (currentConfig.systemPrompt) toSave.systemPrompt = currentConfig.systemPrompt
          if (currentConfig.maxConversationTurns) toSave.maxConversationTurns = currentConfig.maxConversationTurns
          if (currentConfig.workspaceRoot) toSave.workspaceRoot = currentConfig.workspaceRoot
          yield* fs.writeFile(path, JSON.stringify(toSave, null, 2))
          logger.info(`配置已保存到: ${path}`)
        })
    }
    
    return service
  })
)

export { DEFAULT_CONFIG }

// ====================================================
// 10. 测试用 Mock 配置
// ====================================================

export const ConfigMockLive = Layer.succeed(Config, {
  get: () => Effect.succeed(DEFAULT_CONFIG),
  getvalue: (key) => Effect.succeed(DEFAULT_CONFIG[key]),
  getModel: () => Effect.succeed(DEFAULT_CONFIG.model),
  setModel: (_model: ModelConfig) => Effect.succeed(undefined),
  getPermissions: () => Effect.succeed(DEFAULT_CONFIG.permissions?.rules ?? []),
  isAllowed: (_path: string, _operation: string) => Effect.succeed(true),
  reload: () => Effect.succeed(DEFAULT_CONFIG),
  save: () => Effect.succeed(undefined),
})