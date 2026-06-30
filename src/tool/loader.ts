// src/tool/loader.ts
// ToolLoader — 扫描 tools/{user,remote}/ 目录，解析 TOOL.md 并生成 ToolDefinition
import { Context, Effect, Layer } from "effect"
import * as fs from "fs/promises"
import * as path from "path"
import { Schema } from "effect"
import type {
  ToolDefinition,
  ToolCategory,
  SensitivityLevel,
  UserToolDefinition,
  UserToolFrontmatter,
  ToolExecutionConfig,
  ToolParameterDef,
  ToolSource,
} from "./types.js"
import {
  ToolLoadError,
  ToolParseError,
  TOOLS_DIR,
  TOOL_SOURCE_DIRS,
} from "./types.js"
import type { Action } from "../permission/types.js"
import { resolvePython, ensureRequirements } from "../infra/python-env.js"
import { logger } from "../infra/logger.js"

// ====================================================
// 解释器推断（非 Python 语言使用静态映射，Python 运行时动态解析）
// ====================================================

const EXT_INTERPRETER: Record<string, string> = {
  ".ts": "bun run",
  ".js": "bun run",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "zsh",
  ".rb": "ruby",
  ".lua": "lua",
}

function inferInterpreter(entry: string, specified?: string): string | null {
  if (specified) return specified
  const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase()
  return EXT_INTERPRETER[ext] ?? null
}

function isPythonEntry(entry: string): boolean {
  const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase()
  return ext === ".py"
}

// ====================================================
// TOOL.md Frontmatter 解析
// ====================================================

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/

/** 将 YAML 参数定义转换为 JSON Schema */
export function paramsToJSONSchema(params: Record<string, ToolParameterDef>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [name, def] of Object.entries(params)) {
    const prop: Record<string, unknown> = {
      type: def.type,
      description: def.description,
    }
    if (def.enum) prop.enum = def.enum
    if (def.items) prop.items = def.items
    if (def.default !== undefined) prop.default = def.default
    properties[name] = prop
    if (def.required) required.push(name)
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }
}

/** 简单 YAML 值解析 */
function parseYamlValue(raw: string): unknown {
  if (raw === "true" || raw === "True") return true
  if (raw === "false" || raw === "False") return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim()
    if (inner === "") return []
    return inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
  }
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1)
  }
  return raw
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

/** 解析 YAML frontmatter 文本为结构化对象 */
function parseYamlFrontmatter(raw: string): Record<string, unknown> {
  const lines = raw.split("\n")
  const root: Record<string, unknown> = {}
  let currentPath: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === "" || line.trim().startsWith("#")) continue

    const indent = rawLine.length - rawLine.trimStart().length
    const trimmed = line.trim()
    const level = Math.floor(indent / 2)

    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()

    if (value === "") {
      currentPath = currentPath.slice(0, level)
      currentPath.push(key)
    } else {
      const fullPath = [...currentPath.slice(0, level), key]
      setNested(root, fullPath, parseYamlValue(value))
    }
  }

  return root
}

/** 从 YAML parsed 对象提取 ToolParameterDef */
function parseParameters(raw: unknown): Record<string, ToolParameterDef> {
  if (!raw || typeof raw !== "object") return {}
  const result: Record<string, ToolParameterDef> = {}
  const params = raw as Record<string, unknown>

  for (const [name, rawDef] of Object.entries(params)) {
    if (!rawDef || typeof rawDef !== "object") continue
    const d = rawDef as Record<string, unknown>

    const type = String(d["type"] ?? "string")
    if (!["string", "number", "integer", "boolean", "array", "object"].includes(type)) continue

    result[name] = {
      type: type as ToolParameterDef["type"],
      description: String(d["description"] ?? `Parameter "${name}"`),
      required: d["required"] === true,
      ...(d["default"] !== undefined ? { default: d["default"] } : {}),
      ...(d["enum"] && Array.isArray(d["enum"]) ? { enum: d["enum"].map(String) } : {}),
      ...(d["items"] && typeof d["items"] === "object"
        ? { items: { type: String((d["items"] as Record<string, unknown>)["type"] ?? "string") } }
        : {}),
    }
  }

  return result
}

