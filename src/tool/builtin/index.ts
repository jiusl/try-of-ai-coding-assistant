// src/tool/builtin/index.ts
import type { ToolDefinition } from "../types.js"
import { ReadTool } from "./read.js"
import { WriteTool } from "./write.js"
import { EditTool } from "./edit.js"
import { BashTool } from "./bash.js"
import { GlobTool } from "./glob.js"
import { GrepTool } from "./grep.js"
import { ThinkTool } from "./think.js"
import { FetchWebpageTool } from "./fetch.js"

/** 所有内置工具 */
export const BUILTIN_TOOLS: ToolDefinition<any, any>[] = [
  ReadTool,
  WriteTool,
  EditTool,
  BashTool,
  GlobTool,
  GrepTool,
  ThinkTool,
  FetchWebpageTool
]

// 重新导出
export { ReadTool, WriteTool, EditTool, BashTool, GlobTool, GrepTool, ThinkTool, FetchWebpageTool }
export { DelegateJSONSchema, DELEGATE_TOOL_NAME } from "./delegate.js"