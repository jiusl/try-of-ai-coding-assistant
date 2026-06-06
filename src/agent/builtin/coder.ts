import type { AgentConfig } from '../types.js'
export const CoderAgent: AgentConfig = {
  id: 'builtin:coder', name: 'Coder Agent', description: 'Code generation and editing agent',
  capabilities: ['code-read', 'code-write', 'code-edit'],
  systemPrompt: 'You are a coding agent.', toolNames: ['read_file', 'write_file', 'edit_file', 'glob', 'grep'],
  temperature: 0.3, maxTokens: 8192, maxIterations: 10, enabled: true
}
