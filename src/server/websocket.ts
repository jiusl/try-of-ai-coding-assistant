// src/server/websocket.ts
// ====================================================
// WebSocket 服务端 — 零依赖，基于 Bun 原生 WebSocket
// 用于 Agent 状态实时双向推送（SSE 的补充通道）
// ====================================================

import type { Server } from "bun"
import type { SSEEventType } from "./types.js"
import type { TerminalManager } from "./terminal-mgr.js"

// ====================================================
// WebSocket Data 类型（用于 ws.data）
// ====================================================

export interface WSData {
  clientId: string
  type?: "terminal"
  terminalSessionId?: string
}

// ====================================================
// 消息协议
// ====================================================

/** 客户端 → 服务端 */
export type WSClientMessage =
  | { type: "subscribe";   sessionId: string }        // 订阅会话状态
  | { type: "unsubscribe"; sessionId: string }        // 取消订阅
  | { type: "ping" }                                   // 心跳

/** 服务端 → 客户端 */
export type WSServerMessage =
  | { type: "agent_state";  sessionId: string; data: AgentStatePayload }
  | { type: "tool_call";    sessionId: string; data: ToolCallPayload }
  | { type: "chunk";        sessionId: string; data: { content: string } }
  | { type: "phase";        sessionId: string; data: { phase: string; iteration: number; currentTool?: string } }
  | { type: "done";         sessionId: string; data: { content: string; iterations: number; durationMs: number; tokensUsed?: number } }
  | { type: "error";        sessionId: string; data: { error: string; code?: string; details?: Record<string, string> } }
  | { type: "pong" }
  | { type: "connected";    clientId: string }

export interface AgentStatePayload {
  agentId: string
  phase: string
  iteration: number
  isProcessing: boolean
  isStreaming: boolean
  currentTool?: string
}

export interface ToolCallPayload {
  tool: string
  arguments: string
  result?: string | null
}

// ====================================================
// 连接管理器
// ====================================================

interface WSClient {
  id: string
  socket: import("bun").ServerWebSocket<WSData>
  subscribedSessions: Set<string>
  connectedAt: number
  lastPing: number
  /** 客户端版本号，用于拒绝旧客户端 */
  version: string
}

/** 当前 WS 协议版本 —— 不匹配的客户端会被拒绝 */
const WS_PROTOCOL_VERSION = "1"

/** 单 IP 最大连接数（localhost 浏览器可能开多个连接） */
const MAX_CONNS_PER_IP = 20

/** 心跳超时：超过此时间未收到 ping 则关闭连接 (ms) */
const HEARTBEAT_TIMEOUT_MS = 90_000

/** 僵尸清理间隔 */
const ZOMBIE_CLEANUP_INTERVAL_MS = 30_000

export class WebSocketManager {
  private clients = new Map<string, WSClient>()
  private sessionSubscribers = new Map<string, Set<string>>() // sessionId → Set<clientId>
  private ipConns = new Map<string, Set<string>>() // ip → Set<clientId>
  private zombieTimer: ReturnType<typeof setInterval> | null = null

  /** 从 WebSocket 获取远程 IP */
  private static getRemoteIP(ws: import("bun").ServerWebSocket<unknown>): string {
    try {
      // Bun 的 remoteAddress 是 string | undefined
      const addr = (ws as any).remoteAddress as string | undefined
      return addr || "unknown"
    } catch {
      return "unknown"
    }
  }

  /** 启动僵尸连接清理定时器 */
  private startZombieCleanup(): void {
    if (this.zombieTimer) return
    this.zombieTimer = setInterval(() => {
      const now = Date.now()
      const stale: string[] = []
      for (const [id, client] of this.clients) {
        if (now - client.lastPing > HEARTBEAT_TIMEOUT_MS) {
          stale.push(id)
        }
      }
      for (const id of stale) {
        const client = this.clients.get(id)
        if (client) {
          console.log(`🧟 清理僵尸连接: ${id} (失活 ${Math.round((Date.now() - client.lastPing) / 1000)}s)`)
          try { client.socket.close(1008, "heartbeat timeout") } catch { /* ignore */ }
          this.removeClient(id)
        }
      }
      if (stale.length > 0) {
        console.log(`🧹 僵尸清理完成: ${stale.length} 个连接, 剩余 ${this.clients.size} 个`)
      }
    }, ZOMBIE_CLEANUP_INTERVAL_MS)
  }

  /** 停止僵尸清理定时器 */
  stop(): void {
    if (this.zombieTimer) {
      clearInterval(this.zombieTimer)
      this.zombieTimer = null
    }
  }

