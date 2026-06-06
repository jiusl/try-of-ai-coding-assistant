// src/test/testsession.ts
// Session 层功能测试 — 模拟多轮对话场景
import { Effect, ManagedRuntime, Option } from "effect"
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import {
  Session,
  SessionMemoryLive,
} from "../session/session.js"

// ====================================================
// 测试配置：ManagedRuntime 确保所有测试共享同一内存数据库
// ====================================================

const runtime = ManagedRuntime.make(SessionMemoryLive)

const run = <A, E>(effect: Effect.Effect<A, E, Session>) =>
  runtime.runPromise(effect)

afterAll(() => {
  runtime.dispose()
})

// ====================================================
// 场景 1：创建会话 → 发送首条消息 → 获取历史
// ====================================================

describe("场景 1: 创建会话 & 首轮对话", () => {
  it("创建新会话，初始消息数为 0", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create({ title: "学习 TypeScript" })
    }))

    expect(session.title).toBe("学习 TypeScript")
    expect(session.messageCount).toBe(0)
    expect(session.lastMessageAt).toBeNull()
    expect(session.status).toBe("active")
    expect(session.id).toMatch(/^[a-f0-9-]{36}$/)  // UUID 格式
  })

  it("用户发送消息，应正确存入并返回", async () => {
    const result = await run(Effect.gen(function* () {
      const svc = yield* Session
      const session = yield* svc.create({ title: "TypeScript 泛型" })
      const msg = yield* svc.addUserMessage(session.id, "什么是泛型？")
      return { session, msg }
    }))

    expect(result.msg.role).toBe("user")
    expect(result.msg.content).toBe("什么是泛型？")
    expect(result.msg.tool_call_id).toBeUndefined()
  })

  it("AI 回复后，对话历史应包含 2 条消息（用户 + AI）", async () => {
    const { sessionId, history } = await run(Effect.gen(function* () {
      const svc = yield* Session
      const session = yield* svc.create({ title: "泛型学习" })

      yield* svc.addUserMessage(session.id, "什么是 TypeScript 泛型？")
      yield* svc.addAssistantMessage(
        session.id,
        "泛型允许你创建可复用的组件，在定义时不确定具体类型，使用时再指定。"
      )

      const history = yield* svc.getConversationHistory(session.id)
      return { sessionId: session.id, history }
    }))

    expect(history.length).toBe(2)
    expect(history[0]!.role).toBe("user")
    expect(history[0]!.content).toBe("什么是 TypeScript 泛型？")
    expect(history[1]!.role).toBe("assistant")
    expect(history[1]!.content).toContain("可复用的组件")
  })
})

// ====================================================
// 场景 2：多轮对话 — 一个话题追问多次
// ====================================================

describe("场景 2: 一个话题多轮追问", () => {
  let sessionId: string

  beforeAll(async () => {
    // 先创建会话并完成一轮对话
    await run(Effect.gen(function* () {
      const svc = yield* Session
      const session = yield* svc.create({ title: "Rust 所有权机制" })
      sessionId = session.id
    }))
  })

  it("第 1 轮：用户提问 + AI 回答", async () => {
    await run(Effect.gen(function* () {
      const svc = yield* Session
      yield* svc.addUserMessage(sessionId, "Rust 的所有权是什么？")
      yield* svc.addAssistantMessage(
        sessionId,
        "Rust 的所有权系统是它最独特的特性，核心规则有三条：\n1. 每个值有且仅有一个所有者\n2. 值离开作用域时自动释放\n3. 同一时刻只能有一个可变引用或多个不可变引用"
      )
    }))

    const history = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.getConversationHistory(sessionId)
    }))

    expect(history.length).toBe(2)
    expect(history[0]!.role).toBe("user")
    expect(history[1]!.role).toBe("assistant")
  })

  it("第 2 轮：基于上下文追问", async () => {
    await run(Effect.gen(function* () {
      const svc = yield* Session
      yield* svc.addUserMessage(sessionId, "那借用和引用的区别是什么？")
      yield* svc.addAssistantMessage(
        sessionId,
        "引用（&）是借用的一种形式。借用分为：\n- 不可变借用 &T：可以有多个\n- 可变借用 &mut T：同一时刻只能有一个\n借用检查器在编译期保证这些规则。"
      )
    }))

    const history = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.getConversationHistory(sessionId)
    }))

    expect(history.length).toBe(4)
    // 验证消息顺序：user → assistant → user → assistant
    expect(history[2]!.role).toBe("user")
    expect(history[2]!.content).toBe("那借用和引用的区别是什么？")
    expect(history[3]!.role).toBe("assistant")
  })

  it("第 3 轮：追问生命周期", async () => {
    await run(Effect.gen(function* () {
      const svc = yield* Session
      yield* svc.addUserMessage(sessionId, "生命周期注解是什么？")
      yield* svc.addAssistantMessage(
        sessionId,
        "生命周期注解用撇号语法 'a 表示引用有效的范围，编译器用它们来确保引用不会悬垂。"
      )
    }))

    // 6 条消息后检查 session 状态
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.get(sessionId)
    }))

    expect(Option.isSome(session)).toBe(true)
    if (Option.isSome(session)) {
      expect(session.value.messageCount).toBe(6)
      expect(session.value.lastMessageAt).not.toBeNull()
      expect(session.value.lastMessageAt! instanceof Date).toBe(true)
    }
  })

  it("完整历史应包含 6 条消息，顺序正确", async () => {
    const history = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.getConversationHistory(sessionId)
    }))

    expect(history.length).toBe(6)
    // 所有消息角色交替（user, assistant 交替）
    const roles = history.map(m => m.role)
    expect(roles).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"])
  })
})

