// src/tool/registry.ts
import { Context, Effect, Layer, Ref, Schema, JSONSchema } from "effect"
import type { 
  ToolDefinition, 
  ToolContext, 
  ToolCall, 
  ToolResult 
} from "./types.js"
import { 
  ToolNotFoundError, 
  ToolExecutionError, 
  ToolValidationError,
  ToolPermissionError
} from "./types.js"
import { Permission } from "../permission/permission.js"
import { SkillRegistry } from "../skill/registry.js"

// ====================================================
// Schema 转 JSON Schema（用于 LLM）
// ====================================================

const toJSONSchema = <T>(schema: Schema.Schema<T>): Record<string, unknown> => {
  // 使用 Effect Schema 内置的 JSON Schema 转换
  const result = JSONSchema.make(schema) as unknown as Record<string, unknown>
  // 安全防护：如果根节点 type 不是 "object"，用 properties 包裹
  if (result.type !== "object" && result.properties) {
    return {
      type: "object",
      properties: result.properties,
      required: result.required ?? [],
      additionalProperties: false
    }
  }
  return result
}

// 从工具输入中提取权限匹配用的资源路径
const extractResource = (toolName: string, input: Record<string, unknown>): string => {
  // 文件类工具：使用 filePath
  if ("filePath" in input && typeof input.filePath === "string") {
    return input.filePath
  }
  // 搜索路径参数（grep 等）
  if ("path" in input && typeof input.path === "string") {
    return input.path
  }
  // 命令类工具：使用 command
  if ("command" in input && typeof input.command === "string") {
    return input.command
  }
  // glob 工具：使用 pattern
  if ("pattern" in input && typeof input.pattern === "string") {
    return input.pattern
  }
  // 搜索类工具：使用 query
  if ("query" in input && typeof input.query === "string") {
    return input.query
  }
  // 兜底：工具名
  return toolName
}

// ====================================================
// 服务接口
// ====================================================

export interface ToolRegistryService {
  /** 注册工具 */
  readonly register: <TInput, TOutput>(
    tool: ToolDefinition<TInput, TOutput>
  ) => Effect.Effect<void>
  
  /** 批量注册 */
  readonly registerAll: (tools: ToolDefinition[]) => Effect.Effect<void>
  
  /** 获取工具 */
  readonly get: (name: string) => Effect.Effect<ToolDefinition, ToolNotFoundError>
  
  /** 获取工具定义（用于 AI SDK function calling）*/
  readonly getOpenAIDefinition: (name: string) => Effect.Effect<Record<string, unknown>, ToolNotFoundError>
  
  /** 获取多个工具定义 */
  readonly getOpenAIDefinitions: (names: string[]) => Effect.Effect<Record<string, unknown>[], ToolNotFoundError>
  
  /** 执行工具调用 */
  readonly execute: (
    toolCall: ToolCall,
    context: ToolContext
  ) => Effect.Effect<ToolResult, ToolNotFoundError | ToolExecutionError | ToolValidationError | ToolPermissionError>
  
  /** 批量执行工具调用 */
  readonly executeBatch: (
    toolCalls: ToolCall[],
    context: ToolContext
  ) => Effect.Effect<ToolResult[], ToolNotFoundError | ToolExecutionError | ToolValidationError | ToolPermissionError>
  
  /** 列出所有工具 */
  readonly list: (options?: { enabledOnly?: boolean; category?: string }) => Effect.Effect<ToolDefinition[]>
  
  /** 启用/禁用工具 */
  readonly setEnabled: (name: string, enabled: boolean) => Effect.Effect<void, ToolNotFoundError>
}

