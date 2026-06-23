// src/server/types.ts
// ====================================================
// Web 服务器相关类型定义
// ====================================================

/** HTTP 请求方法 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS"

/** 路由处理器上下文 */
export interface RequestContext {
  /** 原始 Bun Request（router 创建占位，server 填充） */
  request: Request
  /** URL 路径参数 */
  readonly params: Record<string, string>
  /** URL 查询参数（router 创建占位，server 填充） */
  query: URLSearchParams
}

/** 路由处理器 */
export type RouteHandler = (ctx: RequestContext) => Response | Promise<Response>

/** 路由定义 */
export interface Route {
  method: HttpMethod
  path: string
  handler: RouteHandler
}

// ====================================================
// API 响应类型
// ====================================================

/** 标准 API 响应 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 分页参数 */
export interface PaginationParams {
  limit?: number
  offset?: number
}

/** SSE 事件类型 */
export type SSEEventType = 
  | "chunk"            // 文本块
  | "tool_call"        // 工具调用
  | "tool_result"      // 工具结果
  | "request_confirm"  // 请求用户确认（高敏感度工具）
  | "phase"            // 阶段变化
  | "done"             // 完成
  | "error"            // 错误
  | "warning"          // 警告（如 provider 兜底）

/** SSE 事件数据 */
export interface SSEEvent {
  type: SSEEventType
  data: unknown
}

// ====================================================
// API 请求体类型
// ====================================================

/** 发送消息请求 */
export interface ChatRequest {
  sessionId?: string
  message: string
  /** 指定使用的 Agent ID（如 builtin:chat, builtin:coder），覆盖会话绑定 */
  agentId?: string
}

/** 创建会话请求 */
export interface CreateSessionRequest {
  title?: string
  model?: string
}