/** 从 YAML parsed 对象提取 ToolExecutionConfig */
function parseExecution(raw: unknown): ToolExecutionConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("execution 配置缺失或格式错误")
  }
  const e = raw as Record<string, unknown>

  const execType = String(e["type"] ?? "script")
  if (execType !== "script" && execType !== "internal") {
    throw new Error(`无效的 execution.type "${execType}"，可选: script, internal`)
  }

  if (execType === "internal") {
    const impl = e["impl"]
    if (!impl || typeof impl !== "string" || impl.trim() === "") {
      throw new Error("execution.type=internal 时，execution.impl 是必填字段")
    }
    return {
      type: "internal",
      entry: "", // internal 类型不需要 entry
      timeout: typeof e["timeout"] === "number" ? e["timeout"] : 30000,
      requireConfirm: e["requireConfirm"] === true,
      impl: impl.trim(),
    }
  }

  // type === "script"
  const entry = e["entry"]
  if (!entry || typeof entry !== "string" || entry.trim() === "") {
    throw new Error("execution.entry 是必填字段")
  }

  return {
    type: "script",
    entry: entry.trim(),
    timeout: typeof e["timeout"] === "number" ? e["timeout"] : 30000,
    requireConfirm: e["requireConfirm"] === true,
    ...(e["interpreter"] ? { interpreter: String(e["interpreter"]) } : {}),
  }
}

/** 验证并构造 UserToolFrontmatter */
function validateFrontmatter(parsed: Record<string, unknown>, mdPath: string): UserToolFrontmatter {
  const name = parsed["name"]
  if (!name || typeof name !== "string") {
    throw new ToolParseError({ path: mdPath, reason: '缺少必填字段 "name"' })
  }

  const description = parsed["description"]
  if (!description || typeof description !== "string") {
    throw new ToolParseError({ path: mdPath, reason: '缺少必填字段 "description"' })
  }

  const category = String(parsed["category"] ?? "command")
  if (!["file", "command", "search", "reasoning"].includes(category)) {
    throw new ToolParseError({
      path: mdPath,
      reason: `无效的 category "${category}"，可选: file, command, search, reasoning`,
    })
  }

  const permission = String(parsed["permission"] ?? "read")
  if (!["read", "write", "execute"].includes(permission)) {
    throw new ToolParseError({
      path: mdPath,
      reason: `无效的 permission "${permission}"，可选: read, write, execute`,
    })
  }

  const sensitivity = String(parsed["sensitivity"] ?? "medium")
  if (!["low", "medium", "high", "critical"].includes(sensitivity)) {
    throw new ToolParseError({
      path: mdPath,
      reason: `无效的 sensitivity "${sensitivity}"，可选: low, medium, high, critical`,
    })
  }

  const sideEffect = String(parsed["sideEffect"] ?? "read")
  if (sideEffect !== "read" && sideEffect !== "write") {
    throw new ToolParseError({
      path: mdPath,
      reason: `无效的 sideEffect "${sideEffect}"，可选: read, write`,
    })
  }

  const version = typeof parsed["version"] === "string" ? parsed["version"] : "0.0.0"
  const author = typeof parsed["author"] === "string" ? parsed["author"] : "unknown"

  let tags: string[]
  if (Array.isArray(parsed["tags"])) {
    tags = parsed["tags"].map(String)
  } else if (typeof parsed["tags"] === "string") {
    tags = [parsed["tags"]]
  } else {
    tags = []
  }

  let execution: ToolExecutionConfig
  try {
    execution = parseExecution(parsed["execution"])
  } catch (err) {
    throw new ToolParseError({ path: mdPath, reason: String(err) })
  }

  const parameters = parseParameters(parsed["parameters"])

  return {
    name,
    version,
    description,
    author,
    tags,
    category: category as ToolCategory,
    permission: permission as Action,
    sensitivity: sensitivity as SensitivityLevel,
    sideEffect: sideEffect as "read" | "write",
    safeToRetry: parsed["safeToRetry"] !== false,
    defaultEnabled: parsed["defaultEnabled"] !== false,
    execution,
    parameters,
  }
}

// ====================================================
// TOOL.md 完整解析
// ====================================================

function parseToolMd(
  rawContent: string,
  mdPath: string,
  toolDir: string,
  source: ToolSource,
  mtime: Date,
): UserToolDefinition {
  const match = rawContent.match(FRONTMATTER_RE)
  if (!match) {
    throw new ToolParseError({
      path: mdPath,
      reason: "未找到 YAML frontmatter（缺少 --- 分隔符）",
    })
  }

  const fmRaw = match[1]!
  const body = rawContent.slice(match[0].length).trim()
  const parsed = parseYamlFrontmatter(fmRaw)
  const frontmatter = validateFrontmatter(parsed, mdPath)

  return {
    name: frontmatter.name,
    version: frontmatter.version,
    description: frontmatter.description,
    author: frontmatter.author,
    tags: frontmatter.tags,
    toolDir,
    mdPath,
    body,
    frontmatter,
    mtime,
    source,
  }
}

