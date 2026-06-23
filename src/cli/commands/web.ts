// src/cli/commands/web.ts
// ====================================================
// Web UI 命令 — 启动本地 Web 界面
// ====================================================

import { Command } from "commander"
import { startServer } from "../../server/index.js"

export const webCommand = new Command("web")
  .description("Start the web-based user interface")
  .option("-p, --port <number>", "Server port (default: 3456)", "3456")
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

    // 优雅关闭
    const shutdown = () => {
      console.log("\n正在关闭服务器...")
      server.stop()
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
  })