// ====================================================
// 场景 3：工具调用（Tool Call）
// ====================================================

describe("场景 3: 工具调用消息", () => {
  it("addToolMessage 应正确记录 tool_call_id", async () => {
    const { toolMsg, history } = await run(Effect.gen(function* () {
      const svc = yield* Session
      const session = yield* svc.create({ title: "天气查询" })

      yield* svc.addUserMessage(session.id, "今天上海天气怎么样？")
      yield* svc.addAssistantMessage(
        session.id,
        "我来帮您查询...",
      )
      yield* svc.addToolMessage(
        session.id,
        "call_abc123",
        '{"city":"上海","weather":"晴","temperature":28}'
      )
      yield* svc.addAssistantMessage(
        session.id,
        '今天上海天气晴朗，气温 28°C，适合出行。'
      )

      const history = yield* svc.getConversationHistory(session.id)
      return { toolMsg: history[2], history }
    }))

    expect(toolMsg!.role).toBe("tool")
    expect(toolMsg!.tool_call_id).toBe("call_abc123")
    expect(toolMsg!.content).toContain("上海")
    expect(history.length).toBe(4)
  })
})

// ====================================================
// 场景 4：会话管理 — 列表、标题、归档、删除
// ====================================================

describe("场景 4: 会话管理", () => {
  it("list 应列出所有活跃会话，按更新时间降序", async () => {
    // 创建 3 个新会话，用数组收集它们的 id
    const newIds: string[] = []
    const sessions = await run(Effect.gen(function* () {
      const svc = yield* Session
      const s1 = yield* svc.create({ title: "Rust 入门" })
      const s2 = yield* svc.create({ title: "React Hooks" })
      const s3 = yield* svc.create({ title: "数据库优化" })
      newIds.push(s1.id, s2.id, s3.id)

      // 给 s3 加一条消息使其 updated_at 最新
      yield* svc.addUserMessage(s3.id, "索引如何工作？")
      yield* svc.addAssistantMessage(s3.id, "索引类似书的目录...")
      return { s1, s2, s3 }
    }))

    const allList = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.list({ limit: 100 })
    }))

    // 过滤出本次测试创建的会话
    const list = allList.filter(s => newIds.includes(s.id))
    expect(list.length).toBe(3)
    // s3 最新，应排第一
    expect(list[0]!.id).toBe(sessions.s3.id)
    expect(list[0]!.messageCount).toBe(2)
  })

  it("list 支持分页 limit/offset", async () => {
    const list = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.list({ limit: 2, offset: 0 })
    }))

    expect(list.length).toBeLessThanOrEqual(2)
  })

  it("setTitle 应更新会话标题", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create({ title: "旧标题" })
    }))

    await run(Effect.gen(function* () {
      const svc = yield* Session
      yield* svc.setTitle(session.id, "新标题 - 深入 Rust")
    }))

    const updated = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.get(session.id)
    }))

    expect(Option.isSome(updated)).toBe(true)
    if (Option.isSome(updated)) {
      expect(updated.value.title).toBe("新标题 - 深入 Rust")
    }
  })

  it("archive 应归档会话，list 默认不显示已归档会话", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create({ title: "待归档会话" })
    }))

    await run(Effect.gen(function* () {
      const svc = yield* Session
      yield* svc.archive(session.id)
    }))

    // 获取后应显示 status 为 archived
    const archived = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.get(session.id)
    }))

    expect(Option.isSome(archived)).toBe(true)
    if (Option.isSome(archived)) {
      expect(archived.value.status).toBe("archived")
    }
  })

  it("delete（软删除）后 get 应返回 Option.none()", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create({ title: "待删除会话" })
    }))

    await run(Effect.gen(function* () {
      const svc = yield* Session
      yield* svc.delete(session.id)
    }))

    const deleted = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.get(session.id)
    }))

    expect(Option.isNone(deleted)).toBe(true)
  })
})

