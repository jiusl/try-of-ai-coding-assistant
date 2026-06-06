// src/agent/builtin/reviewer.ts
import type { AgentConfig } from "../types.js"

export const ReviewerAgent: AgentConfig = {
  id: "builtin:reviewer",
  name: "Code Reviewer",
  description: "Reviews code for quality, bugs, and best practices",
  capabilities: ["code-review", "code-read"],
  systemPrompt: "You are a code review agent. Review code for quality, bugs, security, performance, and best practices. Be constructive and specific.",
  toolNames: ["read_file", "glob", "grep", "think", "delegate"],
  temperature: 0.4,
  maxTokens: 8192,
  maxIterations: 5,
  enabled: true
}