// ====================================================
// ToolLoader 服务接口
// ====================================================

export interface ToolLoaderService {
  /** 扫描并加载所有用户/远程工具 */
  readonly loadAll: (
    workspaceRoot: string,
  ) => Effect.Effect<UserToolDefinition[], ToolLoadError | ToolParseError>

  /** 重新加载指定来源的工具 */
  readonly reloadSource: (
    workspaceRoot: string,
    source: ToolSource,
  ) => Effect.Effect<UserToolDefinition[], ToolLoadError | ToolParseError>
}

export class ToolLoader extends Context.Tag("ToolLoader")<
  ToolLoader,
  ToolLoaderService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const ToolLoaderLive = Layer.sync(ToolLoader, () => {
  /** 递归扫描目录，收集所有含有 TOOL.md 的子目录 */
  const scanDirectory = async (dirPath: string): Promise<string[]> => {
    const result: string[] = []
    const walk = async (current: string): Promise<void> => {
      try {
        const entries = await fs.readdir(current, { withFileTypes: true })
        const subdirs: string[] = []
        for (const e of entries) {
          if (e.isDirectory()) {
            subdirs.push(path.join(current, e.name))
          }
        }
        // 检查当前目录是否直接包含 TOOL.md
        const mdPath = path.join(current, "TOOL.md")
        try {
          await fs.access(mdPath)
          result.push(current)
        } catch {
          // 当前目录没有 TOOL.md → 递归进入子目录
          for (const sub of subdirs) {
            await walk(sub)
          }
        }
      } catch {
        // fs.readdir 失败，静默跳过
      }
    }
    await walk(dirPath)
    return result
  }

  const loadToolDir = async (
    toolDir: string,
    source: ToolSource,
  ): Promise<UserToolDefinition | null> => {
    // scanDirectory 已保证 TOOL.md 存在，直接读取
    const mdPath = path.join(toolDir, "TOOL.md")
    try {
      const rawContent = await fs.readFile(mdPath, "utf-8")
      const stat = await fs.stat(mdPath)
      return parseToolMd(rawContent, mdPath, toolDir, source, stat.mtime)
    } catch (err) {
      if (err instanceof ToolParseError) {
        logger.warn(`跳过无效工具: ${err.reason} (${err.path})`)
        return null
      }
      throw err
    }
  }

  const loadAll = (workspaceRoot: string) =>
    Effect.gen(function* () {
      const toolsDir = path.join(workspaceRoot, TOOLS_DIR)
      const results: UserToolDefinition[] = []

      // 扫描 builtin、user、remote 三个来源
      const sources: ToolSource[] = ["builtin", "user", "remote"]
      for (const source of sources) {
        const subDir = TOOL_SOURCE_DIRS[source]
        const srcDir = path.join(toolsDir, subDir)
        const toolDirs = yield* Effect.tryPromise({
          try: () => scanDirectory(srcDir),
          catch: (err) =>
            new ToolLoadError({
              path: srcDir,
              reason: `扫描目录失败: ${String(err)}`,
            }),
        })

        for (const toolDir of toolDirs) {
          const def = yield* Effect.tryPromise({
            try: () => loadToolDir(toolDir, source),
            catch: (err) =>
              new ToolLoadError({
                path: toolDir,
                reason: `加载失败: ${String(err)}`,
              }),
          })

          if (def) results.push(def)
        }
      }

      return results
    })

  const reloadSource = (workspaceRoot: string, source: ToolSource) =>
    Effect.gen(function* () {
      const toolsDir = path.join(workspaceRoot, TOOLS_DIR)
      const subDir = TOOL_SOURCE_DIRS[source]
      const srcDir = path.join(toolsDir, subDir)
      const toolDirs = yield* Effect.tryPromise({
        try: () => scanDirectory(srcDir),
        catch: (err) =>
          new ToolLoadError({
            path: srcDir,
            reason: `扫描目录失败: ${String(err)}`,
          }),
      })

      const results: UserToolDefinition[] = []
      for (const toolDir of toolDirs) {
        const def = yield* Effect.tryPromise({
          try: () => loadToolDir(toolDir, source),
          catch: (err) =>
            new ToolLoadError({
              path: toolDir,
              reason: `加载失败: ${String(err)}`,
            }),
        })
        if (def) results.push(def)
      }

      return results
    })

  return { loadAll, reloadSource }
})

// ====================================================
// UserToolDefinition → ToolDefinition 转换
// ====================================================

