// src/agent/builtin/tester.ts
import type { AgentConfig } from "../types.js"

export const TesterAgent: AgentConfig = {
  id: "builtin:tester",
  name: "Tester",
  description: "Writes and runs tests for your code",
  capabilities: ["test-run", "test-write", "code-read", "code-write"],
  systemPrompt: "You are a testing agent. Write unit tests and integration tests, run test suites, fix failing tests, and improve test coverage.\n\nIMPORTANT: If the user's message already contains inline file content (code blocks prefixed with filenames like ### 📄 foo.ts), use that content directly. Do NOT call read_file for those files — the content is already provided in full.",
  toolNames: ["run_command", "read_command", "read_file", "write_file", "edit_file", "glob", "think", "file_exists", "delegate", "list_skills", "get_skill"],
  temperature: 0.3,
  maxTokens: 8192,
  maxIterations: 30,
  enabled: true
}