  /** 创建 Bun WebSocket 配置 */
  static createConfig(manager: WebSocketManager, terminalMgr?: TerminalManager) {
    // 启动僵尸清理
    manager.startZombieCleanup()

    return {
      data: {} as WSData,

      open(ws: import("bun").ServerWebSocket<WSData>) {
        const clientId = crypto.randomUUID()
        // Bun v1.3.14 Windows: data 可能未初始化
        if (!ws.data) ws.data = { clientId: "" } as WSData
        ws.data.clientId = clientId

        // ── 终端连接：委托给 TerminalManager ──
        if (ws.data.type === "terminal" && ws.data.terminalSessionId) {
          terminalMgr?.handleOpen(ws as any, clientId, ws.data.terminalSessionId)
          return
        }

        const ip = WebSocketManager.getRemoteIP(ws)

        // IP 连接数限制
        if (!manager.ipConns.has(ip)) {
          manager.ipConns.set(ip, new Set())
        }
        const ipSet = manager.ipConns.get(ip)!
        if (ipSet.size >= MAX_CONNS_PER_IP) {
          console.log(`🚫 IP ${ip} 连接数超限 (${ipSet.size}), 拒绝新连接 ${clientId}`)
          ws.close(1013, "too many connections from this IP")
          return
        }
        ipSet.add(clientId)

        const client: WSClient = {
          id: clientId,
          socket: ws,
          subscribedSessions: new Set(),
          connectedAt: Date.now(),
          lastPing: Date.now(),
          version: "",
        }

        manager.clients.set(clientId, client)
        ws.send(JSON.stringify({ type: "connected", clientId } satisfies WSServerMessage))
        // 减少日志噪音：仅在新连接时打印，不再每次打印总数
      },

      message(
        ws: import("bun").ServerWebSocket<WSData>,
        message: string | Buffer,
      ) {
        // ── 终端连接：转发到 shell stdin ──
        if (ws.data?.type === "terminal") {
          terminalMgr?.handleMessage(ws as any, message)
          return
        }

        const clientId = ws.data?.clientId
        if (!clientId) return
        const client = manager.clients.get(clientId)
        if (!client) return

        // 更新心跳时间
        client.lastPing = Date.now()

        try {
          const msg: WSClientMessage = JSON.parse(typeof message === "string" ? message : message.toString())
          manager.handleMessage(client, msg)
        } catch {
          ws.send(JSON.stringify({
            type: "error",
            sessionId: "",
            data: { error: "无效的 JSON 消息" },
          } satisfies WSServerMessage))
        }
      },

      close(ws: import("bun").ServerWebSocket<WSData>) {
        // ── 终端连接：清理 shell 进程 ──
        if (ws.data?.type === "terminal") {
          terminalMgr?.handleClose(ws as any)
          return
        }

        const clientId = ws.data?.clientId
        if (!clientId) return
        manager.removeClient(clientId)
        // 减少日志噪音
      },
    }
  }

  /** 处理客户端消息 */
  private handleMessage(client: WSClient, msg: WSClientMessage): void {
    switch (msg.type) {
      case "subscribe": {
        client.subscribedSessions.add(msg.sessionId)
        if (!this.sessionSubscribers.has(msg.sessionId)) {
          this.sessionSubscribers.set(msg.sessionId, new Set())
        }
        this.sessionSubscribers.get(msg.sessionId)!.add(client.id)
        break
      }
      case "unsubscribe": {
        client.subscribedSessions.delete(msg.sessionId)
        const subs = this.sessionSubscribers.get(msg.sessionId)
        if (subs) {
          subs.delete(client.id)
          if (subs.size === 0) this.sessionSubscribers.delete(msg.sessionId)
        }
        break
      }
      case "ping": {
        client.socket.send(JSON.stringify({ type: "pong" } satisfies WSServerMessage))
        break
      }
    }
  }

  /** 移除客户端 */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client) return

    // 清理所有订阅
    for (const sid of client.subscribedSessions) {
      const subs = this.sessionSubscribers.get(sid)
      if (subs) {
        subs.delete(clientId)
        if (subs.size === 0) this.sessionSubscribers.delete(sid)
      }
    }

    // 清理 IP 追踪
    for (const [ip, ids] of this.ipConns) {
      ids.delete(clientId)
      if (ids.size === 0) this.ipConns.delete(ip)
    }

    this.clients.delete(clientId)
  }

  // ============================================
  // 服务端推送 API（供 handler 调用）
  // ============================================

  /** 向订阅了某会话的所有客户端广播 */
  broadcastToSession(sessionId: string, message: WSServerMessage): void {
    const subs = this.sessionSubscribers.get(sessionId)
    if (!subs) return
    const data = JSON.stringify(message)
    for (const clientId of subs) {
      const client = this.clients.get(clientId)
      if (client) {
        try { client.socket.send(data) } catch { /* 连接已关闭 */ }
      }
    }
  }

  /** 向所有客户端广播 */
  broadcastAll(message: WSServerMessage): void {
    const data = JSON.stringify(message)
    for (const client of this.clients.values()) {
      try { client.socket.send(data) } catch { /* 忽略 */ }
    }
  }

  /** 向特定客户端发送 */
  sendToClient(clientId: string, message: WSServerMessage): void {
    const client = this.clients.get(clientId)
    if (client) {
      try { client.socket.send(JSON.stringify(message)) } catch { /* 忽略 */ }
    }
  }

  // ============================================
  // 状态查询
  // ============================================

  /** 获取在线客户端数 */
  get clientCount(): number { return this.clients.size }

  /** 获取会话订阅者数 */
  getSubscriberCount(sessionId: string): number {
    return this.sessionSubscribers.get(sessionId)?.size ?? 0
  }

  /** 获取统计信息 */
  stats() {
    const sessions = new Map<string, number>()
    for (const [sid, subs] of this.sessionSubscribers) sessions.set(sid, subs.size)
    return {
      totalClients: this.clients.size,
      subscribedSessions: sessions.size,
      sessions: Object.fromEntries(sessions),
    }
  }
}
