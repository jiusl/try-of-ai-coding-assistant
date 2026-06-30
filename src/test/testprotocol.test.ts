// src/test/testprotocol.test.ts
// ====================================================
// 委托协议类型测试
// ====================================================

import { describe, it, expect } from "bun:test"
import {
  createDelegationChain,
  pushToChain,
  wouldCycle,
  exceedsMaxDepth,
  formatChain,
  generateTaskId,
  isDelegatableAgent,
  recommendAgent,
  CircularDelegationError,
  MaxDelegationDepthError,
  DelegationFailedError,
} from "../agent/protocol.js"

describe("DelegationChain", () => {

  it("createDelegationChain — 创建初始链", () => {
    const chain = createDelegationChain("root-1", "root-1", 5)
    expect(chain.path).toEqual([])
    expect(chain.depth).toBe(0)
    expect(chain.maxDepth).toBe(5)
    expect(chain.rootTaskId).toBe("root-1")
    expect(chain.parentTaskId).toBe("root-1")
  })

  it("pushToChain — 添加 Agent 后深度+1 path 包含该 agent", () => {
    const chain = createDelegationChain("r", "r", 3)
    const pushed = pushToChain(chain, "agent-A")
    expect(pushed.path).toEqual(["agent-A"])
    expect(pushed.depth).toBe(1)
    // 原链不变
    expect(chain.depth).toBe(0)
    expect(chain.path).toEqual([])
  })

  it("pushToChain — 两次推送", () => {
    const chain = createDelegationChain("r", "r", 3)
    const c1 = pushToChain(chain, "agent-A")
    const c2 = pushToChain(c1, "agent-B")
    expect(c2.path).toEqual(["agent-A", "agent-B"])
    expect(c2.depth).toBe(2)
  })

  it("wouldCycle — 检测到循环", () => {
    const chain = createDelegationChain("r", "r", 3)
    const c1 = pushToChain(chain, "agent-A")
    const c2 = pushToChain(c1, "agent-B")
    expect(wouldCycle(c2, "agent-A")).toBe(true)
    expect(wouldCycle(c2, "agent-B")).toBe(true)
    expect(wouldCycle(c2, "agent-C")).toBe(false)
  })

  it("wouldCycle — 空链不会循环", () => {
    const chain = createDelegationChain("r", "r", 3)
    expect(wouldCycle(chain, "any-agent")).toBe(false)
  })

  it("exceedsMaxDepth — 深度未超过 maxDepth", () => {
    const chain = createDelegationChain("r", "r", 3)
    expect(exceedsMaxDepth(chain)).toBe(false)
  })

  it("exceedsMaxDepth — 深度等于 maxDepth", () => {
    const chain = createDelegationChain("r", "r", 2)
    const c1 = pushToChain(chain, "A")
    const c2 = pushToChain(c1, "B")
    expect(c2.depth).toBe(2)
    expect(exceedsMaxDepth(c2)).toBe(true)
  })

  it("exceedsMaxDepth — 深度超过 maxDepth", () => {
    const chain = createDelegationChain("r", "r", 2)
    const c1 = pushToChain(chain, "A")
    const c2 = pushToChain(c1, "B")
    const c3 = pushToChain(c2, "C")
    expect(c3.depth).toBe(3)
    expect(exceedsMaxDepth(c3)).toBe(true)
  })

  it("formatChain — 格式化链", () => {
    const chain = createDelegationChain("r", "r", 3)
    const c1 = pushToChain(chain, "agent-A")
    const c2 = pushToChain(c1, "agent-B")
    expect(formatChain(c2)).toBe("agent-A → agent-B → (current)")
  })

  it("formatChain — 空链", () => {
    const chain = createDelegationChain("r", "r", 3)
    expect(formatChain(chain)).toBe("(current)")
  })
})

describe("generateTaskId", () => {
  it("生成唯一 ID", () => {
    const id1 = generateTaskId()
    const id2 = generateTaskId()
    expect(id1).toStartWith("task_")
    expect(id1).not.toBe(id2)
  })
})

describe("isDelegatableAgent", () => {
  it("orchestrator 不可委派", () => {
    expect(isDelegatableAgent("builtin:orchestrator")).toBe(false)
  })

  it("chat 不可委派", () => {
    expect(isDelegatableAgent("builtin:chat")).toBe(false)
  })

  it("coder / reviewer / tester / refactor / researcher 可委派", () => {
    expect(isDelegatableAgent("builtin:coder")).toBe(true)
    expect(isDelegatableAgent("builtin:reviewer")).toBe(true)
    expect(isDelegatableAgent("builtin:tester")).toBe(true)
    expect(isDelegatableAgent("builtin:refactor")).toBe(true)
    expect(isDelegatableAgent("builtin:researcher")).toBe(true)
  })

  it("自定义 Agent 可委派", () => {
    expect(isDelegatableAgent("user:my-agent")).toBe(true)
  })
})

describe("recommendAgent", () => {
  const agents = [
    { id: "builtin:coder", capabilities: ["code-write", "code-edit"] },
    { id: "builtin:tester", capabilities: ["test-run", "test-write"] },
    { id: "builtin:reviewer", capabilities: ["code-review"] },
    { id: "builtin:orchestrator", capabilities: ["chat"] },
  ]

  it("根据能力匹配返回最佳 Agent", () => {
    const result = recommendAgent(["code-write", "code-edit"], agents)
    expect(result).toBe("builtin:coder")
  })

  it("无匹配时返回 null", () => {
    const result = recommendAgent(["no-such-cap"], agents)
    expect(result).toBeNull()
  })

  it("不推荐 orchestrator", () => {
    const result = recommendAgent(["chat"], agents)
    // orchestrator has chat but should be excluded
    expect(result).toBeNull()
  })

  it("多能力匹配时取最高分", () => {
    const result = recommendAgent(["test-run", "test-write", "code-review"], agents)
    // tester has 2 matches, reviewer has 1
    expect(result).toBe("builtin:tester")
  })
})

describe("Error 类型", () => {
  it("CircularDelegationError", () => {
    const err = new CircularDelegationError({ chain: "A → B → A", agentId: "A" })
    expect(err._tag).toBe("CircularDelegationError")
    expect(err.chain).toBe("A → B → A")
    expect(err.agentId).toBe("A")
  })

  it("MaxDelegationDepthError", () => {
    const err = new MaxDelegationDepthError({ depth: 4, maxDepth: 3 })
    expect(err._tag).toBe("MaxDelegationDepthError")
    expect(err.depth).toBe(4)
    expect(err.maxDepth).toBe(3)
  })

  it("DelegationFailedError", () => {
    const err = new DelegationFailedError({ agentId: "coder", reason: "timeout" })
    expect(err._tag).toBe("DelegationFailedError")
    expect(err.agentId).toBe("coder")
    expect(err.reason).toBe("timeout")
  })
})
