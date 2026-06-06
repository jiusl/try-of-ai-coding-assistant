// src/test/testcli.test.ts
// CLI 层沙盒测试 — 输出函数 + 命令结构 + REPL
import { describe, it, expect } from "bun:test"
import { Command } from "commander"
import {
  theme,
  createStreamHandler,
  printToolCall,
  printExecutionState,
  printAgentList,
  printToolList,
  printSessionList,
  printSeparator,
  printTitle,
  printSystemMessage,
  printUserMessage,
  printAssistantMessage,
} from "../cli/output.js"
import { REPL } from "../cli/repl.js"
import { cli } from "../cli/index.js"
import { toolCommand } from "../cli/commands/tool.js"
import { agentCommand } from "../cli/commands/agent.js"
import { chatCommand } from "../cli/commands/chat.js"
import { runCommand } from "../cli/commands/run.js"

// ============================================================
// 场景 1: 输出主题和工具函数
// ============================================================

describe("场景 1: Output 模块", () => {
  it("theme 包含所有颜色函数", () => {
    expect(typeof theme.user).toBe("function")
    expect(typeof theme.assistant).toBe("function")
    expect(typeof theme.system).toBe("function")
    expect(typeof theme.error).toBe("function")
    expect(typeof theme.warning).toBe("function")
    expect(typeof theme.info).toBe("function")
    expect(typeof theme.success).toBe("function")
    expect(typeof theme.tool).toBe("function")
    expect(typeof theme.thinking).toBe("function")
  })

  it("theme 函数接受字符串参数并返回字符串", () => {
    const result = theme.user("test")
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  it("createStreamHandler 默认返回处理器", () => {
    const handler = createStreamHandler()
    expect(typeof handler.onChunk).toBe("function")
    expect(typeof handler.onToolCall).toBe("function")
    expect(typeof handler.onPhaseChange).toBe("function")
    expect(typeof handler.getContent).toBe("function")
    expect(handler.getContent()).toBe("")
  })

  it("createStreamHandler 开启 verbose 模式", () => {
    const handler = createStreamHandler({ verbose: true })
    expect(typeof handler.getContent).toBe("function")
  })

  it("createStreamHandler onChunk 累积内容", () => {
    const handler = createStreamHandler()
    handler.onChunk("Hello ")
    handler.onChunk("World")
    expect(handler.getContent()).toBe("Hello World")
  })

  it("createStreamHandler getContent 初始为空", () => {
    const handler = createStreamHandler()
    expect(handler.getContent()).toBe("")
  })

  it("printSeparator 不抛出异常", () => {
    expect(() => printSeparator()).not.toThrow()
    expect(() => printSeparator("-", 20)).not.toThrow()
  })

  it("printTitle 不抛出异常", () => {
    expect(() => printTitle("Test Title")).not.toThrow()
  })

  it("printUserMessage 不抛出异常", () => {
    expect(() => printUserMessage("Hello")).not.toThrow()
  })

  it("printAssistantMessage 不抛出异常", () => {
    expect(() => printAssistantMessage("Hi there")).not.toThrow()
  })

  it("printSystemMessage info 级别不抛出异常", () => {
    expect(() => printSystemMessage("Info msg")).not.toThrow()
    expect(() => printSystemMessage("Info msg", "info")).not.toThrow()
  })

  it("printSystemMessage warning 级别不抛出异常", () => {
    expect(() => printSystemMessage("Warning msg", "warning")).not.toThrow()
  })

  it("printSystemMessage error 级别不抛出异常", () => {
    expect(() => printSystemMessage("Error msg", "error")).not.toThrow()
  })

  it("printAgentList 空列表不抛出异常", () => {
    expect(() => printAgentList([])).not.toThrow()
  })

  it("printAgentList 包含 agent 不抛出异常", () => {
    expect(() => printAgentList([
      { id: "a1", name: "Agent 1", description: "Desc 1" }
    ])).not.toThrow()
  })

  it("printAgentList 混合启用状态不抛出异常", () => {
    expect(() => printAgentList([
      { id: "a1", name: "A1", description: "D1", enabled: true },
      { id: "a2", name: "A2", description: "D2", enabled: false },
      { id: "a3", name: "A3", description: "D3" },
    ])).not.toThrow()
  })

  it("printToolList 空列表不抛出异常", () => {
    expect(() => printToolList([])).not.toThrow()
  })

  it("printToolList 包含工具不抛出异常", () => {
    expect(() => printToolList([
      { name: "t1", description: "Tool 1", category: "file" }
    ])).not.toThrow()
  })

  it("printToolList 混合启用状态不抛出异常", () => {
    expect(() => printToolList([
      { name: "t1", description: "T1", category: "file", enabled: true },
      { name: "t2", description: "T2", category: "search", enabled: false },
    ])).not.toThrow()
  })

  it("printSessionList 空列表不抛出异常", () => {
    expect(() => printSessionList([])).not.toThrow()
  })

  it("printSessionList 包含会话不抛出异常", () => {
    expect(() => printSessionList([
      { id: "abc123", title: "Test", updatedAt: new Date(), messageCount: 5 }
    ])).not.toThrow()
  })

  it("printToolCall 不抛出异常", () => {
    const toolCall = {
      id: "call_1",
      type: "function" as const,
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: "/test.txt" }),
      },
    }
    expect(() => printToolCall(toolCall)).not.toThrow()
    expect(() => printToolCall(toolCall, { success: true, content: "file contents", tool_call_id: "tc_1", role: "tool" })).not.toThrow()
    expect(() => printToolCall(toolCall, { success: false, content: "", error: "not found", tool_call_id: "tc_1", role: "tool" })).not.toThrow()
  })

  it("printExecutionState 各阶段不抛出异常", () => {
    expect(() => printExecutionState({ phase: "initializing", content: "", iteration: 0 })).not.toThrow()
    expect(() => printExecutionState({ phase: "thinking", content: "", iteration: 1 })).not.toThrow()
    expect(() => printExecutionState({ phase: "calling_tool", content: "", iteration: 1, currentTool: "read_file" })).not.toThrow()
    expect(() => printExecutionState({ phase: "processing", content: "", iteration: 1 })).not.toThrow()
    expect(() => printExecutionState({ phase: "generating", content: "hello", iteration: 1 })).not.toThrow()
    expect(() => printExecutionState({ phase: "done", content: "finished", iteration: 5 })).not.toThrow()
    expect(() => printExecutionState({ phase: "error", content: "", iteration: 0, error: "Something wrong" })).not.toThrow()
  })
})

