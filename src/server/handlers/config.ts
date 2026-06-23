// src/server/handlers/config.ts
// ====================================================
// 配置 API 处理器 — 模型 / Provider / API Key 管理
// API Key 敏感信息：返回时脱敏，更新时检测掩码
// ====================================================

import { Effect, Option } from "effect"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { Config } from "../../config/config.js"
import type { ModelConfig } from "../../config/config.js"
import { Fs } from "../../infra/fs-util.js"
import {
  successResponse,
  errorResponse,
  parseJsonBody,
} from "../middleware.js"

// -------------------------------------------------
// 脱敏：sk-xxxxxxxx...xxxx
// -------------------------------------------------
function maskApiKey(key: string | undefined): string {
  if (!key) return ""
  if (key.length <= 8) return "****" // 极短 key 全掩
  const prefix = key.slice(0, 4)
  const suffix = key.slice(-4)
  return `${prefix}...${suffix}`
}

function isMaskedApiKey(value: string): boolean {
  // 如果包含省略号或等于已掩码格式，认为用户没有修改
  return value.includes("...") || value === "****"
}

// -------------------------------------------------
// Auth 文件路径
// -------------------------------------------------
const AUTH_PATHS = ["auth.json", ".auth.json", "config/auth.json", "secrets/auth.json"]

// -------------------------------------------------
// 辅助：catchAll
// -------------------------------------------------
function catchToErrorResponse(status = 500): (err: unknown) => Effect.Effect<Response> {
  return (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    return Effect.succeed(errorResponse(msg, status))
  }
}

// -------------------------------------------------
// 注册配置路由
// -------------------------------------------------
export function registerConfigRoutes(router: Router): void {

  // GET /api/config — 获取当前模型 / Provider / API Key 配置（Key 脱敏）
  router.get("/api/config", async (_ctx) => {
    const result: Response = await AppRuntime.runPromise(
      (Effect.gen(function* () {
        const configSvc = yield* Config
        const fs = yield* Fs

        // 1. 模型配置
        const modelConfig: ModelConfig = yield* configSvc.getModel()
        const fullConfig = yield* configSvc.get()

        // 2. Auth 配置（读取 auth.json）
        let authData: Record<string, unknown> = { providers: {} }
        for (const authPath of AUTH_PATHS) {
          const exists = yield* fs.exists(authPath)
          if (exists) {
            const content = yield* fs.readFile(authPath)
            try {
              authData = JSON.parse(content)
            } catch { /* skip */ }
            break
          }
        }

        // 3. 构建脱敏后的 Provider API 配置
        type ProviderAuthEntry = { apiKey?: string; baseUrl?: string; organization?: string }
        const providers = (authData.providers as Record<string, ProviderAuthEntry>) ?? {}

        const maskedProviders: Record<string, {
          apiKey: string
          baseUrl: string
          hasKey: boolean
        }> = {}

        const knownProviders = ["openai", "anthropic", "deepseek", "ollama"]
        for (const p of knownProviders) {
          const entry = providers[p]
          maskedProviders[p] = {
            apiKey: maskApiKey(entry?.apiKey),
            baseUrl: entry?.baseUrl ?? "",
            hasKey: !!entry?.apiKey,
          }
        }

        return successResponse({
          model: {
            provider: modelConfig.provider,
            model: modelConfig.model,
            temperature: modelConfig.temperature ?? 0.7,
            maxTokens: modelConfig.maxTokens ?? 4096,
          },
          models: fullConfig.models ?? [],
          providers: maskedProviders,
        })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // PUT /api/config — 更新模型 / Provider / API Key 配置
  router.put("/api/config", async (ctx) => {
    const body = await parseJsonBody<{
      model?: {
        provider?: string
        model?: string
        temperature?: number
        maxTokens?: number
      }
      providers?: Record<string, {
        apiKey?: string
        baseUrl?: string
      }>
    }>(ctx.request).catch(() => ({} as any))

    const result: Response = await AppRuntime.runPromise(
      (Effect.gen(function* () {
        const configSvc = yield* Config
        const fs = yield* Fs

        // ---- 1. 更新模型配置 ----
        const currentModel = yield* configSvc.getModel()
        if (body.model) {
          const newModel: ModelConfig = {
            provider: (body.model.provider as ModelConfig["provider"]) ?? currentModel.provider,
            model: body.model.model ?? currentModel.model,
            temperature: body.model.temperature ?? currentModel.temperature,
            maxTokens: body.model.maxTokens ?? currentModel.maxTokens,
          }
          yield* configSvc.setModel(newModel)
          yield* configSvc.save()
        }

        // ---- 2. 更新 Provider API Key / Base URL ----
        if (body.providers) {
          // 读取现有 auth.json
          let authData: Record<string, unknown> = { defaultProvider: (yield* configSvc.get()).model.provider, providers: {} }
          let foundAuthPath: string | null = null

          for (const authPath of AUTH_PATHS) {
            const exists = yield* fs.exists(authPath)
            if (exists) {
              foundAuthPath = authPath
              const content = yield* fs.readFile(authPath)
              try { authData = JSON.parse(content) } catch { /* keep default */ }
              break
            }
          }

          if (!foundAuthPath) foundAuthPath = "auth.json"

          // 确保 providers 存在
          if (!authData.providers || typeof authData.providers !== "object") {
            authData.providers = {}
          }
          const existingProviders = authData.providers as Record<string, Record<string, unknown>>

          // 更新每个 provider
          for (const [pName, pConfigUntyped] of Object.entries(body.providers)) {
            const pConfig = pConfigUntyped as { apiKey?: string; baseUrl?: string }
            if (!existingProviders[pName]) existingProviders[pName] = {}
            const existing = existingProviders[pName]!

            // API Key：只在新值不是掩码时更新
            if (pConfig.apiKey !== undefined && !isMaskedApiKey(pConfig.apiKey)) {
              existing["apiKey"] = pConfig.apiKey
            }
            // Base URL：始终更新
            if (pConfig.baseUrl !== undefined) {
              existing["baseUrl"] = pConfig.baseUrl
            }
          }

          // 写入 auth.json
          yield* fs.writeFile(foundAuthPath, JSON.stringify(authData, null, 2))
          console.log(`💾 Auth 配置已保存到: ${foundAuthPath}`)
        }

        return successResponse({ updated: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })
}
