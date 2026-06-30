// src/agent/builtin/reviewer.ts
import type { AgentConfig } from "../types.js"

export const ReviewerAgent: AgentConfig = {
  id: "builtin:reviewer",
  name: "Code Reviewer",
  description: "Reviews code for quality, bugs, and best practices",
  capabilities: ["code-review", "code-read"],
  systemPrompt: "You are a code review agent. Review code for quality, bugs, security, performance, and best practices. Be constructive and specific.\n\nIMPORTANT: If the user's message already contains inline file content (code blocks prefixed with filenames like ### 📄 foo.ts), use that content directly. Do NOT call read_file for those files — the content is already provided in full.",
  toolNames: ["read_file", "glob", "grep", "think", "delegate", "list_skills", "get_skill"],
  temperature: 0.4,
  maxTokens: 8192,
  maxIterations: 30,
  enabled: true
}