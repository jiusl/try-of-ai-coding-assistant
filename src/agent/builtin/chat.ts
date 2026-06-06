import type { AgentConfig } from "../types.js"

export const ChatAgent: AgentConfig = {
  id: "builtin:chat",
  name: "Chat Agent",
  description: "General purpose chat agent",
  capabilities: ["chat"],
  systemPrompt: "You are a helpful AI assistant.",
  toolNames: ["read_file", "glob", "grep", "think"],
  temperature: 0.7,
  maxTokens: 4096,
  maxIterations: 5,
  enabled: true
}
