// src/server/middleware/index.ts
// ====================================================
// Middleware barrel — 统一导出所有中间件
// ====================================================

// CORS
export { CORS_HEADERS, withCORS, handleCORS, withCorsWrapper } from "./cors.js"

// 安全头
export { SECURITY_HEADERS, applySecurityHeaders } from "./security.js"

// JSON 响应/请求
export { jsonResponse, errorResponse, apiErrorResponse, errorToStructuredResponse, successResponse, parseJsonBody } from "./json.js"

// SSE
export { createSSEResponse, createSSECloser } from "./sse.js"

// 认证
export { requireAuth } from "./auth.js"

// 静态文件
export { serveStatic } from "./static.js"

// 限流
export { RateLimiter, getRateLimiter, DEFAULT_RATE_LIMIT_CONFIG } from "./rate-limiter.js"
export type { RateLimitRule, RateLimitConfig } from "./rate-limiter.js"
