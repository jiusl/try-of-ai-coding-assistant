// src/tool/builtin/delegate.ts
// delegate 是一个"虚拟工具" — 只为 LLM 提供 JSON Schema 定义，
// 实际执行在 AgentExecutor 中拦截处理，不经过 ToolRegistry。

/**
 * delegate 工具的 JSON Schema（给 LLM 做 function calling）
 * 
 * 结构化委托协议：
 * - agent_id: 目标专家 Agent ID
 * - task: 完整的任务描述（自然语言）
 * - context: 结构化上下文（文件路径、代码片段、前置条件等）
 * - expected_output: 期望的输出格式，帮助子 Agent 格式化结果
 * - priority: 优先级，影响编排器的调度
 */
export const DelegateJSONSchema = {
  type: "function" as const,
  function: {
    name: "delegate",
    description:
      "Delegate a subtask to another specialized agent using the structured agent communication protocol. " +
      "Use this when the current task can be broken into sub-tasks that require different expertise. " +
      "The sub-agent will work independently and return its result. " +
      "Available specialist agents: builtin:coder (write/edit code), " +
      "builtin:tester (write/run tests), builtin:reviewer (code review), " +
      "builtin:refactor (refactoring), builtin:researcher (documentation/API lookup). " +
      "NOTE: Do NOT delegate to builtin:chat (no file/command access), builtin:orchestrator (avoid recursion), " +
      "or builtin:builder (it is the calling agent). " +
      "Do NOT delegate to an agent already in the call chain (circular delegation will be blocked).",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description:
            "The ID of the agent to delegate to. Choose based on the subtask: " +
            "builtin:coder for writing/editing code, builtin:tester for running/writing tests, " +
            "builtin:reviewer for code review, builtin:refactor for refactoring, " +
            "builtin:researcher for web research & documentation lookup. " +
            "Do NOT use builtin:chat, builtin:orchestrator, or builtin:builder.",
        },
        task: {
          type: "string",
          description:
            "The complete task description for the delegated agent. Include: " +
            "1) what needs to be done, 2) which files are involved (full paths), " +
            "3) any constraints or requirements, 4) the expected output format.",
        },
        context: {
          type: "object",
          description:
            "Optional structured context for the sub-agent. " +
            "Include file_paths (array of relevant file paths), notes (additional instructions), " +
            "and preconditions (things that must be true before starting).",
          properties: {
            file_paths: {
              type: "array",
              items: { type: "string" },
              description: "Absolute or workspace-relative paths to relevant files",
            },
            notes: {
              type: "string",
              description: "Additional notes or hints for the sub-agent",
            },
            preconditions: {
              type: "array",
              items: { type: "string" },
              description: "Conditions that must be met before the sub-agent starts working",
            },
          },
        },
        expected_output: {
          type: "string",
          enum: ["code", "report", "boolean", "text", "summary"],
          description:
            "The expected output format: 'code' for code changes, 'report' for analysis reports, " +
            "'boolean' for yes/no answers, 'text' for natural language, 'summary' for condensed summary.",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "critical"],
          description: "Task priority, default is 'normal'",
        },
      },
      required: ["agent_id", "task"],
      additionalProperties: false,
    },
  },
}

/**
 * delegate 工具名常量
 */
export const DELEGATE_TOOL_NAME = "delegate"

/**
 * 委托参数（含结构化上下文）
 */
export interface DelegateArgs {
  agentId: string
  task: string
  context?: {
    file_paths?: string[]
    notes?: string
    preconditions?: string[]
  } | undefined
  expected_output?: "code" | "report" | "boolean" | "text" | "summary" | undefined
  priority?: "low" | "normal" | "high" | "critical" | undefined
}

/**
 * 从参数中解析 agent_id 和 task（含结构化上下文）
 */
export function parseDelegateArgs(argsJson: string): DelegateArgs {
  const parsed = JSON.parse(argsJson)
  const result: DelegateArgs = {
    agentId: String(parsed.agent_id ?? ""),
    task: String(parsed.task ?? ""),
  }
  if (parsed.context !== undefined) {
    result.context = parsed.context
  }
  if (parsed.expected_output !== undefined) {
    result.expected_output = String(parsed.expected_output) as DelegateArgs["expected_output"]
  }
  if (parsed.priority !== undefined) {
    result.priority = String(parsed.priority) as DelegateArgs["priority"]
  }
  return result
}
