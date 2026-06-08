// src/skill/loader.ts
import { Context, Effect, Layer } from "effect"
import * as fs from "fs/promises"
import * as path from "path"
import type {
  SkillDefinition,
  SkillFrontmatter,
  SkillSource,
  SkillType,
} from "./types.js"
import { SkillLoadError, SkillParseError, SKILL_SOURCE_DIRS } from "./types.js"

// ====================================================
// Frontmatter 解析器
// ====================================================

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/

/**
 * 解析 YAML frontmatter（行级简单解析，支持嵌套对象和数组）
 */
function parseFrontmatter(raw: string, mdPath: string): SkillFrontmatter {
  const lines = raw.split("\n")
  const root: Record<string, unknown> = {}
  let currentPath: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === "" || line.trim().startsWith("#")) continue

    const indent = rawLine.length - rawLine.trimStart().length
    const trimmed = line.trim()

    // 计算当前深度级别
    const level = Math.floor(indent / 2)

    // 找到 key: value 分隔位置
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()

    if (value === "") {
      // 嵌套对象的开始
      currentPath = currentPath.slice(0, level)
      currentPath.push(key)
    } else {
      // 叶子值
      const path = [...currentPath.slice(0, level), key]
      setNested(root, path, parseYamlValue(value))
    }
  }

  return validateFrontmatter(root, mdPath)
}

function setNested(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i]!
    if (!(p in current)) current[p] = {}
    current = current[p] as Record<string, unknown>
  }
  const last = path[path.length - 1]!
  current[last] = value
}

function parseYamlValue(raw: string): unknown {
  // 布尔值
  if (raw === "true" || raw === "True") return true
  if (raw === "false" || raw === "False") return false

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)

  // 数组: [item1, item2, ...]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim()
    if (inner === "") return []
    return inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
  }

  // 引号字符串
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1)
  }

  return raw
}

function validateFrontmatter(
  parsed: Record<string, unknown>,
  mdPath: string,
): SkillFrontmatter {
  const name = parsed["name"]
  const description = parsed["description"]

  if (!name || typeof name !== "string") {
    throw new SkillParseError({
      path: mdPath,
      reason: '缺少必填字段 "name"',
    })
  }

  if (!description || typeof description !== "string") {
    throw new SkillParseError({
      path: mdPath,
      reason: '缺少必填字段 "description"',
    })
  }

  const version = typeof parsed["version"] === "string" ? parsed["version"] : "0.0.0"
  const author = typeof parsed["author"] === "string" ? parsed["author"] : "unknown"
  const category = typeof parsed["category"] === "string" ? parsed["category"] : "general"

  let tags: string[]
  if (Array.isArray(parsed["tags"])) {
    tags = parsed["tags"].map(String)
  } else if (typeof parsed["tags"] === "string") {
    tags = [parsed["tags"]]
  } else {
    tags = []
  }

  const base = { name, version, description, author, tags, category }

  if (parsed["execution"] && typeof parsed["execution"] === "object") {
    const exec = parsed["execution"] as Record<string, unknown>
    const execution: SkillFrontmatter["execution"] = {
      type: "script",
      entry: String(exec["entry"] ?? ""),
      timeout: typeof exec["timeout"] === "number" ? exec["timeout"] : 60000,
      requireConfirm: exec["requireConfirm"] === true,
      ...(exec["interpreter"] ? { interpreter: String(exec["interpreter"]) } : {}),
    }
    return { ...base, execution }
  }

  return base
}

// ====================================================
// SKILL.md 解析
// ====================================================

function parseSkillMd(
  rawContent: string,
  mdPath: string,
  skillDir: string,
  source: SkillSource,
  mtime: Date,
): SkillDefinition {
  // 提取 frontmatter
  const match = rawContent.match(FRONTMATTER_RE)
  if (!match) {
    throw new SkillParseError({
      path: mdPath,
      reason: "未找到 YAML frontmatter（缺少 --- 分隔符）",
    })
  }

  const fmRaw = match[1]!
  const content = rawContent.slice(match[0].length).trim()
  const frontmatter = parseFrontmatter(fmRaw, mdPath)

  // 判断类型：有 entry 则为混合型，否则纯文档型
  const type: SkillType = frontmatter.execution?.entry ? "hybrid" : "document"

  return {
    name: frontmatter.name,
    version: frontmatter.version,
    description: frontmatter.description,
    author: frontmatter.author,
    tags: frontmatter.tags,
    category: frontmatter.category,
    type,
    source,
    skillDir,
    mdPath,
    content,
    frontmatter,
    mtime,
  }
}

