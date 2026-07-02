// src/server/index.ts
// ====================================================
// Web 服务器入口 — 基于 Bun.serve 的 HTTP 服务
// ====================================================

import { Router, type CompiledRoute } from "./router.js"
import { withCorsWrapper, handleCORS, serveStatic, errorResponse, jsonResponse, applySecurityHeaders, requireAuth, errorToStructuredResponse, getRateLimiter, RateLimiter } from "./middleware/index.js"
import { registerChatRoutes } from "./handlers/chat.js"
import { registerSessionRoutes } from "./handlers/session.js"
import { registerAgentRoutes } from "./handlers/agent.js"
import { registerConfigRoutes } from "./handlers/config.js"
import { registerMetricsRoutes } from "./handlers/metrics.js"
import { registerRbacRoutes } from "./handlers/rbac.js"
import { registerAuthRoutes } from "./handlers/auth.js"
import { registerSubscriptionRoutes } from "./handlers/subscription.js"
import { registerToolsManagementRoutes } from "./handlers/tools-management.js"
import { registerSkillsManagementRoutes } from "./handlers/skills-management.js"
import { registerWorkspaceRoutes } from "./handlers/workspace.js"
import { registerProjectRoutes } from "./handlers/project.js"
import { registerFileRoutes } from "./handlers/files.js"
import { generateOpenAPIDoc } from "./openapi.js"
import { WebSocketManager } from "./websocket.js"
import { TerminalManager } from "./terminal-mgr.js"
import { logger, newTraceId, setTraceId } from "../infra/logger.js"
import { runMigrations, type MigrationResult } from "../infra/migration.js"
import { allMigrations } from "../infra/migrations/index.js"
import { auditLog, type AuditAction } from "../infra/audit-log.js"
import { metrics, Metrics } from "../infra/metrics.js"
import { rbac } from "../infra/rbac.js"
import { licenseService } from "../infra/license.js"
import { subscription } from "../infra/subscription.js"
import { existsSync } from "fs"
import { Database as BunDatabase } from "bun:sqlite"

// -------------------------------------------------
// 迁移初始化
// -------------------------------------------------

function runStartupMigrations(): MigrationResult {
  const dbPath = process.env.TRY_DB_PATH ?? "./try.db"
  const db = new BunDatabase(dbPath)
  try {
    logger.info("运行数据库迁移...")
    const result = runMigrations(db, allMigrations)
    if (result.errors.length > 0) {
      logger.error("数据库迁移失败", { errors: result.errors.map(e => e.error) })
    }
    return result
  } finally {
    db.close()
  }
}

/**
 * 服务启动初始化：迁移 → RBAC → License
 */
function runStartupInit(): void {
  // 1. 数据库迁移
  runStartupMigrations()

  // 2. RBAC 初始化（预置角色 + 默认管理员）
  try {
    rbac.initialize()
  } catch (err) {
    logger.error("RBAC 初始化失败", { error: String(err) })
  }

  // 3. License 验证
  const licenseResult = licenseService.validate()
  if (licenseResult.valid && licenseResult.info) {
    logger.info(`License 状态: ${licenseResult.info.status}`, {
      licensee: licenseResult.info.licensee ?? "社区版",
      maxUsers: licenseResult.info.maxUsers,
    })
  } else if (!licenseResult.valid) {
    logger.warn(`License 无效: ${licenseResult.reason}`)
  }

  // 4. Subscription 初始化
  try {
    subscription.initialize()
  } catch (err) {
    logger.error("Subscription 初始化失败", { error: String(err) })
  }
}

// -------------------------------------------------
// API 版本控制：克隆 /api/ 路由到 /api/v1/
// -------------------------------------------------

function cloneApiRoutes(router: Router): void {
  const routes = router.getAll()
  for (const route of routes) {
    if (route.pattern.startsWith("/api/") && !route.pattern.startsWith("/api/v1/")) {
      const v1Path = route.pattern.replace("/api/", "/api/v1/")
      // 包装 handler，注入 X-API-Version 响应头
      const v1Handler = async (ctx: Parameters<typeof route.handler>[0]) => {
        const response = await route.handler(ctx)
        const headers = new Headers(response.headers)
        headers.set("X-API-Version", "1")
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }
      router.add(route.method, v1Path, v1Handler)
    }
  }
  logger.info(`API v1 路由已就绪`)
}

// -------------------------------------------------
// 构建路由表
// -------------------------------------------------

