// src/skill/remote.ts
import { Context, Data, Effect, Layer } from "effect"
import * as fs from "fs/promises"
import * as path from "path"
import type { SkillSource } from "./types.js"

// ====================================================
// 远程 Skill 来源类型
// ====================================================

export type RemoteSource = GitSource | HttpSource

export interface GitSource {
  readonly type: "git"
  /** Git 仓库 URL */
  readonly url: string
  /** 分支/标签（默认 main） */
  readonly ref?: string
  /** 仓库内 skill 子路径 */
  readonly subPath?: string
}

export interface HttpSource {
  readonly type: "http"
  /** 下载 URL（指向 SKILL.md 或压缩包） */
  readonly url: string
}

export interface RemoteSkillInfo {
  readonly name: string
  readonly source: RemoteSource
}

// ====================================================
// 错误
// ====================================================

export class RemoteSkillError extends Data.TaggedError("RemoteSkillError")<{
  readonly reason: string
}> {
  override get message(): string {
    return `远程 Skill 操作失败: ${this.reason}`
  }
}

// ====================================================
// 服务接口
// ====================================================

export interface SkillRemoteService {
  /**
   * 从远程源下载 Skill 到 skills/remote/ 目录
   */
  readonly download: (
    workspaceRoot: string,
    source: RemoteSource,
  ) => Effect.Effect<string, RemoteSkillError>

  /**
   * 列出已缓存的远程 Skill
   */
  readonly listCached: (
    workspaceRoot: string,
  ) => Effect.Effect<string[]>

  /**
   * 清除所有远程缓存
   */
  readonly clearCache: (
    workspaceRoot: string,
  ) => Effect.Effect<void>

  /**
   * 从 GitHub 仓库下载（便捷方法）
   */
  readonly downloadFromGitHub: (
    workspaceRoot: string,
    repo: string,
    options?: { ref?: string; subPath?: string },
  ) => Effect.Effect<string, RemoteSkillError>
}

export class SkillRemote extends Context.Tag("SkillRemote")<
  SkillRemote,
  SkillRemoteService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const SkillRemoteLive = Layer.sync(SkillRemote, () => {
  const download = (workspaceRoot: string, source: RemoteSource) =>
    Effect.gen(function* () {
      const remoteDir = path.join(workspaceRoot, "skills", "remote")

      if (source.type === "http") {
        const response = yield* Effect.tryPromise({
          try: () => fetch(source.url),
          catch: (err) =>
            new RemoteSkillError({
              reason: `HTTP 请求失败: ${String(err)}`,
            }),
        })

        if (!response.ok) {
          return yield* Effect.fail(
            new RemoteSkillError({
              reason: `HTTP ${response.status}: ${response.statusText}`,
            }),
          )
        }

        // 从 URL 中提取 skill 名称
        const urlObj = new URL(source.url)
        const nameFromUrl = path.basename(urlObj.pathname, ".md") || "remote-skill"
        const skillDir = path.join(remoteDir, nameFromUrl)

        // 确保目录存在并写入文件
        yield* Effect.tryPromise({
          try: async () => {
            const content = await response.text()
            await fs.mkdir(skillDir, { recursive: true })
            await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8")
          },
          catch: (err) =>
            new RemoteSkillError({
              reason: `写入文件失败: ${String(err)}`,
            }),
        })

        return skillDir
      }

      // Git 类型：提示用户使用 git clone
      if (source.type === "git") {
        const nameFromUrl = source.url.split("/").pop()?.replace(".git", "") ?? "git-skill"
        const skillDir = path.join(remoteDir, nameFromUrl)

        // 检查是否已存在
        const exists = yield* Effect.tryPromise({
          try: async () => {
            try {
              await fs.access(skillDir)
              return true
            } catch {
              return false
            }
          },
          catch: () => false,
        })

        if (exists) {
          return skillDir
        }

        yield* Effect.tryPromise({
          try: async () => {
            const ref = source.ref ?? "main"
            const proc = Bun.spawn(
              ["git", "clone", "--depth", "1", "--branch", ref, source.url, skillDir],
              { stdout: "pipe", stderr: "pipe" },
            )
            const exitCode = await proc.exited
            if (exitCode !== 0) {
              const stderr = await new Response(proc.stderr).text()
              throw new Error(`Git clone 失败 (exit ${exitCode}): ${stderr}`)
            }
          },
          catch: (err) =>
            new RemoteSkillError({
              reason: `Git 下载失败: ${String(err)}`,
            }),
        })

        return source.subPath
          ? path.join(skillDir, source.subPath)
          : skillDir
      }

      return yield* Effect.fail(
        new RemoteSkillError({
          reason: `不支持的来源类型: ${(source as RemoteSource).type}`,
        }),
      )
    })

  const listCached = (workspaceRoot: string) =>
    Effect.tryPromise({
      try: async () => {
        const remoteDir = path.join(workspaceRoot, "skills", "remote")
        try {
          const entries = await fs.readdir(remoteDir, { withFileTypes: true })
          return entries.filter((e) => e.isDirectory()).map((e) => e.name)
        } catch {
          return [] as string[]
        }
      },
      catch: () => [] as string[],
    })

  const clearCache = (workspaceRoot: string) =>
    Effect.tryPromise({
      try: async () => {
        const remoteDir = path.join(workspaceRoot, "skills", "remote")
        await fs.rm(remoteDir, { recursive: true, force: true })
        await fs.mkdir(remoteDir, { recursive: true })
      },
      catch: (err) =>
        new RemoteSkillError({
          reason: `清除缓存失败: ${String(err)}`,
        }),
    })

  const downloadFromGitHub = (
    workspaceRoot: string,
    repo: string,
    options?: { ref?: string; subPath?: string },
  ) =>
    download(workspaceRoot, {
      type: "git",
      url: `https://github.com/${repo}.git`,
      ref: options?.ref,
      subPath: options?.subPath,
    })

  return { download, listCached, clearCache, downloadFromGitHub }
})
