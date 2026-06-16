// src/agent/builtin/tester.ts
import type { AgentConfig } from "../types.js"

export const TesterAgent: AgentConfig = {
  id: "builtin:tester",
  name: "Tester",
  description: "Writes and runs tests for your code",
  capabilities: ["test-run", "test-write", "code-read", "code-write"],
  systemPrompt: "You are a testing agent. Write unit tests and integration tests, run test suites, fix failing tests, and improve test coverage.",
  toolNames: ["run_command", "read_command", "read_file", "write_file", "edit_file", "glob", "think", "file_exists", "delegate", "list_skills", "get_skill"],
  temperature: 0.3,
  maxTokens: 8192,
  maxIterations: 30,
  enabled: true
}