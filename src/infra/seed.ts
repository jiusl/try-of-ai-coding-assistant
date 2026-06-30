// src/infra/seed.ts
// ====================================================
// Demo 种子数据 — 生成示例会话和聊天记录
// ====================================================

import { Database as BunDatabase } from "bun:sqlite"
import { logger } from "./logger.js"

// -------------------------------------------------
// 类型定义
// -------------------------------------------------

export interface SeedOptions {
  /** 生成会话数量 */
  sessionCount?: number
  /** 每个会话的消息数量 */
  messagesPerSession?: number
  /** 是否清空现有数据 */
  clearFirst?: boolean
}

interface SeedResult {
  sessions: number
  messages: number
  users: number
}

// -------------------------------------------------
// 示例数据
// -------------------------------------------------

const DEMO_SESSION_TITLES = [
  "如何使用 Effect-TS 管理副作用",
  "Bun 运行时性能优化指南",
  "TypeScript 高级类型体操",
  "设计一个 RESTful API",
  "重构遗留代码的最佳实践",
  "实现一个简单的编译器",
  "AI Agent 架构设计讨论",
  "数据库索引优化分析",
  "Docker 容器化部署方案",
  "微服务 vs 单体架构选择",
]

const DEMO_USER_MESSAGES = [
  "请问如何在 TypeScript 中使用 Effect-TS 来管理副作用？",
  "帮我优化一下这个函数的性能",
  "这段代码有什么问题？帮我分析一下",
  "我想学习如何设计一个可扩展的插件系统",
  "能帮我写一个简单的 LRU 缓存实现吗？",
  "解释一下 Event Loop 和微任务的区别",
  "如何正确使用 Bun 的 SQLite 支持？",
  "帮我写一个命令行工具的脚手架",
  "这段代码的单元测试该怎么写？",
  "如何实现文件的增量读取？",
]

const DEMO_AI_RESPONSES = [
  `这是一个很好的问题！Effect-TS 提供了强大的副作用管理系统。

首先，你需要理解 Effect 的核心概念：

1. **Effect<R, E, A>** 表示一个程序，需要环境 R，可能失败为 E，成功返回 A
2. 使用 \`Effect.gen\` 可以用生成器语法编写 Effect 程序
3. 通过 \`Layer\` 提供依赖注入

这里是一个简单示例：
\`\`\`typescript
import { Effect, Context, Layer } from "effect"

// 定义服务接口
interface Logger {
  readonly log: (msg: string) => Effect.Effect<void>
}
class LoggerTag extends Context.Tag("Logger")<LoggerTag, Logger>() {}

// 实现
const ConsoleLoggerLive = Layer.succeed(LoggerTag, {
  log: (msg) => Effect.sync(() => console.log(\`[LOG]\`, msg))
})

// 使用
const program = Effect.gen(function* () {
  const logger = yield* LoggerTag
  yield* logger.log("Hello, Effect-TS!")
  return "done"
})

// 运行
Effect.runPromise(program.pipe(Effect.provide(ConsoleLoggerLive)))
\`\`\`

这种模式让你可以轻松测试和替换依赖。`,
  `分析你的代码后，我发现几个可以优化的地方：

1. **避免不必要的数组拷贝**：使用 \`for...of\` 替代 \`forEach\`
2. **使用 Set 进行 O(1) 查找**：如果需要频繁查找
3. **惰性求值**：使用生成器处理大数据集

优化后的版本：
\`\`\`typescript
function processItems(items: Item[]): Result[] {
  const seen = new Set<string>()
  const results: Result[] = []
  
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    
    if (item.score > THRESHOLD) {
      results.push(transform(item))
    }
  }
  
  return results
}
\`\`\`

这样时间复杂度从 O(n²) 降低到 O(n)。`,
  `让我来帮你分析一下这段代码的问题：

**问题 1: 潜在的空指针异常**
\`data.config\` 可能为 \`undefined\`，直接访问 .settings 会崩溃。

**问题 2: 异步操作未正确处理**
第 23 行的 HTTP 请求没有错误处理。

**问题 3: 内存泄漏风险**
事件监听器在组件卸载时没有移除。

建议修复：
\`\`\`typescript
// 使用可选链和空值合并
const settings = data?.config?.settings ?? DEFAULT_SETTINGS

// 添加错误处理
try {
  const response = await fetch(url)
  if (!response.ok) throw new Error(\`HTTP \${response.status}\`)
} catch (err) {
  logger.error("请求失败", { error: String(err) })
  return fallbackValue
}

// 使用 AbortController 管理生命周期
const controller = new AbortController()
return () => controller.abort()
\`\`\``,
]

