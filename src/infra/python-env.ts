// src/infra/python-env.ts
// 统一的 Python 解释器解析与环境管理
// 解决 python/python3 不一致、venv 检测、依赖安装等问题

import * as fs from "fs/promises"
import * as path from "path"
import { Effect } from "effect"

// ====================================================
// Python 解释器解析
// ====================================================

/**
 * 解析 Python 解释器路径：
 * 1. 优先检测 cwd 及其祖先目录中的 .venv
 * 2. 否则回退到系统 PATH 上的 python / python3
 *
 * Windows: .venv/Scripts/python.exe
 * Unix:    .venv/bin/python
 */
export async function resolvePython(cwd: string): Promise<string> {
  // 1. 检测 .venv
  const venvPython = await findVenvPython(cwd)
  if (venvPython) return venvPython

  // 2. 回退到系统 PATH：优先 python，其次 python3
  const pythonCmd = process.platform === "win32" ? "python" : "python3"
  const fallback = process.platform === "win32" ? "python3" : "python"

  if (await commandExists(pythonCmd)) return pythonCmd
  if (await commandExists(fallback)) return fallback

  // 最后兜底
  return pythonCmd
}

/**
 * 从 cwd 向上查找 .venv，返回其中的 Python 可执行文件路径
 */
async function findVenvPython(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd)
  const root = path.parse(dir).root

  while (dir !== root) {
    const venvDir = path.join(dir, ".venv")
    try {
      await fs.access(venvDir)
      const pythonPath = getVenvPythonPath(venvDir)
      try {
        await fs.access(pythonPath)
        return pythonPath
      } catch {
        // .venv 存在但 Python 解释器不在预期位置，跳过
      }
    } catch {
      // .venv 不存在，继续向上
    }
    dir = path.dirname(dir)
  }
  return null
}

/** 根据平台返回 .venv 中 Python 解释器的路径 */
function getVenvPythonPath(venvDir: string): string {
  if (process.platform === "win32") {
    return path.join(venvDir, "Scripts", "python.exe")
  }
  return path.join(venvDir, "bin", "python")
}

/**
 * 检查命令是否在 PATH 上可用（跨平台）
 */
async function commandExists(cmd: string): Promise<boolean> {
  const whichCmd = process.platform === "win32"
    ? `where ${cmd} 2>nul`
    : `command -v ${cmd} 2>/dev/null`

  try {
    const { exec } = await import("child_process")
    const { promisify } = await import("util")
    await promisify(exec)(whichCmd, { shell: true })
    return true
  } catch {
    return false
  }
}

// ====================================================
// requirements.txt 依赖安装
// ====================================================

const installedCache = new Set<string>()

/**
 * 检查 tool/skill 目录下是否有 requirements.txt，
 * 如有且未安装过则尝试 pip install -r
 */
export function ensureRequirements(cwd: string): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const reqPath = path.join(cwd, "requirements.txt")
    const markerPath = path.join(cwd, ".requirements-installed")

    // 缓存命中
    if (installedCache.has(cwd)) return

    // 检查 requirements.txt 是否存在
    const reqExists = yield* Effect.tryPromise({
      try: () => fs.access(reqPath).then(() => true).catch(() => false),
      catch: () => false
    })
    if (!reqExists) return

    // 检查标记文件（上次安装成功）
    const markerExists = yield* Effect.tryPromise({
      try: () => fs.access(markerPath).then(() => true).catch(() => false),
      catch: () => false
    })
    if (markerExists) { installedCache.add(cwd); return }

    yield* Effect.log(`📦 检测到 requirements.txt，正在安装依赖: ${cwd}`).pipe(
      Effect.catchAll(() => Effect.void)
    )

    const pipCmd = yield* Effect.tryPromise({
      try: () => resolvePip(cwd),
      catch: () => process.platform === "win32" ? "pip" : "pip3"
    })
    const installCmd = `${pipCmd} install -r "${reqPath}"`

    yield* Effect.tryPromise({
      try: async () => {
        const { exec } = await import("child_process")
        const { promisify } = await import("util")
        const execAsync = promisify(exec)
        await execAsync(installCmd, { cwd, timeout: 120000, shell: true })
        // 安装成功后写入标记文件
        await fs.writeFile(markerPath, new Date().toISOString(), "utf-8")
        installedCache.add(cwd)
      },
      catch: (err) => {
        console.warn(`⚠  依赖安装失败 (${cwd}): ${String(err)}`)
      }
    })

    return
  }).pipe(Effect.catchAll(() => Effect.void))
}

/**
 * 解析 pip 命令（优先使用 venv 中的 pip）
 */
async function resolvePip(cwd: string): Promise<string> {
  // 检查 .venv
  const venvPython = await findVenvPython(cwd)
  if (venvPython) {
    const venvDir = path.dirname(venvPython)
    // 同目录下的 pip / pip.exe
    const pipName = process.platform === "win32" ? "pip.exe" : "pip"
    const pipPath = path.join(venvDir, pipName)
    try { await fs.access(pipPath); return `"${pipPath}"` } catch { /* 不存在 */ }
    // 用 python -m pip 兜底
    return `"${venvPython}" -m pip`
  }

  // 系统 pip
  const pipCmd = process.platform === "win32" ? "pip" : "pip3"
  if (await commandExists(pipCmd)) return pipCmd
  const fallback = process.platform === "win32" ? "pip3" : "pip"
  if (await commandExists(fallback)) return fallback
  return pipCmd
}

// ====================================================
// 便捷函数：拿到解释器 + 确保依赖
// ====================================================

/**
 * 为 tool/skill 准备 Python 环境：
 * 1. 安装 requirements.txt 中的依赖（如有）
 * 2. 返回 Python 解释器路径
 */
export function preparePythonEnv(cwd: string): Effect.Effect<string, never, never> {
  return Effect.gen(function* () {
    yield* ensureRequirements(cwd)
    return yield* Effect.tryPromise({
      try: () => resolvePython(cwd),
      catch: () => {
        // 兜底
        return process.platform === "win32" ? "python" : "python3"
      }
    })
  })
}
