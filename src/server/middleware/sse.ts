// src/server/middleware/sse.ts
// ====================================================
// SSE (Server-Sent Events) 辅助
// ====================================================

import { CORS_HEADERS } from "./cors.js"

/** 创建 SSE 流响应 */
export function createSSEResponse(): {
  response: Response
  send: (event: string, data: string) => void
  close: () => void
  /** 客户端是否仍然连接 */
  isConnected: () => boolean
} {
  let controller: ReadableStreamDefaultController | null = null
  let cancelled = false

  const stream = new ReadableStream({
    start(c) {
      controller = c
    },
    cancel() {
      cancelled = true
      controller = null
    },
  })

  const encoder = new TextEncoder()

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...CORS_HEADERS,
    },
  })

  function send(event: string, data: string) {
    if (controller) {
      try {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
      } catch {
        cancelled = true
        controller = null
      }
    }
  }

  function close() {
    if (controller) {
      try { controller.close() } catch { /* already closed */ }
      controller = null
    }
  }

  function isConnected() {
    return !cancelled && controller !== null
  }

  return { response, send, close, isConnected }
}

/** 关闭 SSE 流 */
export function createSSECloser(response: { response: Response; send: (event: string, data: string) => void }) {
  let closed = false
  return {
    send: response.send,
    close() {
      if (!closed) {
        closed = true
        response.send("done", JSON.stringify({}))
      }
    },
  }
}
