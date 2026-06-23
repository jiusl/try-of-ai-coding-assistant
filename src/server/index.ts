// src/server/index.ts
// ====================================================
// Web 服务器入口 — 基于 Bun.serve 的 HTTP 服务
// ====================================================

import { Router } from "./router.js"
import { withCorsWrapper, handleCORS, serveStatic, errorResponse } from "./middleware.js"
import { registerChatRoutes } from "./handlers/chat.js"
import { registerSessionRoutes } from "./handlers/session.js"
import { registerAgentRoutes } from "./handlers/agent.js"
import { registerConfigRoutes } from "./handlers/config.js"

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

  // 健康检查
  router.get("/api/health", (_ctx) => {
    return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json" },
    })
  })

  return router
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

  const router = buildRouter()

  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({
    port,
    hostname: host,
    idleTimeout: 120, // SSE 流可能需要较长时间，默认 10s 不够
    async fetch(request) {
      const url = new URL(request.url)
      const pathname = url.pathname

      // 1. 尝试匹配 API 路由
      const match = router.match(request.method, pathname)
      if (match) {
        // 填充完整的 RequestContext
        match.ctx.request = request
        match.ctx.query = url.searchParams
        const wrapped = withCorsWrapper(match.handler)
        return wrapped(match.ctx)
      }

      // 2. 处理 OPTIONS 预检
      if (request.method === "OPTIONS") {
        return handleCORS()
      }

      // 3. 静态文件服务
      const staticResponse = await serveStatic(pathname)
      if (staticResponse) return staticResponse

      // 4. SPA fallback — 所有非 API 路径回退到 index.html
      const indexResponse = await serveStatic("index.html")
      if (indexResponse) return indexResponse

      // 5. 404
      return errorResponse("Not Found", 404)
    },
    error(error) {
      console.error("[Server Error]", error)
      return errorResponse("Internal Server Error", 500)
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