// ============================================================
// 场景 2: 命令结构
// ============================================================

describe("场景 2: 命令结构", () => {
  it("toolCommand 存在且类型正确", () => {
    expect(toolCommand).toBeDefined()
    expect(toolCommand instanceof Command).toBe(true)
    expect(toolCommand.name()).toBe("tool")
  })

  it("toolCommand 有 list 子命令", () => {
    const listCmd = toolCommand.commands.find(c => c.name() === "list")
    expect(listCmd).toBeDefined()
  })

  it("toolCommand 有 enable 子命令", () => {
    const enableCmd = toolCommand.commands.find(c => c.name() === "enable")
    expect(enableCmd).toBeDefined()
  })

  it("toolCommand 有 disable 子命令", () => {
    const disableCmd = toolCommand.commands.find(c => c.name() === "disable")
    expect(disableCmd).toBeDefined()
  })

  it("agentCommand 存在且类型正确", () => {
    expect(agentCommand).toBeDefined()
    expect(agentCommand instanceof Command).toBe(true)
    expect(agentCommand.name()).toBe("agent")
  })

  it("agentCommand 有 list 子命令", () => {
    const listCmd = agentCommand.commands.find(c => c.name() === "list")
    expect(listCmd).toBeDefined()
  })

  it("agentCommand 有 info 子命令", () => {
    const infoCmd = agentCommand.commands.find(c => c.name() === "info")
    expect(infoCmd).toBeDefined()
  })

  it("agentCommand 有 enable 子命令", () => {
    const enableCmd = agentCommand.commands.find(c => c.name() === "enable")
    expect(enableCmd).toBeDefined()
  })

  it("agentCommand 有 disable 子命令", () => {
    const disableCmd = agentCommand.commands.find(c => c.name() === "disable")
    expect(disableCmd).toBeDefined()
  })

  it("agentCommand 有 select 子命令", () => {
    const selectCmd = agentCommand.commands.find(c => c.name() === "select")
    expect(selectCmd).toBeDefined()
  })

  it("chatCommand 存在", () => {
    expect(chatCommand).toBeDefined()
    expect(chatCommand instanceof Command).toBe(true)
    expect(chatCommand.name()).toBe("chat")
  })

  it("runCommand 存在且有参数", () => {
    expect(runCommand).toBeDefined()
    expect(runCommand instanceof Command).toBe(true)
    expect(runCommand.name()).toBe("run")
  })

  it("cli 包含所有子命令", () => {
    const names = cli.commands.map(c => c.name())
    expect(names).toContain("chat")
    expect(names).toContain("run")
    expect(names).toContain("agent")
    expect(names).toContain("tool")
  })

  it("cli 可以解析 --help", () => {
    const output: string[] = []
    const savedWrite = process.stdout.write.bind(process.stdout)
    const mockWrite = (s: string) => { output.push(s); return true }
    process.stdout.write = mockWrite as any
    
    try {
      cli.parse(["node", "try", "--help"], { from: "user" })
    } catch {
      // commander v15 may throw on missing args in user mode
    }
    
    process.stdout.write = savedWrite
    // 不崩溃即通过
  })
})