function buildRouter(): Router {
  const router = new Router()

  // 注册 API 路由（这些路由会优先于静态文件匹配）
  registerChatRoutes(router)
  registerSessionRoutes(router)
  registerAgentRoutes(router)
  registerConfigRoutes(router)
  registerMetricsRoutes(router)
  registerRbacRoutes(router)
  registerAuthRoutes(router)
  registerSubscriptionRoutes(router)
  registerToolsManagementRoutes(router)
  registerSkillsManagementRoutes(router)
  registerWorkspaceRoutes(router)
  registerProjectRoutes(router)
  registerFileRoutes(router)

  // 存活探针 — 仅确认进程在运行
  router.get("/api/health", (_ctx) => {
    return new Response(JSON.stringify({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }), {
      headers: { "Content-Type": "application/json" },
    })
  })

  // 就绪探针 — 确认所有依赖可用
  router.get("/api/ready", (_ctx) => {
    const dbPath = process.env.TRY_DB_PATH ?? "./try.db"
    const checks: Record<string, string> = {}
    let healthy = true

    // 检查数据库文件存在且可访问
    try {
      if (!existsSync(dbPath)) {
        checks.db_file = `missing: ${dbPath}`
        healthy = false
      } else {
        checks.db_file = "ok"
      }

      // 尝试打开数据库并执行简单查询
      const db = new BunDatabase(dbPath, { readonly: true })
      try {
        db.query("SELECT 1").get()
        checks.db_query = "ok"

        // 检查核心表是否存在
        const tables = db.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).all() as { name: string }[]
        checks.db_tables = `${tables.length} tables`
      } catch (dbErr) {
        checks.db_query = `failed: ${String(dbErr)}`
        healthy = false
      } finally {
        db.close()
      }
    } catch (err) {
      checks.db = `failed: ${String(err)}`
      healthy = false
    }

    // 检查 RBAC 初始化状态
    try {
      const userCount = rbac.getUserCount()
      checks.rbac = userCount >= 1 ? "ok" : "warning: no users"
    } catch (err) {
      checks.rbac = `failed: ${String(err)}`
      healthy = false
    }

    // 检查 License 状态
    try {
      const licenseResult = licenseService.validate()
      checks.license = licenseResult.valid ? "ok" : `invalid: ${licenseResult.reason ?? "unknown"}`
    } catch (err) {
      checks.license = `error: ${String(err)}`
    }

    const statusCode = healthy ? 200 : 503
    return new Response(JSON.stringify({
      status: healthy ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    }), {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    })
  })

  // ═══ OpenAPI 文档 ═══
  // JSON spec — 公开访问
  router.get("/api/openapi.json", (_ctx) => {
    const doc = generateOpenAPIDoc(router)
    return new Response(JSON.stringify(doc, null, 2), {
      headers: { "Content-Type": "application/json" },
    })
  })

  // Swagger UI — 公开访问
  router.get("/api/docs", async (_ctx) => {
    const file = Bun.file(import.meta.dir + "/../server/static/swagger.html")
    if (await file.exists()) {
      return new Response(file, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }
    return errorResponse("Swagger UI 未找到", 404)
  })

  // WebSocket 统计
  router.get("/api/ws/stats", (_ctx) => {
    return jsonResponse({ success: true, data: ((globalThis as any).__wsManager).stats() })
  })

  // 克隆 /api/ 路由到 /api/v1/
  cloneApiRoutes(router)

  return router
}

// -------------------------------------------------
// 请求审计中间件
// -------------------------------------------------

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/")
}

/** 从路径推断审计 action 类型 */
function inferAuditAction(method: string, pathname: string): AuditAction {
  if (pathname.includes("/chat")) return "chat_message"
  if (pathname.includes("/sessions")) {
    if (method === "POST") return "session_create"
    if (method === "DELETE") return "session_delete"
    if (method === "PUT") return "session_update"
    return "session_access"
  }
  if (pathname.includes("/config")) return method === "PUT" ? "config_update" : "config_access"
  if (pathname.includes("/agents")) return "agent_access"
  if (pathname === "/api/health" || pathname === "/api/v1/health") return "health_check"
  if (pathname === "/api/ready" || pathname === "/api/v1/ready") return "ready_check"
  return "api_request"
}

// -------------------------------------------------
// 启动服务器
// -------------------------------------------------

export interface ServerOptions {
  /** 监听端口，默认 3456 */
  port?: number
  /** 监听地址，默认 127.0.0.1（仅本地可访问） */
  host?: string
  /** 是否自动打开浏览器 */
  open?: boolean
}

