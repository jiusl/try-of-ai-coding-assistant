// src/web/src/hooks/useWebSocket.ts
// ====================================================
// WebSocket 连接管理 Hook（指数退避重连）
// ====================================================

import { useEffect, useRef, useCallback, useState } from "react"
import type { WSMessage } from "../types"

export type WSStatus = "connecting" | "connected" | "disconnected"

interface UseWebSocketOptions {
  onMessage?: (msg: WSMessage) => void
  sessionId?: string
}

const MAX_RECONNECT_DELAY = 30000 // 30s max
const INITIAL_RECONNECT_DELAY = 1000 // 1s initial

export function useWebSocket({ onMessage }: UseWebSocketOptions = {}) {
  const [status, setStatus] = useState<WSStatus>("disconnected")
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY)
  const mountedRef = useRef(true)
  const attemptRef = useRef(0)

  // 用 ref 存 onMessage，避免每次渲染重连
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    // 页面不可见时延迟连接
    if (document.visibilityState === "hidden") {
      scheduleReconnectRef.current()
      return
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${location.host}/api/ws`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      setStatus("connecting")

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return }
        setStatus("connected")
        reconnectDelay.current = INITIAL_RECONNECT_DELAY
        attemptRef.current = 0

        // 心跳
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }))
          }
        }, 30000)

        console.log("🔌 WebSocket 已连接")
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage
          onMessageRef.current?.(msg)
        } catch { /* ignore malformed messages */ }
      }

      ws.onclose = (event) => {
        if (!mountedRef.current) return
        setStatus("disconnected")
        clearInterval(pingTimer.current ?? undefined)
        wsRef.current = null

        // 1000=正常关闭, 1001=离开, 不重连
        if (event.code === 1000 || event.code === 1001) return

        scheduleReconnectRef.current()
      }

      ws.onerror = () => {
        // onclose will fire after this, no need to handle separately
        ws.close()
      }
    } catch {
      if (mountedRef.current) {
        setStatus("disconnected")
        scheduleReconnectRef.current()
      }
    }
  }, []) // 无依赖 — 通过 ref 访问最新回调

  const scheduleReconnectRef = useRef(() => {
    if (!mountedRef.current) return
    const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, attemptRef.current), MAX_RECONNECT_DELAY)
    attemptRef.current++
    console.log(`🔄 WebSocket ${Math.round(delay / 1000)}s 后重连… (attempt ${attemptRef.current})`)
    reconnectTimer.current = setTimeout(() => {
      connect()
    }, delay)
  })

  useEffect(() => {
    mountedRef.current = true
    connect()

    // 页面恢复可见时重连
    const onVisible = () => {
      if (document.visibilityState === "visible" && mountedRef.current) {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reconnectDelay.current = INITIAL_RECONNECT_DELAY
          attemptRef.current = 0
          connect()
        }
      }
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      mountedRef.current = false
      document.removeEventListener("visibilitychange", onVisible)
      clearTimeout(reconnectTimer.current ?? undefined)
      clearInterval(pingTimer.current ?? undefined)
      // 正常关闭，不发重连
      const ws = wsRef.current
      if (ws) {
        ws.onclose = null
        ws.close(1000, "unmount")
        wsRef.current = null
      }
    }
  }, [connect]) // connect 是 [] 依赖，只跑一次

  // 会话订阅
  const subscribe = useCallback((sid: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", sessionId: sid }))
    }
  }, [])

  const unsubscribe = useCallback((sid: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribe", sessionId: sid }))
    }
  }, [])

  return { status, subscribe, unsubscribe }
}
