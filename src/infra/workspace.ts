// src/infra/workspace.ts
// ====================================================
// 工作目录管理 — 默认路径 + 安全校验
// ====================================================

import { existsSync, mkdirSync } from "fs"
import { resolve, isAbsolute, normalize, sep } from "path"

/**
 * 获取默认工作目录路径。
 * 规则：<项目根目录>/workspace/，不存在则自动创建。
 */
export function defaultWorkspace(): string {
  const ws = resolve(process.cwd(), "workspace")
  if (!existsSync(ws)) {
    try {
      mkdirSync(ws, { recursive: true })
    } catch {
      // 创建失败时回退到项目根目录
      return process.cwd()
    }
  }
  return ws
}

/**
 * 校验工作路径是否安全（必须在项目根目录下，防止 ../ 逃逸）。
 * 返回规范化后的绝对路径，若不安全则返回默认路径。
 */
export function sanitizeWorkspace(raw: string): string {
  if (!raw || !isAbsolute(raw)) {
    return defaultWorkspace()
  }

  const normalized = normalize(raw)
  const projectRoot = normalize(process.cwd())

  // 必须在项目根目录或其子目录下
  if (!normalized.startsWith(projectRoot + sep) && normalized !== projectRoot) {
    return defaultWorkspace()
  }

  // 确保目录存在
  if (!existsSync(normalized)) {
    try {
      mkdirSync(normalized, { recursive: true })
    } catch {
      return defaultWorkspace()
    }
  }

  return normalized
}

/**
 * 列出工作目录下的直接子目录（供前端选择器使用）。
 */
export function listWorkspaceSubdirs(base: string): string[] {
  const { readdirSync, statSync } = require("fs")
  const { join } = require("path")
  try {
    return readdirSync(base)
      .filter((name: string) => {
        try {
          return statSync(join(base, name)).isDirectory() && !name.startsWith(".")
        } catch {
          return false
        }
      })
      .map((name: string) => join(base, name))
  } catch {
    return []
  }
}
