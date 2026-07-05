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
  /** 是否需要跳过 stdout 中 shell 回显的命令行 */
  skipEcho: boolean
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

    // Windows 使用 PowerShell（管道模式下交互体验更好），Linux/macOS 使用 bash
    const shellKey = process.platform === "win32" ? "powershell.exe" : "bash"
    const shellArgs = process.platform === "win32" ? ["-NoLogo", "-NoExit"] : []

    const proc = Bun.spawn([shellKey, ...shellArgs], {
      cwd: workspace,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" },
    })

    const session: TerminalSession = { clientId, ws, proc, skipEcho: false }
    this.sessions.set(clientId, session)

    // 发送初始提示（路径 + 换行）
    const banner = new TextEncoder().encode(
      `\x1b[36m${workspace}\x1b[0m\r\n`
    )
    try { ws.send(banner) } catch { /* ignore */ }

    // ── stdout → WS（带 echo 抑制）──
    // 前端本地回显 + shell stdout 回显 = 双重显示。
    // 收到完整命令后跳过 shell 回显的命令行，只转发实际输出。
    const stdoutReader = proc.stdout.getReader()
    const readStdout = async () => {
      try {
        while (true) {
          const { done, value } = await stdoutReader.read()
          if (done) break
          if (session.skipEcho && value && value.length > 0) {
            const nl = value.indexOf(10) // LF
            if (nl >= 0) {
              session.skipEcho = false
              const rest = value.subarray(nl + 1)
              if (rest.length > 0) {
                try { ws.send(rest) } catch { break }
              }
            }
            // 没找到换行 → 整块都是回显，全部跳过
            continue
          }
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
  async handleMessage(ws: ServerWebSocket<unknown>, message: string | Buffer): Promise<void> {
    const clientId = this.findClientId(ws)
    if (!clientId) return
    const session = this.sessions.get(clientId)
    if (!session?.proc?.stdin) return

    // Buffer 在 Bun 中就是 Uint8Array，直接使用；字符串需要编码
    const data: Uint8Array = typeof message === "string"
      ? new TextEncoder().encode(message)
      : message

    try {
      await session.proc.stdin.write(data)
      // 检测是否为完整命令行（以 \r\n 结尾）→ 标记跳过 shell 回显
      if (data.length >= 2 &&
          data[data.length - 2] === 13 && data[data.length - 1] === 10) {
        session.skipEcho = true
      }
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
