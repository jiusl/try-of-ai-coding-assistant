// src/server/middleware/security.ts
// ====================================================
// 安全响应头
// ====================================================

/** 安全响应头 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' https://cdn.jsdelivr.net; " +
    "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.deepseek.com; " +
    "frame-src 'none'; " +
    "object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  // HSTS 仅在 HTTPS 下生效，通过环境变量控制
  ...(process.env.TRY_HSTS_ENABLE === "true"
    ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload" }
    : {}),
}

/** 合并安全头到已有 headers */
export function applySecurityHeaders(headers: Headers): Headers {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  }
  return headers
}
