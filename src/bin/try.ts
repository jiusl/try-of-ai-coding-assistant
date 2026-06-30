// bin/try.ts — 项目入口

import { main } from "../index.js"
import { logger } from "../infra/logger.js"

main().catch((error) => {
  logger.error("致命错误", { error: String(error) })
  process.exit(1)
})