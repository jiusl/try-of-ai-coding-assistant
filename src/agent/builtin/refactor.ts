// src/agent/builtin/refactor.ts
import type { AgentConfig } from "../types.js"

export const RefactorAgent: AgentConfig = {
  id: "builtin:refactor",
  name: "Refactor",
  description: "Refactors code for better structure and maintainability",
  capabilities: ["refactor", "code-read", "code-write", "code-edit"],
  systemPrompt: "You are a refactoring agent. Improve code structure without changing behavior. Extract functions, simplify logic, remove duplication, apply design patterns.",
  toolNames: ["read_file", "edit_file", "write_file", "glob", "grep", "think", "delegate"],
  temperature: 0.3,
  maxTokens: 8192,
  maxIterations: 10,
  enabled: true
}