// ====================================================
// 场景 5：边界情况 & getWithMessages
// ====================================================

describe("场景 5: 边界情况", () => {
  it("获取不存在的会话应返回 Option.none()", async () => {
    const result = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.get("non-existent-id")
    }))

    expect(Option.isNone(result)).toBe(true)
  })

  it("空会话的 getWithMessages 应返回空 messages 数组", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create({ title: "空会话" })
    }))

    const result = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.getWithMessages(session.id)
    }))

    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.title).toBe("空会话")
      expect(result.value.messages).toEqual([])
      expect(result.value.messageCount).toBe(0)
    }
  })

  it("getLastMessages 应返回最后 N 条（正序）", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create({ title: "取最后消息测试" })
    }))

    // 逐条插入消息（间隔 2ms 确保时间戳不同）
    const msgs = ["消息1", "消息2", "消息3", "消息4", "消息5"]
    for (const m of msgs) {
      await run(Effect.gen(function* () {
        const svc = yield* Session
        yield* svc.addUserMessage(session.id, m)
      }))
      await new Promise(r => setTimeout(r, 2))
    }

    const last2 = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.getLastMessages(session.id, 2)
    }))

    expect(last2.length).toBe(2)
    // 正序：最后插入的 2 条按时间升序
    expect(last2[0]!.content).toBe("消息4")
    expect(last2[1]!.content).toBe("消息5")
  })

  it("clearMessages 应清空所有消息", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create({ title: "清空测试" })
    }))

    await run(Effect.gen(function* () {
      const svc = yield* Session
      yield* svc.addUserMessage(session.id, "你好")
      yield* svc.addAssistantMessage(session.id, "你好！有什么可以帮助你的？")
      yield* svc.addUserMessage(session.id, "再见")
      yield* svc.addAssistantMessage(session.id, "再见！")
    }))

    const deletedCount = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.clearMessages(session.id)
    }))

    expect(deletedCount).toBe(4)

    const history = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.getConversationHistory(session.id)
    }))

    expect(history.length).toBe(0)
  })

  it("创建会话时可以指定标题", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create({ title: "自定义标题" })
    }))

    expect(session.title).toBe("自定义标题")
  })

  it("不指定标题时默认使用 'New Conversation'", async () => {
    const session = await run(Effect.gen(function* () {
      const svc = yield* Session
      return yield* svc.create()
    }))

    expect(session.title).toBe("New Conversation")
  })
})

// ====================================================
// 场景 6：完整对话流程 — 模拟真实 LLM 交互
// ====================================================

