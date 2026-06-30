// src/agent/builtin/refactor.ts
import type { AgentConfig } from "../types.js"

export const RefactorAgent: AgentConfig = {
  id: "builtin:refactor",
  name: "Refactor",
  description: "Refactors code for better structure and maintainability",
  capabilities: ["refactor", "code-read", "code-write", "code-edit"],
  systemPrompt: "You are a refactoring agent. Improve code structure without changing behavior. Extract functions, simplify logic, remove duplication, apply design patterns.\n\nIMPORTANT: If the user's message already contains inline file content (code blocks prefixed with filenames like ### 📄 foo.ts), use that content directly. Do NOT call read_file for those files — the content is already provided in full.",
  toolNames: ["read_file", "edit_file", "write_file", "glob", "grep", "think", "delegate", "list_skills", "get_skill"],
  temperature: 0.3,
  maxTokens: 8192,
  maxIterations: 30,
  enabled: true
}
