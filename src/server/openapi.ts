// src/server/openapi.ts
// ====================================================
// OpenAPI 3.0 文档自动生成器 — 零依赖，基于路由定义反射
// ====================================================

import type { Router, CompiledRoute } from "./router.js"
import type { ApiErrorCode } from "./errors.js"

// ====================================================
// OpenAPI 类型
// ====================================================

interface OpenAPISchema {
  type?: string
  properties?: Record<string, OpenAPISchema>
  required?: string[]
  items?: OpenAPISchema
  enum?: string[]
  nullable?: boolean
  description?: string
  example?: unknown
  additionalProperties?: boolean | OpenAPISchema
  format?: string
  allOf?: OpenAPISchema[]
  $ref?: never
}

interface OpenAPIParameter {
  name: string
  in: "path" | "query" | "header"
  required?: boolean
  schema: OpenAPISchema
  description?: string
}

interface OpenAPIRequestBody {
  required?: boolean
  content: Record<string, { schema: OpenAPISchema }>
  description?: string
}

interface OpenAPIResponse {
  description: string
  content?: Record<string, { schema: OpenAPISchema }> | undefined
}

interface OpenAPIOperation {
  tags: string[]
  summary: string
  description?: string
  operationId: string
  parameters?: OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  responses: Record<string, OpenAPIResponse>
  deprecated?: boolean
}

interface OpenAPIPathItem {
  get?: OpenAPIOperation
  post?: OpenAPIOperation
  put?: OpenAPIOperation
  delete?: OpenAPIOperation
  patch?: OpenAPIOperation
}

interface OpenAPIDocument {
  openapi: "3.0.3"
  info: {
    title: string
    version: string
    description: string
  }
  servers: Array<{ url: string; description: string }>
  tags: Array<{ name: string; description: string }>
  paths: Record<string, OpenAPIPathItem>
  components?: {
    schemas: Record<string, OpenAPISchema>
  }
}

// ====================================================
// Schema 注册表
// ====================================================

const schemas = new Map<string, OpenAPISchema>()

function schema(name: string, def: OpenAPISchema): OpenAPISchema {
  schemas.set(name, def)
  return def
}

function ref(name: string): OpenAPISchema {
  return { $ref: `#/components/schemas/${name}` } as any
}

// ====================================================
// 请求/响应 Schema 定义
// ====================================================

// 通用
const ErrorResponse = schema("ErrorResponse", {
  type: "object",
  properties: {
    success:     { type: "boolean", example: false },
    error:       { type: "object",
      properties: {
        code:    { type: "string", description: "机器可读错误码" },
        message: { type: "string", description: "人类可读错误消息" },
        details: { type: "object", additionalProperties: { type: "string" }, description: "字段级错误详情" },
      },
      required: ["code", "message"],
    },
  },
  required: ["success", "error"],
})

const SuccessResponse = schema("SuccessResponse", {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    data:    { type: "object" },
    message: { type: "string" },
  },
  required: ["success"],
})

// Chat
schema("ChatRequest", {
  type: "object",
  properties: {
    sessionId: { type: "string", description: "会话 ID（不传则自动创建）" },
    message:   { type: "string", description: "用户消息" },
    agentId:   { type: "string", description: "Agent ID（如 builtin:chat）" },
  },
  required: ["message"],
})

schema("ChatResponse", {
  type: "object",
  properties: {
    sessionId:  { type: "string" },
    content:    { type: "string", description: "AI 回复内容" },
    iterations: { type: "integer" },
    durationMs: { type: "integer" },
    tokensUsed: { type: "integer" },
    warning:    { type: "string" },
    toolCalls:  { type: "array", items: { type: "object",
      properties: {
        tool:      { type: "string" },
        arguments: { type: "string" },
      },
    }},
  },
})

// Confirm
schema("ConfirmRequest", {
  type: "object",
  properties: {
    sessionId: { type: "string" },
    approved:  { type: "boolean" },
  },
  required: ["sessionId", "approved"],
})

// Session
schema("CreateSessionRequest", {
  type: "object",
  properties: {
    title: { type: "string", description: "会话标题" },
    model: { type: "string", description: "模型名称" },
  },
})

