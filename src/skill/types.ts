// src/skill/types.ts
import { Data } from "effect"

// ====================================================
// Skill 类型 & 来源
// ====================================================

/** Skill 形态：纯文档型 / 混合型 */
export type SkillType = "document" | "hybrid"

/** Skill 来源：内置 / 用户自定义 / 远程下载 */
export type SkillSource = "builtin" | "user" | "remote"

// ====================================================
// 执行配置（仅混合型 Skill）
// ====================================================

export interface SkillExecution {
  readonly type: "script"
  /** 入口脚本路径（相对于 skill 目录） */
  readonly entry: string
  /** 解释器，默认根据扩展名推断 */
  readonly interpreter?: string
  /** 超时时间（毫秒），默认 60000 */
  readonly timeout: number
  /** 是否需要用户确认 */
  readonly requireConfirm: boolean
}

// ====================================================
// SKILL.md Frontmatter（YAML）
// ====================================================

export interface SkillFrontmatter {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly author: string
  readonly tags: string[]
  readonly category: string
  readonly execution?: SkillExecution
}

// ====================================================
// Skill 定义（完整信息）
// ====================================================

export interface SkillDefinition {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly author: string
  readonly tags: string[]
  readonly category: string
  /** Skill 形态 */
  readonly type: SkillType
  /** Skill 来源 */
  readonly source: SkillSource
  /** Skill 目录的绝对路径 */
  readonly skillDir: string
  /** SKILL.md 的绝对路径 */
  readonly mdPath: string
  /** Markdown 正文（去除 frontmatter） */
  readonly content: string
  /** 原始 frontmatter */
  readonly frontmatter: SkillFrontmatter
  /** SKILL.md 的修改时间 */
  readonly mtime: Date
}

// ====================================================
// 错误类型
// ====================================================

export class SkillNotFoundError extends Data.TaggedError("SkillNotFoundError")<{
  readonly name: string
}> {
  override get message(): string {
    return `找不到 Skill "${this.name}"，请检查 skills/ 目录下是否存在对应的 SKILL.md 文件`
  }
}

export class SkillLoadError extends Data.TaggedError("SkillLoadError")<{
  readonly path: string
  readonly reason: string
}> {
  override get message(): string {
    return `Skill 加载失败 (${this.path}): ${this.reason}`
  }
}

export class SkillParseError extends Data.TaggedError("SkillParseError")<{
  readonly path: string
  readonly reason: string
}> {
  override get message(): string {
    return `Skill 解析失败 (${this.path}): ${this.reason}`
  }
}

// ====================================================
// Skill 目录常量
// ====================================================

/** Skill 根目录名称 */
export const SKILLS_DIR = "skills"

/** Skill 来源 → 子目录映射 */
export const SKILL_SOURCE_DIRS: Record<SkillSource, string> = {
  builtin: "builtin",
  user: "user",
  remote: "remote",
} as const