export class ToolRegistry extends Context.Tag("ToolRegistry")<
  ToolRegistry,
  ToolRegistryService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const ToolRegistryLive = Layer.effect(
  ToolRegistry,
  Effect.gen(function* () {
    const toolsRef = yield* Ref.make<Map<string, ToolDefinition>>(new Map())
    const enabledRef = yield* Ref.make<Set<string>>(new Set())
    const permission = yield* Permission
    const skillRegistry = yield* SkillRegistry
    
    const register = <TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>) =>
      Effect.gen(function* () {
        yield* Ref.update(toolsRef, map => map.set(tool.name, tool as ToolDefinition))
        if (tool.defaultEnabled !== false) {
          yield* Ref.update(enabledRef, set => set.add(tool.name))
        }
      })
    
    const registerAll = (tools: ToolDefinition[]) =>
      Effect.gen(function* () {
        for (const tool of tools) {
          yield* register(tool)
        }
      })
    
    const get = (name: string) =>
      Effect.gen(function* () {
        const tools = yield* Ref.get(toolsRef)
        const tool = tools.get(name)
        if (!tool) {
          return yield* Effect.fail(new ToolNotFoundError({ toolName: name }))
        }
        return tool
      })
    
    const getOpenAIDefinition = (name: string) =>
      Effect.gen(function* () {
        const tool = yield* get(name)
        
        // 获取 Schema 并转换为 JSON Schema
        const parameters = toJSONSchema(tool.inputSchema)
        
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters
          }
        }
      })
    
    const getOpenAIDefinitions = (names: string[]) =>
      Effect.gen(function* () {
        const definitions: Record<string, unknown>[] = []
        for (const name of names) {
          const def = yield* getOpenAIDefinition(name)
          definitions.push(def)
        }
        return definitions
      })
    
    const validateAndParseInput = <TInput>(
      tool: ToolDefinition,
      argsJson: string
    ): Effect.Effect<TInput, ToolValidationError> =>
      Effect.gen(function* () {
        let rawArgs: unknown
        try {
          rawArgs = JSON.parse(argsJson)
        } catch (error) {
          return yield* Effect.fail(new ToolValidationError({
            toolName: tool.name,
            message: `JSON 参数格式无效: ${argsJson}`,
            input: argsJson
          }))
        }
        
        // 使用 Schema 验证（decodeUnknown 返回 Effect，通过 yield* 执行）
        const decoded = yield* Schema.decodeUnknown(tool.inputSchema)(rawArgs).pipe(
          Effect.mapError(parseError => new ToolValidationError({
            toolName: tool.name,
            message: `参数校验失败: ${parseError.message}`,
            input: rawArgs
          }))
        )
        
        return decoded as TInput
      })
    
    const execute = (toolCall: ToolCall, context: ToolContext) =>
      Effect.gen(function* () {
        const tool = yield* get(toolCall.function.name)
        const enabled = yield* Ref.get(enabledRef)
        
        if (!enabled.has(tool.name)) {
          return {
            tool_call_id: toolCall.id,
            role: "tool" as const,
            content: `工具已被禁用: ${tool.name}`,
            success: false,
            error: "工具已禁用"
          }
        }
        
        // 解析并验证输入
        const input = yield* validateAndParseInput(tool, toolCall.function.arguments)
        
        // 权限检查 — 提取实际资源路径匹配规则
        const resource = extractResource(tool.name, input as Record<string, unknown>)
        const decision = yield* permission.check(tool.permission, resource)
        
        if (decision === "deny") {
          return {
            tool_call_id: toolCall.id,
            role: "tool" as const,
            content: `权限不足: ${tool.name} 操作不被允许`,
            success: false,
            error: `权限拒绝: ${tool.permission} 操作于 ${resource}`
          }
        }
        
        // 如果需要用户确认
        if (tool.requireConfirm) {
          // TODO: 触发用户确认流程
          // 简化版：返回 ask 状态
          return {
            tool_call_id: toolCall.id,
            role: "tool" as const,
            content: `操作需要用户确认: ${tool.name}`,
            success: false,
            error: "等待用户确认"
          }
        }
        
        // 执行工具（注入 SkillRegistry 供需要它的工具使用）
        const result = yield* Effect.either(
          (tool.execute(input as never, context) as unknown as Effect.Effect<unknown, Error>).pipe(
            Effect.provideService(SkillRegistry, skillRegistry)
          )
        )
        if (result._tag === "Left") {
          const execError = result.left instanceof Error ? result.left : new Error(String(result.left))
          return {
            tool_call_id: toolCall.id,
            role: "tool" as const,
            content: `Error: ${execError.message}`,
            success: false,
            error: execError.message
          }
        }
        
        return {
          tool_call_id: toolCall.id,
          role: "tool" as const,
          content: typeof result.right === "string" ? result.right : JSON.stringify(result.right),
          success: true
        }
      }).pipe(
        Effect.mapError(error => {
          if (error instanceof ToolNotFoundError) return error
          if (error instanceof ToolExecutionError) return error
          if (error instanceof ToolValidationError) return error
          if (error instanceof ToolPermissionError) return error
          return new ToolExecutionError({
            toolName: toolCall.function.name,
            message: String(error),
            cause: error
          })
        })
      )
    
    const executeBatch = (toolCalls: ToolCall[], context: ToolContext) =>
      Effect.all(toolCalls.map(tc => execute(tc, context)))
    
    const list = (options?: { enabledOnly?: boolean; category?: string }) =>
      Effect.gen(function* () {
        const tools = yield* Ref.get(toolsRef)
        const enabled = yield* Ref.get(enabledRef)
        
        let result = Array.from(tools.values()).map(t => ({
          ...t,
          enabled: enabled.has(t.name)
        }))
        
        if (options?.enabledOnly) {
          result = result.filter(t => t.enabled)
        }
        
        if (options?.category) {
          result = result.filter(t => t.category === options.category)
        }
        
        return result
      })
    
    const setEnabled = (name: string, enabled: boolean) =>
      Effect.gen(function* () {
        yield* get(name) // 确保工具存在
        yield* Ref.update(enabledRef, set => {
          if (enabled) {
            set.add(name)
          } else {
            set.delete(name)
          }
          return set
        })
      })
    
    return {
      register,
      registerAll,
      get,
      getOpenAIDefinition,
      getOpenAIDefinitions,
      execute,
      executeBatch,
      list,
      setEnabled
    }
  })
)