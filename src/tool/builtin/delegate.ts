// src/tool/builtin/delegate.ts
// delegate 是一个"虚拟工具" — 只为 LLM 提供 JSON Schema 定义，
// 实际执行在 AgentExecutor 中拦截处理，不经过 ToolRegistry。

/**
 * delegate 工具的 JSON Schema（给 LLM 做 function calling）
 */
export const DelegateJSONSchema = {
  type: "function" as const,
  function: {
    name: "delegate",
    description:
      "Delegate a subtask to another specialized agent. Use this when the current task can be broken " +
      "into sub-tasks that require different expertise. The sub-agent will work independently and return " +
      "its result. Available specialist agents: builtin:coder (code writing/editing), " +
      "builtin:tester (testing), builtin:reviewer (code review), builtin:refactor (refactoring), " +
      "builtin:researcher (web research & documentation lookup). " +
      "NOTE: Do NOT delegate to builtin:chat (it has no file/command access) or builtin:builder (it is the calling agent). " +
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
            "Do NOT use builtin:chat or builtin:builder.",
        },
        task: {
          type: "string",
          description: "The complete task description for the delegated agent. Be specific and include all context.",
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
 * 从参数中解析 agent_id 和 task
 */
export function parseDelegateArgs(argsJson: string): { agentId: string; task: string } {
  const parsed = JSON.parse(argsJson)
  return {
    agentId: String(parsed.agent_id ?? ""),
    task: String(parsed.task ?? ""),
  }
}