schema("SessionInfo", {
  type: "object",
  properties: {
    id:        { type: "string" },
    title:     { type: "string" },
    model:     { type: "string" },
    agentId:   { type: "string" },
    messageCount: { type: "integer" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
})

schema("SessionWithMessages", {
  type: "object",
  allOf: [
    ref("SessionInfo"),
    { type: "object", properties: {
      messages: { type: "array", items: { type: "object",
        properties: {
          id:       { type: "string" },
          role:     { type: "string", enum: ["user", "assistant", "system"] },
          content:  { type: "string" },
          toolName: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      }},
    }},
  ],
})

// Agent
schema("AgentConfig", {
  type: "object",
  properties: {
    id:          { type: "string" },
    name:        { type: "string" },
    description: { type: "string" },
    capabilities: { type: "array", items: { type: "string" } },
    enabled:     { type: "boolean" },
  },
})

// Config
schema("ModelConfig", {
  type: "object",
  properties: {
    provider:    { type: "string", enum: ["openai", "anthropic", "deepseek", "ollama"] },
    model:       { type: "string" },
    temperature: { type: "number" },
    maxTokens:   { type: "integer" },
  },
})

schema("ProviderConfig", {
  type: "object",
  properties: {
    apiKey: { type: "string", description: "脱敏后的 API Key" },
    baseUrl: { type: "string" },
    hasKey:  { type: "boolean" },
  },
})

// Auth
schema("RegisterRequest", {
  type: "object",
  properties: {
    name:     { type: "string" },
    email:    { type: "string", format: "email" },
    password: { type: "string", format: "password" },
  },
  required: ["name", "email", "password"],
})

schema("LoginRequest", {
  type: "object",
  properties: {
    email:    { type: "string", format: "email" },
    password: { type: "string", format: "password" },
  },
  required: ["email", "password"],
})

schema("LoginResponse", {
  type: "object",
  properties: {
    user:   { type: "object",
      properties: {
        id:    { type: "string" },
        name:  { type: "string" },
        email: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
      },
    },
    tokens: { type: "object",
      properties: {
        accessToken:  { type: "string" },
        refreshToken: { type: "string" },
        expiresAt:    { type: "string", format: "date-time" },
      },
    },
  },
})

schema("RefreshRequest", {
  type: "object",
  properties: {
    refreshToken: { type: "string" },
  },
  required: ["refreshToken"],
})

// Metrics
schema("MetricsData", {
  type: "object",
  properties: {
    counters:  { type: "object", additionalProperties: { type: "integer" } },
    histograms: { type: "object" },
  },
})

schema("AuditLogEntry", {
  type: "object",
  properties: {
    id:       { type: "string" },
    traceId:  { type: "string" },
    action:   { type: "string" },
    resource: { type: "string" },
    detail:   { type: "string" },
    userId:   { type: "string" },
    createdAt: { type: "string", format: "date-time" },
  },
})

// License
schema("LicenseInfo", {
  type: "object",
  properties: {
    status:     { type: "string", enum: ["community", "trial", "licensed"] },
    licensee:   { type: "string" },
    maxUsers:   { type: "integer" },
    features:   { type: "array", items: { type: "string" } },
    expiresAt:  { type: "string", format: "date-time" },
  },
})

// ====================================================
// 通用 Responses
// ====================================================

function commonResponses(hasBody = true): Record<string, OpenAPIResponse> {
  const body = hasBody ? { "application/json": { schema: ref("ErrorResponse") } } : undefined
  return {
    "400": { description: "请求参数错误", content: body },
    "401": { description: "未认证", content: body },
    "429": { description: "请求过于频繁", content: body },
    "500": { description: "服务器内部错误", content: body },
  }
}

function successResponse(schemaRef: string, description = "成功"): Record<string, OpenAPIResponse> {
  return {
    "200": { description, content: { "application/json": { schema: ref(schemaRef) } } },
    ...commonResponses(true),
  }
}

/** 返回 200 响应（不含 error schema，用于健康检查等简单接口） */
function okResponse(example: unknown): Record<string, OpenAPIResponse> {
  return {
    "200": {
      description: "成功",
      content: { "application/json": { schema: { type: "object", example } } },
    },
    ...commonResponses(true),
  }
}

// ====================================================
// 路由 → OpenAPI 文档生成
// ====================================================

/**
 * 从路由表自动生成 OpenAPI 3.0 文档
 *
 * 未覆盖的路由默认标记为 "未文档化" — 可逐步补充 schema
 */
export function generateOpenAPIDoc(router: Router): OpenAPIDocument {
  const paths: Record<string, OpenAPIPathItem> = {}
  const routes = router.getAll()

  for (const route of routes) {
    // 跳过非 API 路由和 v1 重复路由（只保留 /api/ 前缀版本）
    if (!route.pattern.startsWith("/api/") || route.pattern.startsWith("/api/v1/")) continue
    if (route.method === "OPTIONS") continue

    // 将 :param 转为 {param}
    const openApiPath = route.pattern.replace(/:([^/]+)/g, "{$1}")
    if (!paths[openApiPath]) paths[openApiPath] = {}

    const op = buildOperation(route)
    const method = route.method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch"
    paths[openApiPath]![method] = op
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Try API",
      version: "1.0.0",
      description: "AI 驱动的本地编程助手 — REST API 文档。\n\n所有 API 同时支持 `/api/v1/` 版本前缀。",
    },
    servers: [
      { url: "http://127.0.0.1:3456", description: "本地开发服务器" },
    ],
    tags: [
      { name: "Chat", description: "对话和流式消息" },
      { name: "Session", description: "会话管理" },
      { name: "Agent", description: "Agent 管理" },
      { name: "Config", description: "模型和 Provider 配置" },
      { name: "Auth", description: "认证与授权" },
      { name: "Metrics", description: "可观测性指标" },
      { name: "Audit", description: "审计日志" },
      { name: "License", description: "License 管理" },
      { name: "Users", description: "用户管理 (RBAC)" },
      { name: "Health", description: "健康检查" },
      { name: "WebSocket", description: "WebSocket 实时推送" },
    ],
    paths,
    components: {
      schemas: Object.fromEntries(schemas),
    },
  }
}

// ====================================================
// 路由 → Operation 映射
// ====================================================

function buildOperation(route: CompiledRoute): OpenAPIOperation {
  const tag = inferTag(route.pattern)
  const opId = operationId(route.method, route.pattern)

  const base: OpenAPIOperation = {
    tags: [tag],
    summary: "",
    operationId: opId,
    responses: commonResponses(true),
  }

  const matched = matchKnownRoute(route.method, route.pattern)
  return { ...base, ...matched }
}

function inferTag(pattern: string): string {
  if (pattern.includes("/chat")) return "Chat"
  if (pattern.includes("/sessions")) return "Session"
  if (pattern.includes("/agents")) return "Agent"
  if (pattern.includes("/config")) return "Config"
  if (pattern.includes("/auth")) return "Auth"
  if (pattern.includes("/metrics")) return "Metrics"
  if (pattern.includes("/audit")) return "Audit"
  if (pattern.includes("/license")) return "License"
  if (pattern.includes("/users")) return "Users"
  if (pattern.includes("/health") || pattern.includes("/ready")) return "Health"
  if (pattern.includes("/ws")) return "WebSocket"
  return "System"
}

function operationId(method: string, pattern: string): string {
  const parts = pattern
    .replace("/api/", "")
    .replace("/v1/", "")
    .split("/")
    .filter(Boolean)
  const words = parts.map((p, i) => {
    const cleaned = p.replace(/^:/, "By")
    return i === 0 ? cleaned : cleaned[0]!.toUpperCase() + cleaned.slice(1)
  })
  return method.toLowerCase() + words.join("")
}

// ====================================================
// 已知路由的详细文档（按需补充）
// ====================================================

interface RouteDoc {
  summary: string
  description?: string
  parameters?: OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  responses?: Record<string, OpenAPIResponse>
  tags?: string[]
}

function matchKnownRoute(method: string, pattern: string): Partial<OpenAPIOperation> {
  const key = `${method} ${pattern}`

  const docs: Record<string, RouteDoc> = {
    // Health
    "GET /api/health": {
      summary: "存活探针",
      description: "确认进程在运行，返回运行时间",
      responses: okResponse({ status: "ok", uptime: 123.4, timestamp: "2026-06-27T00:00:00Z" }),
    },
    "GET /api/ready": {
      summary: "就绪探针",
      description: "检查数据库、RBAC、License 等依赖是否就绪",
      responses: okResponse({ status: "ready", checks: {}, timestamp: "2026-06-27T00:00:00Z" }),
    },

    // Chat
    "POST /api/chat/stream": {
      summary: "发送消息 (SSE 流式)",
      description: "通过 Server-Sent Events 实时推送 AI 回复。事件类型: chunk / tool_call / tool_result / request_confirm / phase / done / error",
      requestBody: jsonBody(ref("ChatRequest")),
      tags: ["Chat"],
    },
    "POST /api/chat": {
      summary: "发送消息 (同步)",
      description: "同步等待 AI 完整回复",
      requestBody: jsonBody(ref("ChatRequest")),
      tags: ["Chat"],
    },
    "POST /api/chat/confirm": {
      summary: "确认/拒绝工具调用",
      description: "对高敏感度工具调用的确认或拒绝",
      requestBody: jsonBody(ref("ConfirmRequest")),
      tags: ["Chat"],
    },
    "POST /api/chat/cancel": {
      summary: "取消待确认请求",
      requestBody: jsonBody({ type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] }),
      tags: ["Chat"],
    },

    // Sessions
    "GET /api/sessions": {
      summary: "列出会话",
      parameters: [
        q("limit", "每页数量", "integer", 50),
        q("offset", "偏移量", "integer", 0),
      ],
      tags: ["Session"],
      responses: { "200": { description: "会话列表", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: ref("SessionInfo") } } } } } } },
    },
    "POST /api/sessions": {
      summary: "创建会话",
      requestBody: jsonBody(ref("CreateSessionRequest")),
      tags: ["Session"],
    },
    "GET /api/sessions/:id": {
      summary: "获取会话详情（含消息）",
      parameters: [p("id", "会话 ID")],
      tags: ["Session"],
    },
    "PUT /api/sessions/:id/title": {
      summary: "更新会话标题",
      parameters: [p("id", "会话 ID")],
      requestBody: jsonBody({ type: "object", properties: { title: { type: "string" } }, required: ["title"] }),
      tags: ["Session"],
    },
    "DELETE /api/sessions/:id": {
      summary: "删除会话",
      parameters: [p("id", "会话 ID")],
      tags: ["Session"],
    },
    "PUT /api/sessions/:id/rename": {
      summary: "重命名会话",
      parameters: [p("id", "会话 ID")],
      requestBody: jsonBody({ type: "object", properties: { title: { type: "string" } }, required: ["title"] }),
      tags: ["Session"],
    },
    "PUT /api/sessions/:id/agent": {
      summary: "设置会话绑定 Agent",
      parameters: [p("id", "会话 ID")],
      requestBody: jsonBody(ref("AgentConfig")),
      tags: ["Session"],
    },
    "POST /api/sessions/:id/generate-title": {
      summary: "AI 生成会话标题",
      parameters: [p("id", "会话 ID")],
      tags: ["Session"],
    },
    "POST /api/sessions/:id/clear": {
      summary: "清空会话消息",
      parameters: [p("id", "会话 ID")],
      tags: ["Session"],
    },

    // Agents
    "GET /api/agents": {
      summary: "列出可用 Agent",
      tags: ["Agent"],
      responses: { "200": { description: "Agent 列表", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "array", items: ref("AgentConfig") } } } } } } },
    },
    "GET /api/agents/:id": {
      summary: "获取 Agent 详情",
      parameters: [p("id", "Agent ID")],
      tags: ["Agent"],
    },

    // Config
    "GET /api/config": {
      summary: "获取配置",
      description: "返回模型配置和 Provider API Key（脱敏）",
      tags: ["Config"],
    },
    "PUT /api/config": {
      summary: "更新配置",
      description: "更新模型和 Provider 设置。API Key 传掩码值时保持不变。",
      requestBody: jsonBody({ type: "object", properties: {
        model: ref("ModelConfig"),
        providers: { type: "object", additionalProperties: { type: "object", properties: { apiKey: { type: "string" }, baseUrl: { type: "string" } } } },
      }}),
      tags: ["Config"],
    },

    // Auth
    "POST /api/auth/register": {
      summary: "用户注册",
      requestBody: jsonBody(ref("RegisterRequest")),
      tags: ["Auth"],
    },
    "POST /api/auth/login": {
      summary: "用户登录",
      requestBody: jsonBody(ref("LoginRequest")),
      tags: ["Auth"],
    },
    "POST /api/auth/logout": {
      summary: "用户登出",
      tags: ["Auth"],
    },
    "POST /api/auth/refresh": {
      summary: "刷新令牌",
      requestBody: jsonBody(ref("RefreshRequest")),
      tags: ["Auth"],
    },
    "GET /api/auth/me": {
      summary: "获取当前用户",
      tags: ["Auth"],
    },
    "PUT /api/auth/password": {
      summary: "修改密码",
      requestBody: jsonBody({ type: "object", properties: { oldPassword: { type: "string" }, newPassword: { type: "string" } }, required: ["oldPassword", "newPassword"] }),
      tags: ["Auth"],
    },

    // Metrics
    "GET /api/metrics": {
      summary: "Prometheus 指标 (文本格式)",
      tags: ["Metrics"],
      responses: { "200": { description: "Prometheus 文本格式指标", content: { "text/plain": { schema: { type: "string" } } } } },
    },
    "GET /api/metrics/json": {
      summary: "Prometheus 指标 (JSON)",
      tags: ["Metrics"],
      ...responses200({ success: true, data: {} }),
    },

    // Audit
    "GET /api/audit-log": {
      summary: "审计日志查询",
      parameters: [
        q("action", "审计动作类型"),
        q("traceId", "链路 ID"),
        q("limit", "每页数量", "integer", 100),
        q("offset", "偏移量", "integer", 0),
      ],
      tags: ["Audit"],
    },
    "GET /api/audit-log/stats": {
      summary: "审计日志统计",
      tags: ["Audit"],
    },

    // License
    "GET /api/license": {
      summary: "获取 License 信息",
      tags: ["License"],
    },
    "GET /api/license/features": {
      summary: "获取功能开关",
      tags: ["License"],
      ...responses200({ success: true, data: {} }),
    },
    "POST /api/license/activate": {
      summary: "激活 License",
      requestBody: jsonBody({ type: "object", properties: { licenseKey: { type: "string" }, licensee: { type: "string" } }, required: ["licenseKey"] }),
      tags: ["License"],
    },

    // Users (RBAC)
    "GET /api/users": {
      summary: "列出用户",
      tags: ["Users"],
    },
    "POST /api/users": {
      summary: "创建用户",
      requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, email: { type: "string" }, roles: { type: "array", items: { type: "string" } } }, required: ["name"] }),
      tags: ["Users"],
    },
    "DELETE /api/users/:id": {
      summary: "删除用户",
      parameters: [p("id", "用户 ID")],
      tags: ["Users"],
    },
    "PUT /api/users/:id/roles": {
      summary: "更新用户角色",
      parameters: [p("id", "用户 ID")],
      requestBody: jsonBody({ type: "object", properties: { roles: { type: "array", items: { type: "string" } } }, required: ["roles"] }),
      tags: ["Users"],
    },
    "PUT /api/users/:id/token": {
      summary: "重新生成 API Token",
      parameters: [p("id", "用户 ID")],
      tags: ["Users"],
    },

    // Seed
    "POST /api/seed": {
      summary: "生成种子数据",
      tags: ["System"],
    },
    "DELETE /api/seed": {
      summary: "清空种子数据",
      tags: ["System"],
    },

    // WebSocket
    "GET /api/ws": {
      summary: "WebSocket 连接",
      description: "升级为 WebSocket 连接，用于实时 Agent 状态推送和双向通信。\n\n消息协议: `{ type: string, payload: object }`",
      tags: ["WebSocket"],
      responses: {
        "101": { description: "协议升级为 WebSocket" },
      },
    },
  }

  const doc = docs[key]
  if (!doc) {
    return {
      summary: `${pattern} (未文档化)`,
    }
  }

  const merged = { ...doc }
  return merged
}

// ====================================================
// 辅助
// ====================================================

function p(name: string, description: string): OpenAPIParameter {
  return { name, in: "path", required: true, schema: { type: "string" }, description }
}

function q(name: string, description: string, type = "string", defaultVal?: unknown): OpenAPIParameter {
  return { name, in: "query", required: false, schema: { type, ...(defaultVal !== undefined ? { default: defaultVal } : {}) }, description }
}

function jsonBody(schemaRef: OpenAPISchema, description?: string): OpenAPIRequestBody {
  const result: OpenAPIRequestBody = { required: true, content: { "application/json": { schema: schemaRef } } }
  if (description !== undefined) result.description = description
  return result
}

function responses200(example: unknown): Pick<RouteDoc, "responses"> {
  return {
    responses: {
      "200": {
        description: "成功",
        content: { "application/json": { schema: { type: "object", example } } },
      },
      ...commonResponses(true),
    },
  }
}
