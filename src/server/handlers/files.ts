// src/server/handlers/files.ts
// ====================================================
// 文件浏览 API — 目录列表 + 文件内容读取
// ====================================================

import { Effect, Option } from "effect"
import { readdirSync, statSync, readFileSync } from "fs"
import { resolve, join, extname, basename } from "path"
import type { Router } from "../router.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { Session } from "../../session/session.js"
import { defaultWorkspace } from "../../infra/workspace.js"
import {
  successResponse,
  errorResponse,
  requireAuth,
  errorToStructuredResponse,
} from "../middleware/index.js"

// 默认忽略的目录名
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "dist", "build", ".next", ".turbo",
  "__pycache__", ".pytest_cache", ".mypy_cache",
  ".venv", "venv", ".env",
  ".idea", ".vscode",
  "target",  // Rust
  "bin", "obj",  // .NET
])

// 最大文件读取大小 500KB
const MAX_FILE_SIZE = 500 * 1024

// ====================================================
// 根据扩展名推断语法高亮 language
// ====================================================

const EXT_LANG_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx",
  ".js": "javascript", ".jsx": "jsx", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java", ".kt": "kotlin", ".kts": "kotlin",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".lua": "lua",
  ".r": "r", ".jl": "julia",
  ".dart": "dart",
  ".ex": "elixir", ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".ml": "ocaml",
  ".zig": "zig",
  ".nim": "nim",
  ".json": "json", ".jsonc": "jsonc", ".jsonl": "json",
  ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml", ".svg": "xml",
  ".html": "html", ".htm": "html",
  ".css": "css", ".scss": "scss", ".less": "less",
  ".md": "markdown", ".mdx": "markdown",
  ".sql": "sql",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".ps1": "powershell",
  ".dockerfile": "dockerfile",
  ".env": "text",
  ".gitignore": "text",
  ".txt": "text",
}

function inferLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const name = basename(filePath).toLowerCase()
  if (name === "dockerfile") return "dockerfile"
  if (name === "makefile") return "makefile"
  return EXT_LANG_MAP[ext] ?? "text"
}

// -------------------------------------------------
// 数据结构
// -------------------------------------------------

interface DirEntry {
  name: string
  isDir: boolean
  size?: number
}

// -------------------------------------------------
// 辅助：catchAll error → 结构化错误响应
// -------------------------------------------------
function catchToErrorResponse(): (err: unknown) => Effect.Effect<Response> {
  return (err: unknown) => Effect.succeed(errorToStructuredResponse(err))
}

// -------------------------------------------------
// 辅助：解析 session workspace
// -------------------------------------------------
function resolveSessionWorkspace(
  sessionId: string,
  svc: any
): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const opt = yield* (svc.get(sessionId) as Effect.Effect<Option.Option<{ workspace: string }>, Error>)
    if (Option.isNone(opt)) {
      return defaultWorkspace()
    }
    return opt.value.workspace || defaultWorkspace()
  })
}

// -------------------------------------------------
// 注册路由
// -------------------------------------------------

export function registerFileRoutes(router: Router): void {

  // GET /api/files/list?path=<rel>&sessionId=<sid>
  // 列出目录内容
  router.get("/api/files/list", async (ctx): Promise<Response> => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult

    const relPath = (ctx.query.get("path") || "").replace(/\\/g, "/")
    const sessionId = ctx.query.get("sessionId") || ""

    // 安全检查：防止目录穿越
    if (relPath.includes("..")) {
      return errorResponse("非法路径", 400)
    }

    const result = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const workspace = yield* resolveSessionWorkspace(sessionId, svc)
        const absPath = resolve(workspace, relPath)

        let entries: DirEntry[] = []
        try {
          const names = readdirSync(absPath)
          entries = names
            .filter((n) => {
              // 隐藏文件（以 . 开头）也跳过，除了 .env 等少数
              if (n.startsWith(".")) {
                // 白名单
                const allowed = [".env", ".envrc", ".gitignore", ".npmrc", ".eslintrc", ".prettierrc"]
                return allowed.some((a) => n === a || n.startsWith(a + "."))
              }
              return true
            })
            .filter((n) => !IGNORED_DIRS.has(n))
            .map((n) => {
              const full = join(absPath, n)
              let isDir = false
              let fileSize: number | undefined
              try {
                const st = statSync(full)
                isDir = st.isDirectory()
                if (!isDir) fileSize = st.size
              } catch { /* stat 失败跳过 */ }
              const entry: DirEntry = { name: n, isDir }
              if (fileSize !== undefined) entry.size = fileSize
              return entry
            })
            .filter((e) => e.isDir || e.size !== undefined) // 排除无法 stat 的文件
            // 排序：文件夹在前，按名称
            .sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
              return a.name.localeCompare(b.name)
            })
        } catch {
          return errorResponse("目录不存在或不可读取", 404)
        }

        return successResponse({ entries, workspace, relPath })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      ) as Effect.Effect<Response>
    ) as Response
    return result
  })

  // GET /api/files/content?path=<rel>&sessionId=<sid>
  // 读取文件内容
  router.get("/api/files/content", async (ctx): Promise<Response> => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult

    const relPath = (ctx.query.get("path") || "").replace(/\\/g, "/")
    const sessionId = ctx.query.get("sessionId") || ""

    if (!relPath) {
      return errorResponse("缺少 path 参数", 400)
    }
    if (relPath.includes("..")) {
      return errorResponse("非法路径", 400)
    }

    const result = await AppRuntime.runPromise(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Effect.gen(function* () {
        const svc = yield* Session
        const workspace = yield* resolveSessionWorkspace(sessionId, svc)
        const absPath = resolve(workspace, relPath)

        let content: string
        let size: number
        try {
          const st = statSync(absPath)
          if (st.isDirectory()) {
            return errorResponse("不能读取目录内容", 400)
          }
          size = st.size
          if (size > MAX_FILE_SIZE) {
            return errorResponse("文件过大", 413)
          }
          content = readFileSync(absPath, "utf-8")
        } catch {
          return errorResponse("文件不存在或不可读取", 404)
        }

        const language = inferLanguage(absPath)
        return successResponse({ content, language, size, path: relPath })
      }) as any).pipe(
        Effect.catchAll(catchToErrorResponse())
      ) as Effect.Effect<Response>
    ) as Response
    return result
  })
}