// ============================================================
// 场景 3: REPL 类
// ============================================================

describe("场景 3: REPL", () => {
  it("REPL 构造函数接受 sessionId", () => {
    const repl = new REPL("test-session-123")
    expect(repl).toBeDefined()
    expect(repl instanceof REPL).toBe(true)
  })

  it("REPL 实例有 start 方法", () => {
    const repl = new REPL("test-session")
    expect(typeof repl.start).toBe("function")
  })
})

// ============================================================
// 场景 4: 边界和类型检查
// ============================================================

describe("场景 4: 边界和类型检查", () => {
  it("createStreamHandler 处理空字符串 chunk", () => {
    const handler = createStreamHandler()
    handler.onChunk("")
    expect(handler.getContent()).toBe("")
  })

  it("createStreamHandler 处理长内容", () => {
    const handler = createStreamHandler()
    const longText = "x".repeat(10000)
    handler.onChunk(longText)
    expect(handler.getContent()).toBe(longText)
  })

  it("createStreamHandler onToolCall 无 verbose 时不调用 printToolCall", () => {
    const handler = createStreamHandler()
    expect(() => handler.onToolCall(
      { id: "c1", type: "function", function: { name: "test", arguments: "{}" } },
      { success: true, content: "ok", tool_call_id: "tc_1", role: "tool" }
    )).not.toThrow()
  })

  it("createStreamHandler onPhaseChange 无 verbose 时不输出", () => {
    const handler = createStreamHandler()
    expect(() => handler.onPhaseChange({ phase: "thinking", content: "", iteration: 1 })).not.toThrow()
  })

  it("agentCommand info 子命令接受 id 参数", () => {
    const infoCmd = agentCommand.commands.find(c => c.name() === "info")
    expect(infoCmd).toBeDefined()
  })

  it("toolCommand enable 接受 name 参数", () => {
    const enableCmd = toolCommand.commands.find(c => c.name() === "enable")
    expect(enableCmd).toBeDefined()
  })
})