// ====================================================
// SkillLoader 服务
// ====================================================

export interface SkillLoaderService {
  /** 扫描并加载所有 Skill */
  readonly loadAll: (
    workspaceRoot: string,
  ) => Effect.Effect<SkillDefinition[], SkillLoadError | SkillParseError>

  /** 重新加载指定 source 的 Skill */
  readonly reloadSource: (
    workspaceRoot: string,
    source: SkillSource,
  ) => Effect.Effect<SkillDefinition[], SkillLoadError | SkillParseError>
}

export class SkillLoader extends Context.Tag("SkillLoader")<
  SkillLoader,
  SkillLoaderService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const SkillLoaderLive = Layer.sync(SkillLoader, () => {
  const scanDirectory = async (
    dirPath: string,
  ): Promise<string[]> => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dirPath, e.name))
    } catch {
      return [] // 目录不存在则返回空
    }
  }

  const findSkillMd = async (
    skillDir: string,
  ): Promise<string | null> => {
    const mdPath = path.join(skillDir, "SKILL.md")
    try {
      await fs.access(mdPath)
      return mdPath
    } catch {
      return null
    }
  }

  const loadSkillDir = async (
    skillDir: string,
    source: SkillSource,
  ): Promise<SkillDefinition | null> => {
    const mdPath = await findSkillMd(skillDir)
    if (!mdPath) return null

    try {
      const rawContent = await fs.readFile(mdPath, "utf-8")
      const stat = await fs.stat(mdPath)
      return parseSkillMd(rawContent, mdPath, skillDir, source, stat.mtime)
    } catch (err) {
      if (err instanceof SkillParseError) {
        console.warn(`⚠  跳过无效 Skill: ${err.reason} (${err.path})`)
        return null
      }
      throw err
    }
  }

  const loadAll = (workspaceRoot: string) =>
    Effect.gen(function* () {
      const skillsDir = path.join(workspaceRoot, "skills")
      const results: SkillDefinition[] = []

      for (const [source, subDir] of Object.entries(SKILL_SOURCE_DIRS) as [
        SkillSource,
        string,
      ][]) {
        const srcDir = path.join(skillsDir, subDir)
        const skillDirs = yield* Effect.tryPromise({
          try: () => scanDirectory(srcDir),
          catch: (err) =>
            new SkillLoadError({
              path: srcDir,
              reason: `扫描目录失败: ${String(err)}`,
            }),
        })

        for (const skillDir of skillDirs) {
          const def = yield* Effect.tryPromise({
            try: () => loadSkillDir(skillDir, source),
            catch: (err) =>
              new SkillLoadError({
                path: skillDir,
                reason: `加载失败: ${String(err)}`,
              }),
          })

          if (def) results.push(def)
        }
      }

      return results
    })

  const reloadSource = (workspaceRoot: string, source: SkillSource) =>
    Effect.gen(function* () {
      const skillsDir = path.join(workspaceRoot, "skills")
      const subDir = SKILL_SOURCE_DIRS[source]
      const srcDir = path.join(skillsDir, subDir)
      const results: SkillDefinition[] = []

      const skillDirs = yield* Effect.tryPromise({
        try: () => scanDirectory(srcDir),
        catch: (err) =>
          new SkillLoadError({
            path: srcDir,
            reason: `扫描目录失败: ${String(err)}`,
          }),
      })

      for (const skillDir of skillDirs) {
        const def = yield* Effect.tryPromise({
          try: () => loadSkillDir(skillDir, source),
          catch: (err) =>
            new SkillLoadError({
              path: skillDir,
              reason: `加载失败: ${String(err)}`,
            }),
        })

        if (def) results.push(def)
      }

      return results
    })

  return { loadAll, reloadSource }
})
