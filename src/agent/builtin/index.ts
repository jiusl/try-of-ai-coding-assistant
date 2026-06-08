import type { AgentConfig } from "../types.js"
import { ChatAgent } from "./chat.js"
import { CoderAgent } from "./coder.js"
import { BuilderAgent } from "./builder.js"
import { ReviewerAgent } from "./reviewer.js"
import { TesterAgent } from "./tester.js"
import { RefactorAgent } from "./refactor.js"
import { OrchestratorAgent } from "./orchestrator.js"
import { ResearcherAgent } from "./researcher.js"

export const BUILTIN_AGENTS: AgentConfig[] = [
  OrchestratorAgent,
  ChatAgent,
  CoderAgent,
  BuilderAgent,
  ReviewerAgent,
  TesterAgent,
  RefactorAgent,
  ResearcherAgent
]

export { ChatAgent, CoderAgent, BuilderAgent, ReviewerAgent, TesterAgent, RefactorAgent, OrchestratorAgent, ResearcherAgent }