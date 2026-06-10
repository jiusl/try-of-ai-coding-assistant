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
  FileExistsTool
]

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
  FileExistsTool
}
export { DelegateJSONSchema, DELEGATE_TOOL_NAME } from "./delegate.js"