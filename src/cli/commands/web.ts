// src/cli/commands/web.ts
// ====================================================
// Web UI 命令 — 启动本地 Web 界面
// ====================================================

import { Command } from "commander"
import { startServer } from "../../server/index.js"
import { logger } from "../../infra/logger.js"

export const webCommand = new Command("web")
  .description("Start the web-based user interface")
  .option("-p, --port <number>", "Server port (default: $TRY_PORT or 3456)", process.env.TRY_PORT ?? "3456")
  .option("-H, --host <address>", "Server host (default: 127.0.0.1)", "127.0.0.1")
  .option("--no-open", "Don't open browser automatically")
  .action(async (options) => {
    const port = parseInt(options.port, 10)
    const host = options.host
    const open = options.open !== false

    if (isNaN(port) || port < 1 || port > 65535) {
      console.error("错误: 端口号必须在 1-65535 之间")
      process.exit(1)
    }

    const server = startServer({ port, host, open })

    // 优雅关闭：停止接收请求 → 排空处理中的请求 → 退出
    let isShuttingDown = false
    const shutdown = async () => {
      if (isShuttingDown) {
        // 第二次收到信号，强制退出
        logger.warn("收到第二次终止信号，强制退出")
        process.exit(1)
      }
      isShuttingDown = true

      logger.info("正在关闭服务器...")

      // 1. 停止接受新请求
      server.stop()

      // 2. 等待最多 5 秒排空现有请求
      const drainTimeout = 5000
      logger.info(`等待 ${drainTimeout / 1000} 秒排空现有请求...`)
      await new Promise((resolve) => setTimeout(resolve, drainTimeout))

      // 3. 关闭数据库连接（Bun 会在进程退出时自动关闭 SQLite，
      //    但显式清理能确保 WAL 文件被正确合并）
      logger.info("服务器已关闭")
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
  })
