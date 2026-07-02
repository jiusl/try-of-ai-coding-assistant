// src/server/terminal-mgr.ts
// ====================================================
// 终端会话管理器 — 管理每个 WebSocket 连接的 shell 子进程
// ====================================================

import type { ServerWebSocket, Subprocess } from "bun"
import { Effect, Option } from "effect"
import { AppRuntime } from "../effect/app-runtime.js"
import { Session } from "../session/session.js"
import { defaultWorkspace } from "../infra/workspace.js"
import { existsSync } from "fs"

interface TerminalSession {
  clientId: string
  ws: ServerWebSocket<unknown>
  proc: Subprocess | null
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>()

  /** 新建终端连接：查询 workspace → 启动 shell → 桥接 IO */
  async handleOpen(ws: ServerWebSocket<unknown>, clientId: string, sessionId: string): Promise<void> {
    // 确定工作目录：先查会话 workspace，回退到默认
    let workspace = defaultWorkspace()
    try {
      const opt = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const svc = yield* Session
          const sessionInfo = yield* svc.get(sessionId)
          return sessionInfo
        }).pipe(
          Effect.catchAll(() => Effect.succeed(Option.none<{ workspace: string }>()))
        )
      ) as Option.Option<{ workspace: string }>
      if (Option.isSome(opt) && opt.value.workspace && existsSync(opt.value.workspace)) {
        workspace = opt.value.workspace
      }
    } catch { /* 使用默认路径 */ }

    const shellKey = process.platform === "win32" ? "cmd.exe" : "bash"

    const proc = Bun.spawn([shellKey], {
      cwd: workspace,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" },
    })

    const session: TerminalSession = { clientId, ws, proc }
    this.sessions.set(clientId, session)

    // 发送初始提示（路径 + 换行）
    const banner = new TextEncoder().encode(
      `\x1b[36m${workspace}\x1b[0m\r\n`
    )
    try { ws.send(banner) } catch { /* ignore */ }

    // ── stdout → WS ──
    const stdoutReader = proc.stdout.getReader()
    const readStdout = async () => {
      try {
        while (true) {
          const { done, value } = await stdoutReader.read()
          if (done) break
          try { ws.send(value) } catch { break }
        }
      } catch { /* 连接已关闭 */ }
    }
    readStdout()

    // ── stderr → WS ──
    const stderrReader = proc.stderr.getReader()
    const readStderr = async () => {
      try {
        while (true) {
          const { done, value } = await stderrReader.read()
          if (done) break
          try { ws.send(value) } catch { break }
        }
      } catch { /* 连接已关闭 */ }
    }
    readStderr()

    // ── 进程退出处理 ──
    proc.exited.then((exitCode) => {
      try {
        ws.send(new TextEncoder().encode(
          `\r\n\x1b[33m[进程已退出, 退出码: ${exitCode}]\x1b[0m\r\n`
        ))
        ws.close(1000, "process exited")
      } catch { /* ignore */ }
      this.sessions.delete(clientId)
    })
  }

  /** 将客户端输入写入 shell stdin */
  handleMessage(ws: ServerWebSocket<unknown>, message: string | Buffer): void {
    const clientId = this.findClientId(ws)
    if (!clientId) return
    const session = this.sessions.get(clientId)
    if (!session?.proc?.stdin) return

    // Buffer 在 Bun 中就是 Uint8Array，直接使用；字符串需要编码
    const data: Uint8Array = typeof message === "string"
      ? new TextEncoder().encode(message)
      : message

    try {
      ;(session.proc.stdin as any).write(data)
    } catch { /* 进程可能已退出 */ }
  }

  /** 连接关闭 → 清理进程 */
  handleClose(ws: ServerWebSocket<unknown>): void {
    const clientId = this.findClientId(ws)
    if (!clientId) return
    const session = this.sessions.get(clientId)
    if (session?.proc) {
      try { session.proc.kill() } catch { /* ignore */ }
    }
    this.sessions.delete(clientId)
  }

  private findClientId(ws: ServerWebSocket<unknown>): string | null {
    for (const [id, session] of this.sessions) {
      if (session.ws === ws) return id
    }
    return null
  }
}
