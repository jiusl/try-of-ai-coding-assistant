// src/index.ts
import { cli } from "./cli/index.js"
import { logger } from "./infra/logger.js"

// ====================================================
// 主入口
// ====================================================

export async function main() {
  try {
    cli.parse(process.argv, { from: "node" })
  } catch (error) {
    logger.error("运行失败", { error: String(error) })
    process.exit(1)
  }
}

// 直接运行时
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}