/** 打印端口占用时的帮助信息 */
function printPortInUseHelp(port: number, host: string) {
  console.error("")
  console.error(`  ╔══════════════════════════════════════════════╗`)
  console.error(`  ║        ❌ 端口 ${port} 已被占用                ║`)
  console.error(`  ╠══════════════════════════════════════════════╣`)
  console.error(`  ║  💡 提示：Web 服务可能已经在运行中！         ║`)
  console.error(`  ║     请检查浏览器 http://${host}:${port} 是否可访问  ║`)
  console.error(`  ║                                              ║`)
  console.error(`  ║  如果无法访问，可尝试以下方法：              ║`)
  console.error(`  ║                                              ║`)
  console.error(`  ║  1. 关闭占用端口的进程：                      ║`)
  console.error(`  ║     Windows:                                 ║`)
  console.error(`  ║       netstat -ano | findstr :${port}           ║`)
  console.error(`  ║       taskkill /PID <PID> /F                 ║`)
  console.error(`  ║     Linux / Mac:                            ║`)
  console.error(`  ║       lsof -i :${port}                          ║`)
  console.error(`  ║       kill -9 <PID>                         ║`)
  console.error(`  ║                                              ║`)
  console.error(`  ║  2. 使用其他端口重启：                        ║`)
  console.error(`  ║     bun run web -- -p <新端口>               ║`)
  console.error(`  ║     例如: bun run web -- -p 3000             ║`)
  console.error(`  ║                                              ║`)
  console.error(`  ║  3. 重新启动（将尝试其他端口）：              ║`)
  console.error(`  ║     请关闭占用进程后重试                      ║`)
  console.error(`  ╚══════════════════════════════════════════════╝`)
  console.error("")
}