/**
 * 将 UserToolDefinition 转换为可注册的 ToolDefinition。
 * - type="internal"：从 builtinImpls 映射表中查找 TS 实现
 * - type="script"：通过子进程运行 entry 脚本，stdin 传入 JSON，stdout 作为返回值
 */
export function userToolToDefinition(
  def: UserToolDefinition,
  builtinImpls?: ReadonlyMap<string, ToolDefinition>,
): ToolDefinition | null {
  const exec = def.frontmatter.execution

  // internal 类型：直接从 TS 实现表返回
  if (exec.type === "internal") {
    const implKey = exec.impl ?? def.name
    const impl = builtinImpls?.get(implKey)
    if (!impl) {
      logger.warn(`内置工具 "${def.name}" 的实现 "${implKey}" 未找到`)
      return null
    }
    return impl
  }

  // script 类型：通过子进程执行
  // Schema.Unknown 接受任意值（对象/数组/字符串），不做类型校验。
  // LLM 看到的 JSON Schema 由 rawParameters 提供（从 TOOL.md 的 parameters 区解析）
  const inputSchema = Schema.Unknown
  const rawParameters = paramsToJSONSchema(def.frontmatter.parameters)

  const execute = (input: unknown, _context: any): Effect.Effect<string, any, any> =>
    Effect.gen(function* () {
      const cwd = def.toolDir
      let interpreter: string | null

      // 将 workspaceRoot 注入到 input 中，作为脚本工具的默认 cwd
      // 仅当 input 是对象且 LLM 未显式传 cwd 时注入
      const inputObj = typeof input === "object" && input !== null && !Array.isArray(input)
        ? { ...input as Record<string, unknown> }
        : null
      if (inputObj && _context?.workspaceRoot && typeof _context.workspaceRoot === "string") {
        if (!inputObj["cwd"]) {
          inputObj["cwd"] = _context.workspaceRoot
        }
      }

      if (isPythonEntry(exec.entry) && !exec.interpreter) {
        // Python 工具：动态解析解释器，支持 .venv 检测
        yield* ensureRequirements(cwd)
        interpreter = yield* Effect.tryPromise({
          try: () => resolvePython(cwd),
          catch: () => process.platform === "win32" ? "python" : "python3"
        })
      } else {
        interpreter = inferInterpreter(exec.entry, exec.interpreter)
      }

      if (!interpreter) {
        return `❌ 工具 "${def.name}" 配置错误：无法推断 "${exec.entry}" 的解释器，请在 execution.interpreter 中指定`
      }

      const cmdParts = [...interpreter.split(" "), exec.entry]
      const inputJson = JSON.stringify(inputObj ?? input)

      const result = yield* Effect.tryPromise({
        try: async () => {
          const proc = Bun.spawn(cmdParts, {
            cwd,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              PYTHONIOENCODING: "utf-8",
              PYTHONUTF8: "1",
            },
          })

          if (proc.stdin) {
            proc.stdin.write(inputJson)
            proc.stdin.end()
          }

          const timeout = exec.timeout > 0 ? exec.timeout : 30000
          const timer = setTimeout(() => { proc.kill() }, timeout)

          const stdout = await new Response(proc.stdout).text()
          const stderr = await new Response(proc.stderr).text()
          clearTimeout(timer)

          const exitCode = await proc.exited
          return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
        },
        catch: (err) => ({
          stdout: "",
          stderr: `脚本执行异常: ${String(err)}`,
          exitCode: -1,
        }),
      }).pipe(
        Effect.catchAll((err) =>
          Effect.succeed({
            stdout: "",
            stderr: `脚本执行异常: ${String(err)}`,
            exitCode: -1,
          })
        )
      )

      const parts: string[] = []
      if (result.stdout) parts.push(result.stdout)
      if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
      if (result.exitCode !== 0) parts.push(`[退出码: ${result.exitCode}]`)
      return parts.join("\n")
    })

  return {
    name: def.name,
    description: def.description + (def.body ? `\n\n${def.body}` : ""),
    category: def.frontmatter.category,
    permission: def.frontmatter.permission,
    inputSchema,
    ...(Object.keys(def.frontmatter.parameters).length > 0 ? { rawParameters } : {}),
    sideEffect: def.frontmatter.sideEffect,
    safeToRetry: def.frontmatter.safeToRetry,
    sensitivity: def.frontmatter.sensitivity,
    defaultEnabled: def.frontmatter.defaultEnabled,
    ...(exec.requireConfirm ? { requireConfirm: true as const } : {}),
    execute,
  }
}