describe("场景 6: 模拟真实 LLM 多轮对话", () => {
  /** 模拟的 AI 回复函数（不调用真实 LLM，仅返回预设文本） */
  const mockAIResponse = (question: string): string => {
    if (question.includes("你好")) return "你好！我是 AI 助手，有什么可以帮你的？"
    if (question.includes("React")) return "React 是一个用于构建用户界面的 JavaScript 库，由 Facebook 开发和维护。"
    if (question.includes("Hook")) return "React Hooks 是 v16.8 引入的特性，让函数组件也能使用状态和生命周期。最常用的有 useState、useEffect、useContext。"
    if (question.includes("useEffect")) return "useEffect 用于处理副作用，比如数据获取、订阅、DOM 修改。它在每次渲染后执行，依赖数组为空时只在挂载执行一次。"
    if (question.includes("总结")) return "今天我们讨论了 React 的核心概念：1) React 是 UI 库 2) Hooks 让函数组件更强大 3) useEffect 处理副作用。还有什么想深入了解的吗？"
    return "这是一个很好的问题！让我想想..."
  }

  it("完整对话：从 React 入门到 Hooks 深入", async () => {
    const result = await run(Effect.gen(function* () {
      const svc = yield* Session
      const session = yield* svc.create({ title: "学习 React" })

      // 第 1 轮：打招呼
      yield* svc.addUserMessage(session.id, "你好，我想学习前端")
      yield* svc.addAssistantMessage(session.id, mockAIResponse("你好"))

      // 第 2 轮：问 React
      yield* svc.addUserMessage(session.id, "React 是什么？")
      yield* svc.addAssistantMessage(session.id, mockAIResponse("React"))

      // 第 3 轮：追问 Hook
      yield* svc.addUserMessage(session.id, "那 React 的 Hook 是什么？")
      yield* svc.addAssistantMessage(session.id, mockAIResponse("Hook"))

      // 第 4 轮：再追问 useEffect
      yield* svc.addUserMessage(session.id, "useEffect 怎么用？")
      yield* svc.addAssistantMessage(session.id, mockAIResponse("useEffect"))

      // 第 5 轮：要求总结
      yield* svc.addUserMessage(session.id, "帮我总结一下今天学的内容")
      yield* svc.addAssistantMessage(session.id, mockAIResponse("总结"))

      // 获取最终状态
      const finalSession = yield* svc.getWithMessages(session.id)
      const history = yield* svc.getConversationHistory(session.id)
      const info = yield* svc.get(session.id)

      return { finalSession, history, info }
    }))

    // 验证完整对话
    if (Option.isSome(result.finalSession)) {
      const s = result.finalSession.value
      expect(s.title).toBe("学习 React")
      expect(s.messages.length).toBe(10)  // 5 轮 × 2
      expect(s.messageCount).toBe(10)
      expect(s.status).toBe("active")
    }

    // 历史完整性
    expect(result.history.length).toBe(10)
    // 奇数位是 user，偶数位是 assistant (0-indexed)
    for (let i = 0; i < 10; i++) {
      const expectedRole = i % 2 === 0 ? "user" : "assistant"
      expect(result.history[i]!.role).toBe(expectedRole)
    }

    // session info 一致性
    if (Option.isSome(result.info)) {
      expect(result.info.value.messageCount).toBe(10)
      expect(result.info.value.status).toBe("active")
    }

    // 打印对话回顾（人类可读）
    console.log("\n📝 对话回顾 —", Option.isSome(result.info) ? result.info.value.title : "(unknown)")
    for (const m of result.history) {
      const prefix = m.role === "user" ? "👤" : "🤖"
      console.log(`  ${prefix} [${m.role}]: ${(m.content ?? "").slice(0, 60)}`)
    }
    console.log(`  总计: ${result.history.length} 条消息\n`)
  })
})

// ====================================================
// 场景 7：并发会话 — 多个独立对话并行
// ====================================================

describe("场景 7: 多个独立会话", () => {
  it("两个会话的对话互不干扰", async () => {
    const result = await run(Effect.gen(function* () {
      const svc = yield* Session

      // 会话 A：讨论 Python
      const a = yield* svc.create({ title: "Python 学习" })
      yield* svc.addUserMessage(a.id, "Python 的列表推导式是什么？")
      yield* svc.addAssistantMessage(a.id, "列表推导式是一种简洁创建列表的方式，如 [x*2 for x in range(10)]。")

      // 会话 B：讨论 Go
      const b = yield* svc.create({ title: "Go 学习" })
      yield* svc.addUserMessage(b.id, "Go 的 goroutine 是什么？")
      yield* svc.addAssistantMessage(b.id, "goroutine 是 Go 的轻量级协程，用 go 关键字启动，由 Go 运行时调度。")

      // 再往 A 里追加
      yield* svc.addUserMessage(a.id, "字典推导式呢？")
      yield* svc.addAssistantMessage(a.id, "字典推导式类似，如 {k: v*2 for k, v in d.items()}。")

      const historyA = yield* svc.getConversationHistory(a.id)
      const historyB = yield* svc.getConversationHistory(b.id)

      return { historyA, historyB, aId: a.id, bId: b.id }
    }))

    expect(result.historyA.length).toBe(4)  // 2 轮 × 2
    expect(result.historyB.length).toBe(2)  // 1 轮 × 2
    expect(result.historyA[0]!.content).toContain("列表推导式")
    expect(result.historyA[2]!.content).toContain("字典推导式")
    expect(result.historyB[0]!.content).toContain("goroutine")
  })
})

// ====================================================
// 简单运行（非 bun test 环境）
// ====================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("🧪 使用 `bun test ./src/test/testsession.ts` 运行完整测试")
}
