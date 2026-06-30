// src/tool/builtin/index.ts
// 所有内置工具已全部迁移到 Python 脚本：
//   tools/builtin/<tool>/main.py + TOOL.md (type: script)
// TS 实现文件（*.ts）已不再被使用，可清理。
import type { ToolDefinition } from "../types.js"

/** 所有内置工具（已全部迁移到 Python 脚本，此数组为空） */
export const BUILTIN_TOOLS: ToolDefinition<any, any>[] = []

/**
 * 内置工具实现映射表：toolName → ToolDefinition。
 * 所有工具现已使用 type=script，不再有 type=internal，此表为空。
 * 保留以保持 API 兼容（ToolLoader 仍然传入此表）。
 */
export const BUILTIN_TOOL_IMPLS: ReadonlyMap<string, ToolDefinition<any, any>> = new Map()

export { DelegateJSONSchema, DELEGATE_TOOL_NAME } from "./delegate.js"