export function startServer(options: ServerOptions = {}) {
  const port = options.port ?? 3456
  const host = options.host ?? "127.0.0.1"
  const shouldOpen = options.open ?? true

  // 启动时运行数据库迁移、RBAC 初始化、License 验证
  logger.info("服务器启动中...")
  runStartupInit()

  // WebSocket 管理器 (单例)
  const wsManager = new WebSocketManager()
  const terminalMgr = new TerminalManager()
  ;(globalThis as any).__wsManager = wsManager // 暴露给 handler 使用

  const router = buildRouter()

  // 初始化限流器
  const dbPath = process.env.TRY_DB_PATH ?? "./try.db"
  const rateLimitDb = new BunDatabase(dbPath)
  const rateLimiter = getRateLimiter(rateLimitDb)

  // 全局请求超时（毫秒）
  const GLOBAL_TIMEOUT_MS = parseInt(process.env.TRY_REQUEST_TIMEOUT_MS ?? "30000")
  // 请求体最大大小（字节）
  const MAX_BODY_SIZE = parseInt(process.env.TRY_MAX_BODY_SIZE ?? String(10 * 1024 * 1024)) // 10 MB

  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({
    port,
    hostname: host,
    idleTimeout: 120, // SSE 流可能需要较长时间，默认 10s 不够
    maxRequestBodySize: MAX_BODY_SIZE,
    websocket: WebSocketManager.createConfig(wsManager, terminalMgr),
    async fetch(request) {
      const traceId = newTraceId()
      setTraceId(traceId)
      const url = new URL(request.url)
      const pathname = url.pathname
      const startTime = Date.now()

      // WebSocket 升级请求 — 显式升级，不走 HTTP 路由
      if (pathname === "/api/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        if (server!.upgrade(request, { data: undefined })) return // upgraded successfully
        return new Response("WebSocket upgrade failed", { status: 426 })
      }

      // 终端 WebSocket 升级
      if (pathname === "/api/terminal" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const sessionId = url.searchParams.get("sessionId")
        if (!sessionId) return new Response("Missing sessionId", { status: 400 })
        if (server!.upgrade(request, {
          data: { clientId: "", type: "terminal" as const, terminalSessionId: sessionId },
        })) return
        return new Response("WebSocket upgrade failed", { status: 426 })
      }

      // 指标: 请求计数
      if (isApiPath(pathname)) {
        metrics.incrementCounter(Metrics.HTTP_REQUESTS_TOTAL, {
          method: request.method,
          path: pathname,
        })
      }

      logger.info(`请求 ${request.method} ${pathname}`, {
        method: request.method,
        path: pathname,
      })

      let response: Response

      // ═══════════════════════════════════════════
      // 安全层 1: 限流检查
      // ═══════════════════════════════════════════
      if (isApiPath(pathname)) {
        const ip = RateLimiter.extractIP(request)
        const { allowed, remaining, reset } = rateLimiter.check(ip, pathname)

        if (!allowed) {
          logger.warn("限流触发", { ip, path: pathname, remaining })
          return new Response(
            JSON.stringify({
              success: false,
              error: "请求过于频繁，请稍后再试",
              retryAfter: reset - Math.floor(Date.now() / 1000),
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": String(reset - Math.floor(Date.now() / 1000)),
                "X-RateLimit-Limit": String(
                  rateLimiter.status(ip, pathname).limit
                ),
                "X-RateLimit-Remaining": String(remaining),
                "X-RateLimit-Reset": String(reset),
              },
            }
          )
        }
      }

      // ═══════════════════════════════════════════
      // 安全层 2: 全局超时控制
      // ═══════════════════════════════════════════
      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(
          () => reject(new Error("请求超时")),
          GLOBAL_TIMEOUT_MS
        )
      })

      try {
        response = await Promise.race([
          (async (): Promise<Response> => {
            // 1. 尝试匹配 API 路由
            const match = router.match(request.method, pathname)
            if (match) {
              match.ctx.request = request
              match.ctx.query = url.searchParams

              if (isApiPath(pathname)) {
                auditLog.record({
                  traceId,
                  action: inferAuditAction(request.method, pathname),
                  resource: pathname,
                  detail: JSON.stringify({ method: request.method, query: url.search }),
                })
              }

              try {
                const wrapped = withCorsWrapper(match.handler)
                return await wrapped(match.ctx)
              } catch (handlerErr) {
                logger.error("路由处理异常", {
                  path: pathname,
                  method: request.method,
                  error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
                  stack: handlerErr instanceof Error ? handlerErr.stack : undefined,
                })
                return errorToStructuredResponse(handlerErr)
              }
            } else if (request.method === "OPTIONS") {
              return handleCORS()
            } else {
              const staticResponse = await serveStatic(pathname)
              if (staticResponse) {
                return staticResponse
              }
              const indexResponse = await serveStatic("index.html")
              if (indexResponse) {
                return indexResponse
              }
              return errorResponse("Not Found", 404)
            }
          })(),
          timeoutPromise,
        ]) as Response
      } catch (err) {
        if ((err as Error).message === "请求超时") {
          logger.warn("请求超时", { path: pathname, timeout: GLOBAL_TIMEOUT_MS })
          response = jsonResponse(
            { success: false, error: { code: "TIMEOUT", message: "请求超时", details: { timeoutMs: String(GLOBAL_TIMEOUT_MS) } } },
            504,
          )
        } else {
          logger.error("服务器未捕获异常", {
            path: pathname,
            method: request.method,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          })
          response = errorToStructuredResponse(err)
        }
      }

      // ═══════════════════════════════════════════
      // 安全层 3: 添加安全响应头
      // ═══════════════════════════════════════════
      const securityHeaders = applySecurityHeaders(new Headers(response.headers))
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: securityHeaders,
      })

      // 指标: 响应延迟
      const durationMs = Date.now() - startTime
      if (isApiPath(pathname)) {
        metrics.observeHistogram(Metrics.HTTP_REQUEST_DURATION_MS, durationMs, {
          method: request.method,
          path: pathname,
        })
        if (response.status >= 400) {
          metrics.incrementCounter(Metrics.HTTP_ERRORS_TOTAL, {
            method: request.method,
            path: pathname,
            status: String(response.status),
          })
        }
      }

      return response
    },
    error(error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error("服务器错误", { error: msg, stack: error instanceof Error ? error.stack : undefined })
      metrics.incrementCounter(Metrics.HTTP_ERRORS_TOTAL, {
        method: "UNKNOWN",
        path: "UNKNOWN",
        status: "500",
      })
      return errorToStructuredResponse(error)
    },
  })
  } catch (error: unknown) {
    if ((error as any)?.code === "EADDRINUSE") {
      printPortInUseHelp(port, host)
      process.exit(1)
    }
    throw error
  }

  const url = `http://${host}:${port}`

  console.log("")
  console.log("  ╔══════════════════════════════════════╗")
  console.log("  ║        🤖 Try Web UI 已启动         ║")
  console.log("  ╠══════════════════════════════════════╣")
  console.log(`  ║  地址: ${url.padEnd(26)}║`)
  console.log(`  ║  端口: ${String(port).padEnd(26)}║`)
  console.log(`  ║  文档: ${`${url}/api/docs`.padEnd(26)}║`)
  console.log(`  ║  指标: ${`${url}/api/v1/metrics`.padEnd(26)}║`)
  console.log(`  ║  WS:   ${`${url}/api/ws`.padEnd(26)}║`)
  console.log("  ║  按 Ctrl+C 停止服务器               ║")
  console.log("  ╚══════════════════════════════════════╝")
  console.log("")

  if (shouldOpen) {
    // 自动打开浏览器（非阻塞），各平台分别传参避免引号嵌套
    if (process.platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", url], { windowsHide: true, stdout: "ignore", stderr: "ignore" })
    } else if (process.platform === "darwin") {
      Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" })
    } else {
      Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" })
    }
  }

  return server
}