const DEMO_ROLES = ["admin", "editor", "viewer"] as const

// -------------------------------------------------
// 种子数据服务
// -------------------------------------------------

function getDbPath(): string {
  return process.env.TRY_DB_PATH ?? "./try.db"
}

class SeedService {
  /**
   * 生成种子数据
   */
  seed(options: SeedOptions = {}): SeedResult {
    const {
      sessionCount = 5,
      messagesPerSession = 6,
      clearFirst = false,
    } = options

    const db = new BunDatabase(getDbPath())
    try {
      let existingSessions = 0

      if (clearFirst) {
        db.run("DELETE FROM messages")
        db.run("DELETE FROM sessions")
        db.run("DELETE FROM user_roles")
        db.run("DELETE FROM users")
        db.run("DELETE FROM _audit_log")
        logger.info("种子数据: 已清空现有数据")
      } else {
        existingSessions = (db.query("SELECT COUNT(*) as cnt FROM sessions").get() as { cnt: number }).cnt
        if (existingSessions > 0) {
          logger.info(`种子数据: 已有 ${existingSessions} 个会话，跳过生成`)
          return { sessions: existingSessions, messages: 0, users: 0 }
        }
      }

      logger.info("种子数据: 开始生成演示数据...")

      // 1. 创建演示用户
      const demoUsers = [
        { name: "Alice", role: "admin" },
        { name: "Bob", role: "editor" },
        { name: "Charlie", role: "viewer" },
      ]

      const userIds: string[] = []
      for (const { name, role } of demoUsers) {
        const userId = crypto.randomUUID()
        const apiToken = crypto.randomUUID().replace(/-/g, "")
        db.run(
          "INSERT OR IGNORE INTO users (id, name, api_token, email) VALUES (?, ?, ?, ?)",
          [userId, name, apiToken, `${name.toLowerCase()}@demo.local`]
        )
        db.run(
          "INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, 'seed')",
          [userId, role]
        )
        userIds.push(userId)
      }

      // 2. 创建演示会话和消息
      let totalMessages = 0
      for (let s = 0; s < sessionCount; s++) {
        const sessionId = crypto.randomUUID()
        const title = DEMO_SESSION_TITLES[s % DEMO_SESSION_TITLES.length]!
        const now = Date.now() - (sessionCount - s) * 3600000 // 每个会话间隔 1 小时

        db.run(
          "INSERT INTO sessions (id, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, 'active')",
          [sessionId, title, now, now + messagesPerSession * 60000]
        )

        // 生成消息
        for (let m = 0; m < messagesPerSession; m++) {
          const role = m % 2 === 0 ? "user" : "assistant"
          const content = role === "user"
            ? DEMO_USER_MESSAGES[m % DEMO_USER_MESSAGES.length]!
            : DEMO_AI_RESPONSES[Math.min(m, DEMO_AI_RESPONSES.length - 1)]!

          db.run(
            "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            [sessionId, role, content, now + m * 60000]
          )
          totalMessages++
        }
      }

      // 3. 创建一些审计日志记录
      const auditActions = [
        "session_create", "chat_message", "config_access",
        "tool_call", "session_update",
      ]
      for (let i = 0; i < 10; i++) {
        const traceId = crypto.randomUUID()
        const action = auditActions[i % auditActions.length]!
        db.run(
          "INSERT INTO _audit_log (trace_id, action, resource, detail) VALUES (?, ?, ?, ?)",
          [traceId, action, `/api/sessions/${i}`, `Demo audit entry ${i + 1}`]
        )
      }

      logger.info(`种子数据生成完成: ${sessionCount} 个会话, ${totalMessages} 条消息, ${demoUsers.length} 个用户`)
      return { sessions: sessionCount, messages: totalMessages, users: demoUsers.length }
    } finally {
      db.close()
    }
  }

  /**
   * 清除所有数据
   */
  clear(): void {
    const db = new BunDatabase(getDbPath())
    try {
      db.run("DELETE FROM messages")
      db.run("DELETE FROM sessions")
      db.run("DELETE FROM user_roles")
      db.run("DELETE FROM users")
      db.run("DELETE FROM _audit_log")
      db.run("DELETE FROM _metrics_counters")
      db.run("DELETE FROM _metrics_histograms")
      logger.info("种子数据: 已清空所有数据")
    } finally {
      db.close()
    }
  }
}

/** 全局种子数据服务单例 */
export const seedService = new SeedService()
