// src/server/handlers/tools-management.ts
// ====================================================
// 工具可视化管理 API — 列出/重载/添加/删除用户工具
// ====================================================

import type { Router } from "../router.js"
import { jsonResponse, errorResponse, parseJsonBody, requireAuth } from "../middleware.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { ToolRegistry } from "../../tool/index.js"
import { ToolLoader, userToolToDefinition } from "../../tool/loader.js"
import { BUILTIN_TOOL_IMPLS } from "../../tool/builtin/index.js"
import * as fs from "fs/promises"
import * as path from "path"
import { Effect } from "effect"
import { logger } from "../../infra/logger.js"

// -------------------------------------------------
// 类型
// -------------------------------------------------

interface ToolInfo {
  name: string
  source: "builtin" | "user" | "remote"
  category?: string
  description?: string
  loaded: boolean
  error?: string
  /** TOOL.md 所在的工具目录路径 */
  toolDir: string
}

interface ToolReloadResult {
  total: number
  builtin: number
  user: number
  remote: number
  errors: Array<{ name: string; source: string; error: string }>
}

// -------------------------------------------------
// 辅助：扫描 + 解析 TOOL.md
// -------------------------------------------------

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/

function parseYamlLine(rawLine: string): { key: string; value: string; indent: number } | null {
  const trimmed = rawLine.trimEnd()
  if (trimmed.trim() === "" || trimmed.trim().startsWith("#")) return null
  const colonIdx = trimmed.indexOf(":")
  if (colonIdx === -1) return null
  return {
    key: trimmed.slice(0, colonIdx).trim(),
    value: trimmed.slice(colonIdx + 1).trim(),
    indent: rawLine.length - rawLine.trimStart().length,
  }
}

function parseSimpleFrontmatter(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  let currentPath: string[] = []
  for (const rawLine of raw.split("\n")) {
    const parsed = parseYamlLine(rawLine)
    if (!parsed) continue
    const level = Math.floor(parsed.indent / 2)
    if (parsed.value === "") {
      currentPath = currentPath.slice(0, level)
      currentPath.push(parsed.key)
    } else {
      const fullPath = [...currentPath.slice(0, level), parsed.key]
      let current = root
      for (let i = 0; i < fullPath.length - 1; i++) {
        const p = fullPath[i]!
        if (!(p in current)) current[p] = {}
        current = current[p] as Record<string, unknown>
      }
      current[fullPath[fullPath.length - 1]!] = parsed.value
    }
  }
  return root
}

async function scanToolDirs(baseDir: string): Promise<string[]> {
  const result: string[] = []
  const walk = async (dir: string): Promise<void> => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const subdirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))
      // 检查当前目录是否直接包含 TOOL.md
      try {
        await fs.access(path.join(dir, "TOOL.md"))
        result.push(dir)
      } catch {
        for (const sub of subdirs) {
          await walk(sub)
        }
      }
    } catch { /* 目录不存在则跳过 */ }
  }
  await walk(baseDir)
  return result
}

async function getToolInfo(toolDir: string, source: ToolInfo["source"]): Promise<ToolInfo> {
  const name = path.basename(toolDir)
  const mdPath = path.join(toolDir, "TOOL.md")
  try {
    const rawContent = await fs.readFile(mdPath, "utf-8")
    const match = FRONTMATTER_RE.exec(rawContent)
    if (!match) {
      return { name, source, loaded: false, error: "缺少 YAML frontmatter (--- ... ---)", toolDir }
    }
    const frontmatter = parseSimpleFrontmatter(match[1]!)
    const fmName = frontmatter["name"]
    const category = frontmatter["category"] ? String(frontmatter["category"]) : undefined
    const description = frontmatter["description"] ? String(frontmatter["description"]) : undefined
    return {
      name: fmName ? String(fmName) : name,
      source,
      category,
      description,
      loaded: true,
      toolDir,
    }
  } catch (err) {
    return { name, source, loaded: false, error: String(err), toolDir }
  }
}

// -------------------------------------------------
// 注册路由
// -------------------------------------------------

