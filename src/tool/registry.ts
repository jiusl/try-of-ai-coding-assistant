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
  const raw = JSONSchema.make(schema) as unknown as Record<string, unknown>
  // 去掉 Effect 元数据字段，避免部分 LLM 提供商拒绝
  delete raw["$schema"]
  delete raw["$id"]
  // 安全防护：无 type 字段时兜底为 object（如 Schema.Unknown）
  if (!raw.type) {
    return { type: "object" }
  }
  // 安全防护：如果根节点 type 不是 "object"，用 properties 包裹
  if (raw.type !== "object" && raw.properties) {
    return {
      type: "object",
      properties: raw.properties,
      required: raw.required ?? [],
      additionalProperties: false
    }
  }
  return raw
}

// 从工具输入中提取权限匹配用的资源路径
const extractResource = (toolName: string, input: Record<string, unknown>): string => {
  // 文件类工具：使用 filePath（统一为正斜杠，确保 micromatch 跨平台一致）
  if ("filePath" in input && typeof input.filePath === "string") {
    return input.filePath.replace(/\\/g, "/")
  }
  // 搜索路径参数（grep 等）
  if ("path" in input && typeof input.path === "string") {
    return input.path.replace(/\\/g, "/")
  }
  // 命令类工具：只提取命令名（第一个词），避免路径中的 / 阻断 micromatch * 匹配
  if ("command" in input && typeof input.command === "string") {
    const tokens = input.command.split(/\s+/)
    // pip install / pip uninstall / python -m pip install 需要多词精确匹配
    if (tokens[0] === "pip" || tokens[0] === "pip3") {
      return tokens.slice(0, 2).join(" ")
    }
    if (tokens[0] === "python" || tokens[0] === "python3") {
      if (tokens[1] === "-m" && (tokens[2] === "pip" || tokens[2] === "pip3")) {
        return tokens.slice(0, 4).join(" ")
      }
    }
    return tokens[0] ?? input.command
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

  /** 清空所有已注册工具（用于热重载） */
  readonly clear: () => Effect.Effect<void>
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
        
        // 用户工具优先使用 rawParameters（直接从 TOOL.md 的 parameters 区解析），
        // 内置工具通过 inputSchema 的 Effect Schema 转换
        const parameters = tool.rawParameters ?? toJSONSchema(tool.inputSchema)
        
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
    
    /**
     * 将 Schema 校验错误格式化为 LLM 友好的提示
     * - 提取字段名、实际值、合法选项
     * - 让 LLM 能根据提示自行修正参数
     */
    const formatValidationError = (raw: Record<string, unknown>, errorMessage: string): string => {
      // Effect Schema 的错误格式类似：
      // { readonly content: string; readonly category?: "preference" | ... }
      // └─ ["category"]
      //    └─ Expected "preference", actual "test"
      const lines = errorMessage.split("\n").map(l => l.trim()).filter(Boolean)
      const hints: string[] = []
      
      // 提取 "actual XXX" 行
      for (const line of lines) {
        const actualMatch = line.match(/^\s*Expected\s+"([^"]*)",\s*actual\s+"([^"]*)"/)
        if (actualMatch) {
          const [_, expected, actual] = actualMatch
          hints.push(`期望 "${expected}"，实际传入 "${actual}"`)
          continue
        }
        // 提取路径 ["fieldname"]
        const pathMatch = line.match(/^\s*└─\s*\["([^"]+)"\]/)
        if (pathMatch) {
          hints.push(`出错的参数: "${pathMatch[1]}"`)
        }
      }
      
      // 收集所有合法枚举值
      const enumValues = new Set<string>()
      for (const line of lines) {
        const enumMatch = line.match(/Expected\s+"([^"]+)"\s*,\s*actual/)
        if (enumMatch) enumValues.add(enumMatch[1]!)
      }
      
      let hint = ""
      if (hints.length > 0) {
        hint = "\n提示: " + hints.join("；")
      }
      if (enumValues.size > 0) {
        hint += `\n合法选项: ${[...enumValues].map(v => `"${v}"`).join(", ")}`
      }
      
      // 兜底：用简短摘要
      const shortMessage = errorMessage.slice(0, 300)
      const keys = Object.keys(raw).join(", ")
      return `参数校验失败，请修正参数后重试。\n传入参数: { ${keys} }\n校验详情: ${shortMessage}${hint}`
    }

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
            message: `JSON 格式无效，请确保参数是合法 JSON。原始输入: ${argsJson.slice(0, 200)}`,
            input: argsJson
          }))
        }
        
        const rawObject = (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs))
          ? rawArgs as Record<string, unknown>
          : {}
        
        // 有 rawParameters 的用户工具：跳过 Effect Schema 校验，
        // 因为发给 LLM 的 JSON Schema 已经约束了参数形状
        if (tool.rawParameters) {
          return rawArgs as TInput
        }
        
        // 使用 Schema 验证
        const decoded = yield* Schema.decodeUnknown(tool.inputSchema)(rawArgs).pipe(
          Effect.mapError(parseError => new ToolValidationError({
            toolName: tool.name,
            message: formatValidationError(rawObject, parseError.message),
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
        
        // 解析并验证输入 —— 校验失败返回友好 ToolResult，不抛异常
        const inputResult = yield* Effect.either(
          validateAndParseInput(tool, toolCall.function.arguments)
        )
        if (inputResult._tag === "Left") {
          const ve = inputResult.left instanceof ToolValidationError
            ? inputResult.left
            : new ToolValidationError({ toolName: tool.name, message: String(inputResult.left) })
          return {
            tool_call_id: toolCall.id,
            role: "tool" as const,
            content: ve.message,
            success: false,
            error: "参数校验失败"
          }
        }
        const input = inputResult.right
        
        // 权限检查— 提取实际资源路径匹配规则
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
        
        // 执行工具（注入 SkillRegistry 供需要它的工具使用）
        // 注意：高敏感工具的确认流程由 executor 层的 ConfirmationStore 统一处理，
        // 此处不再做 tool.requireConfirm 检查，避免双重拦截。
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
    
    const clear = () =>
      Effect.gen(function* () {
        yield* Ref.set(toolsRef, new Map())
        yield* Ref.set(enabledRef, new Set())
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
      setEnabled,
      clear,
    }
  })
)