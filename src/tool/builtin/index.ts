// src/tool/builtin/index.ts
import type { ToolDefinition } from "../types.js"
import { ReadTool } from "./read.js"
import { WriteTool } from "./write.js"
import { EditTool } from "./edit.js"
import { RunCommandTool } from "./bash.js"
import { ReadCommandTool } from "./read_command.js"
import { GlobTool } from "./glob.js"
import { GrepTool } from "./grep.js"
import { ThinkTool } from "./think.js"
import { FetchWebpageTool } from "./fetch.js"
import { FileExistsTool } from "./file_exists.js"
import { ListSkillsTool, GetSkillTool } from "./skill.js"
import { RecallTool } from "./recall.js"
import { RememberTool } from "./remember.js"

/** 所有内置工具 */
export const BUILTIN_TOOLS: ToolDefinition<any, any>[] = [
  ReadTool,
  WriteTool,
  EditTool,
  RunCommandTool,
  ReadCommandTool,
  GlobTool,
  GrepTool,
  ThinkTool,
  FetchWebpageTool,
  FileExistsTool,
  ListSkillsTool,
  GetSkillTool,
  RecallTool,
  RememberTool,
]

/**
 * 内置工具实现映射表：toolName → ToolDefinition。
 * ToolLoader 扫描 tools/builtin/ 下的 TOOL.md（execution.type=internal）
 * 时通过此表查找 TS 实现。
 */
export const BUILTIN_TOOL_IMPLS: ReadonlyMap<string, ToolDefinition<any, any>> = new Map(
  BUILTIN_TOOLS.map((t) => [t.name, t]),
)

// 重新导出
export {
  ReadTool,
  WriteTool,
  EditTool,
  RunCommandTool,
  ReadCommandTool,
  GlobTool,
  GrepTool,
  ThinkTool,
  FetchWebpageTool,
  FileExistsTool,
  ListSkillsTool,
  GetSkillTool,
  RecallTool,
  RememberTool,
}
export { DelegateJSONSchema, DELEGATE_TOOL_NAME } from "./delegate.js"