export function registerToolsManagementRoutes(router: Router): void {

  // ==================== GET /api/tools ====================
  router.get("/api/tools", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    try {
      const workspaceRoot = process.cwd()
      const toolsDir = path.join(workspaceRoot, "tools")
      const SOURCES: Array<{ source: ToolInfo["source"]; subdir: string }> = [
        { source: "builtin", subdir: "builtin" },
        { source: "user", subdir: "user" },
        { source: "remote", subdir: "remote" },
      ]

      const all: ToolInfo[] = []
      for (const { source, subdir } of SOURCES) {
        const srcDir = path.join(toolsDir, subdir)
        const toolDirs = await scanToolDirs(srcDir)
        for (const td of toolDirs) {
          all.push(await getToolInfo(td, source))
        }
      }

      return jsonResponse({ success: true, data: all })
    } catch (err) {
      return errorResponse(`获取工具列表失败: ${String(err)}`, 500)
    }
  })

  // ==================== POST /api/tools/reload ====================
  router.post("/api/tools/reload", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    try {
      const workspaceRoot = process.cwd()

      const result: ToolReloadResult = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry
          const loader = yield* ToolLoader

          // 清空并重新加载
          yield* registry.clear()
          const tools = yield* loader.loadAll(workspaceRoot)

          const errors: ToolReloadResult["errors"] = []
          let builtinCount = 0, userCount = 0, remoteCount = 0

          for (const userDef of tools) {
            try {
              const toolDef = userToolToDefinition(userDef, BUILTIN_TOOL_IMPLS)
              if (!toolDef) continue
              yield* registry.register(toolDef)
              if (userDef.source === "builtin") builtinCount++
              else if (userDef.source === "user") userCount++
              else if (userDef.source === "remote") remoteCount++
            } catch (err) {
              errors.push({
                name: userDef.name,
                source: userDef.source,
                error: String(err),
              })
              logger.warn(`工具重载跳过 "${userDef.name}": ${String(err)}`)
            }
          }

          return { total: builtinCount + userCount + remoteCount, builtin: builtinCount, user: userCount, remote: remoteCount, errors }
        })
      )

      logger.info(`工具重载完成: ${result.total} 个 (builtin: ${result.builtin}, user: ${result.user}, remote: ${result.remote})`)
      return jsonResponse({ success: true, data: result })
    } catch (err) {
      return errorResponse(`重载工具失败: ${String(err)}`, 500)
    }
  })

  // ==================== POST /api/tools/user ====================
  router.post("/api/tools/user", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    try {
      const body = await parseJsonBody<{ sourcePath: string }>(ctx.request)
      if (!body.sourcePath || body.sourcePath.trim().length === 0) {
        return errorResponse("sourcePath 不能为空", 400)
      }

      const sourcePath = body.sourcePath.trim()

      // 验证源路径存在
      try {
        const stat = await fs.stat(sourcePath)
        if (!stat.isDirectory()) {
          return errorResponse("sourcePath 必须是一个目录", 400)
        }
      } catch {
        return errorResponse(`源路径不存在: ${sourcePath}`, 400)
      }

      // 获取工具名称（目录名）
      const toolName = path.basename(sourcePath)
      const workspaceRoot = process.cwd()
      const destDir = path.join(workspaceRoot, "tools", "user", toolName)

      // 检查目标是否已存在
      try {
        await fs.access(destDir)
        return errorResponse(`工具 "${toolName}" 已存在`, 409)
      } catch { /* 不存在，可以继续 */ }

      // 递归复制
      await copyDir(sourcePath, destDir)

      // 重新加载工具
      const reloadResult: ToolReloadResult = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry
          const loader = yield* ToolLoader

          yield* registry.clear()
          const tools = yield* loader.loadAll(workspaceRoot)

          const errors: ToolReloadResult["errors"] = []
          let builtinCount = 0, userCount = 0, remoteCount = 0

          for (const userDef of tools) {
            try {
              const toolDef = userToolToDefinition(userDef, BUILTIN_TOOL_IMPLS)
              if (!toolDef) continue
              yield* registry.register(toolDef)
              if (userDef.source === "builtin") builtinCount++
              else if (userDef.source === "user") userCount++
              else if (userDef.source === "remote") remoteCount++
            } catch (err) {
              errors.push({ name: userDef.name, source: userDef.source, error: String(err) })
            }
          }

          return { total: builtinCount + userCount + remoteCount, builtin: builtinCount, user: userCount, remote: remoteCount, errors }
        })
      )

      return jsonResponse({
        success: true,
        data: { name: toolName, destDir, reloadResult },
        message: `工具 "${toolName}" 已添加`,
      }, 201)
    } catch (err) {
      return errorResponse(`添加工具失败: ${String(err)}`, 500)
    }
  })

  // ==================== DELETE /api/tools/user/:name ====================
  router.delete("/api/tools/user/:name", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    try {
      const toolName = ctx.params["name"]
      if (!toolName) return errorResponse("缺少工具名称", 400)

      const workspaceRoot = process.cwd()
      const userToolDir = path.join(workspaceRoot, "tools", "user", toolName)

      // 检查目录是否存在
      try {
        await fs.access(userToolDir)
      } catch {
        return errorResponse(`工具 "${toolName}" 不存在`, 404)
      }

      // 删除目录
      await fs.rm(userToolDir, { recursive: true, force: true })

      // 重新加载
      const reloadResult: ToolReloadResult = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry
          const loader = yield* ToolLoader

          yield* registry.clear()
          const tools = yield* loader.loadAll(workspaceRoot)

          const errors: ToolReloadResult["errors"] = []
          let builtinCount = 0, userCount = 0, remoteCount = 0

          for (const userDef of tools) {
            try {
              const toolDef = userToolToDefinition(userDef, BUILTIN_TOOL_IMPLS)
              if (!toolDef) continue
              yield* registry.register(toolDef)
              if (userDef.source === "builtin") builtinCount++
              else if (userDef.source === "user") userCount++
              else if (userDef.source === "remote") remoteCount++
            } catch (err) {
              errors.push({ name: userDef.name, source: userDef.source, error: String(err) })
            }
          }

          return { total: builtinCount + userCount + remoteCount, builtin: builtinCount, user: userCount, remote: remoteCount, errors }
        })
      )

      return jsonResponse({
        success: true,
        data: { name: toolName, reloadResult },
        message: `工具 "${toolName}" 已删除`,
      })
    } catch (err) {
      return errorResponse(`删除工具失败: ${String(err)}`, 500)
    }
  })
}

// -------------------------------------------------
// 辅助：递归复制目录
// -------------------------------------------------

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}
