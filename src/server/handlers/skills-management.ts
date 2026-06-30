// src/server/handlers/skills-management.ts
// ====================================================
// Skill 可视化管理 API — 列出/重载/添加/删除用户 Skill
// ====================================================

import type { Router } from "../router.js"
import { jsonResponse, errorResponse, parseJsonBody, requireAuth } from "../middleware.js"
import { AppRuntime } from "../../effect/app-runtime.js"
import { SkillRegistry, SkillSystem } from "../../skill/index.js"
import { logger } from "../../infra/logger.js"
import * as fs from "fs/promises"
import * as path from "path"
import { Effect } from "effect"

// -------------------------------------------------
// 类型
// -------------------------------------------------

interface SkillInfo {
  name: string
  source: "builtin" | "user" | "remote"
  category?: string
  description?: string
  loaded: boolean
  error?: string
  /** SKILL.md 所在的目录路径 */
  skillDir: string
}

interface SkillReloadResult {
  total: number
  builtin: number
  user: number
  remote: number
  errors: Array<{ name: string; source: string; error: string }>
}

// -------------------------------------------------
// 辅助：扫描 + 解析 SKILL.md
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

async function scanSkillDirs(baseDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true })
    const subdirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(baseDir, e.name))
    // 检查当前目录下的每个子目录是否包含 SKILL.md
    const result: string[] = []
    for (const sub of subdirs) {
      try {
        await fs.access(path.join(sub, "SKILL.md"))
        result.push(sub)
      } catch { /* 没有 SKILL.md，跳过 */ }
    }
    return result
  } catch {
    return []
  }
}

async function getSkillInfo(skillDir: string, source: SkillInfo["source"]): Promise<SkillInfo> {
  const name = path.basename(skillDir)
  const mdPath = path.join(skillDir, "SKILL.md")
  try {
    const rawContent = await fs.readFile(mdPath, "utf-8")
    const match = FRONTMATTER_RE.exec(rawContent)
    if (!match) {
      return { name, source, loaded: false, error: "缺少 YAML frontmatter (--- ... ---)", skillDir }
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
      skillDir,
    }
  } catch (err) {
    return { name, source, loaded: false, error: String(err), skillDir }
  }
}

// -------------------------------------------------
// 注册路由
// -------------------------------------------------

export function registerSkillsManagementRoutes(router: Router): void {

  // ==================== GET /api/skills ====================
  router.get("/api/skills", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    try {
      const workspaceRoot = process.cwd()
      const skillsDir = path.join(workspaceRoot, "skills")
      const SOURCES: Array<{ source: SkillInfo["source"]; subdir: string }> = [
        { source: "builtin", subdir: "builtin" },
        { source: "user", subdir: "user" },
        { source: "remote", subdir: "remote" },
      ]

      const all: SkillInfo[] = []
      for (const { source, subdir } of SOURCES) {
        const srcDir = path.join(skillsDir, subdir)
        const skillDirs = await scanSkillDirs(srcDir)
        for (const sd of skillDirs) {
          all.push(await getSkillInfo(sd, source))
        }
      }

      return jsonResponse({ success: true, data: all })
    } catch (err) {
      return errorResponse(`获取 Skill 列表失败: ${String(err)}`, 500)
    }
  })

  // ==================== POST /api/skills/reload ====================
  router.post("/api/skills/reload", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    try {
      const workspaceRoot = process.cwd()

      const count: number = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const system = yield* SkillSystem
          const registry = yield* SkillRegistry

          // 清空并重新加载
          yield* registry.clear()
          const n = yield* system.reload(workspaceRoot)
          return n
        })
      )

      return jsonResponse({ success: true, data: { total: count } })
    } catch (err) {
      return errorResponse(`重载 Skill 失败: ${String(err)}`, 500)
    }
  })

  // ==================== POST /api/skills/user ====================
  router.post("/api/skills/user", async (ctx) => {
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

      const skillName = path.basename(sourcePath)
      const workspaceRoot = process.cwd()
      const destDir = path.join(workspaceRoot, "skills", "user", skillName)

      // 检查目标是否已存在
      try {
        await fs.access(destDir)
        return errorResponse(`Skill "${skillName}" 已存在`, 409)
      } catch { /* 不存在 */ }

      // 递归复制
      await copyDir(sourcePath, destDir)

      // 重新加载
      const count: number = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const system = yield* SkillSystem
          const registry = yield* SkillRegistry
          yield* registry.clear()
          const n = yield* system.reload(workspaceRoot)
          return n
        })
      )

      return jsonResponse({
        success: true,
        data: { name: skillName, destDir, total: count },
        message: `Skill "${skillName}" 已添加`,
      }, 201)
    } catch (err) {
      return errorResponse(`添加 Skill 失败: ${String(err)}`, 500)
    }
  })

  // ==================== DELETE /api/skills/user/:name ====================
  router.delete("/api/skills/user/:name", async (ctx) => {
    const authResult = requireAuth(ctx)
    if (authResult instanceof Response) return authResult
    try {
      const skillName = ctx.params["name"]
      if (!skillName) return errorResponse("缺少 Skill 名称", 400)

      const workspaceRoot = process.cwd()
      const userSkillDir = path.join(workspaceRoot, "skills", "user", skillName)

      try {
        await fs.access(userSkillDir)
      } catch {
        return errorResponse(`Skill "${skillName}" 不存在`, 404)
      }

      await fs.rm(userSkillDir, { recursive: true, force: true })

      const count: number = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const system = yield* SkillSystem
          const registry = yield* SkillRegistry
          yield* registry.clear()
          const n = yield* system.reload(workspaceRoot)
          return n
        })
      )

      return jsonResponse({
        success: true,
        data: { name: skillName, total: count },
        message: `Skill "${skillName}" 已删除`,
      })
    } catch (err) {
      return errorResponse(`删除 Skill 失败: ${String(err)}`, 500)
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
