// src/server/handlers/workspace.ts
// ====================================================
// Workspace API — 获取/更新工作目录
// ====================================================

import { Effect, Option } from "effect"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { Session } from "../../session/session.js"
import { defaultWorkspace, listWorkspaceSubdirs, sanitizeWorkspace } from "../../infra/workspace.js"
import {
  successResponse,
  errorResponse,
  requireAuth,
  errorToStructuredResponse,
} from "../middleware.js"

// -------------------------------------------------
// 原生文件夹选择器（跨平台）
// -------------------------------------------------

async function openNativeFolderPicker(initialDir: string): Promise<string | null> {
  const platform = process.platform

  if (platform === "win32") {
    // Windows: PowerShell + FolderBrowserDialog
    // 使用 -EncodedCommand 传 Base64(UTF-16LE)，彻底避免文件编码问题
    const { existsSync } = await import("fs")

    // 确保初始目录存在
    const validInitDir = existsSync(initialDir) ? initialDir : process.env.USERPROFILE || "C:\\"
    // PowerShell 单引号字符串：只有 ' 需要转义为 ''，路径分隔符 \ 保持原样
    const escapedDir = validInitDir.replace(/'/g, "''")

    const psScript = [
      `Add-Type -AssemblyName System.Windows.Forms`,
      `$d = New-Object System.Windows.Forms.FolderBrowserDialog`,
      `$d.Description = "选择工作目录"`,
      `$d.SelectedPath = '${escapedDir}'`,
      `$d.ShowNewFolderButton = $true`,
      `if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }`,
    ].join("\n")

    // PowerShell -EncodedCommand 要求 Base64 编码的 UTF-16LE
    const utf16Bytes = Buffer.from(psScript, "utf16le")
    const base64Cmd = utf16Bytes.toString("base64")

    const proc = Bun.spawn(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64Cmd], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    const trimmed = out.trim()
    return trimmed || null
  }

  if (platform === "darwin") {
    // macOS: 使用 osascript
    const escapedDir = initialDir.replace(/'/g, "'\\''")
    const proc = Bun.spawn([
      "osascript",
      "-e",
      `tell application "System Events" to activate`,
      "-e",
      `set d to POSIX path of (choose folder with prompt "选择工作目录" default location (POSIX file "${escapedDir}" as alias))`,
    ], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    const trimmed = out.trim()
    return trimmed || null
  }

  // Linux: 使用 zenity
  const proc = Bun.spawn([
    "zenity",
    "--file-selection",
    "--directory",
    `--filename=${initialDir}`,
    "--title=选择工作目录",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  const trimmed = out.trim()
  return trimmed || null
}

// -------------------------------------------------
// 辅助：catchAll error → 结构化错误响应
// -------------------------------------------------
function catchToErrorResponse(): (err: unknown) => Effect.Effect<Response> {
  return (err: unknown) => Effect.succeed(errorToStructuredResponse(err))
}

// -------------------------------------------------
// 注册所有 Workspace 路由
// -------------------------------------------------

export function registerWorkspaceRoutes(router: Router): void {

  // GET /api/workspace — 获取默认工作目录和子目录列表
  router.get("/api/workspace", () => {
    const ws = defaultWorkspace()
    const subdirs = listWorkspaceSubdirs(ws)
    return successResponse({ workspace: ws, subdirs })
  })

  // GET /api/sessions/:id/workspace — 获取会话工作目录
  router.get("/api/sessions/:id/workspace", async (ctx) => {
    const id = ctx.params["id"]!

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const opt = yield* svc.get(id)
        if (Option.isNone(opt)) {
          return errorResponse("Session not found", 404)
        }
        return successResponse({
          workspace: opt.value.workspace || defaultWorkspace(),
          configured: !!opt.value.workspace,
        })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // PUT /api/sessions/:id/workspace — 更新会话工作目录
  router.put("/api/sessions/:id/workspace", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    const id = ctx.params["id"]!
    const body = await ctx.request.json().catch(() => ({}))
    const workspace = body?.workspace

    if (!workspace || typeof workspace !== "string") {
      return errorResponse("缺少 workspace 参数", 400)
    }

    const result: Response = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const ws = sanitizeWorkspace(workspace)
        yield* svc.updateWorkspace(id, ws)
        return successResponse({ workspace: ws, success: true })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      )
    )
    return result
  })

  // POST /api/workspace/browse — 打开原生文件夹浏览对话框，返回选中路径
  router.post("/api/workspace/browse", async (ctx) => {
    const body = await ctx.request.json().catch(() => ({}))
    const currentDir = (body?.currentDir as string) || defaultWorkspace()

    try {
      const selectedPath = await openNativeFolderPicker(currentDir)
      if (!selectedPath) {
        return successResponse({ path: currentDir, cancelled: true })
      }
      return successResponse({ path: selectedPath })
    } catch (err: any) {
      return errorResponse(`无法打开文件夹选择器: ${err.message}`, 500)
    }
  })
}

