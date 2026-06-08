// src/skill/context-injector.ts
import { Context, Effect, Layer } from "effect"
import type { SkillDefinition } from "./types.js"
import type { SkillRegistryService } from "./registry.js"
import { SkillRegistry } from "./registry.js"

// ====================================================
// 服务接口
// ====================================================

export interface SkillContextInjectorService {
  /**
   * 将匹配的 Skill 文档注入到系统提示词/上下文中。
   * 纯文档型 Skill：直接注入 SKILL.md 内容。
   * 混合型 Skill：注入 SKILL.md 内容 + 可用的入口脚本说明。
   */
  readonly injectSkills: (
    skillNames: string[],
  ) => Effect.Effect<string>

  /**
   * 根据消息内容自动匹配相关 Skill 并注入。
   * 匹配策略：检查用户消息中是否包含 Skill 的 tags/category/name 关键字。
   */
  readonly injectRelevantSkills: (
    userMessage: string,
  ) => Effect.Effect<string>

  /**
   * 获取单个 Skill 的注入文本
   */
  readonly buildInjection: (
    skill: SkillDefinition,
  ) => string
}

export class SkillContextInjector extends Context.Tag("SkillContextInjector")<
  SkillContextInjector,
  SkillContextInjectorService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const SkillContextInjectorLive = Layer.effect(
  SkillContextInjector,
  Effect.gen(function* () {
    const registry = yield* SkillRegistry

    const buildInjection = (skill: SkillDefinition): string => {
      const lines: string[] = [
        `<skill_injection name="${skill.name}" category="${skill.category}">`,
        skill.content,
      ]

      if (skill.type === "hybrid" && skill.frontmatter.execution) {
        const exec = skill.frontmatter.execution
        lines.push(
          `\n> 📎 此 Skill 包含可执行脚本：\`${exec.entry}\`（超时 ${exec.timeout}ms）`,
        )
      }

      lines.push("</skill_injection>")
      return lines.join("\n")
    }

    const injectSkills = (skillNames: string[]) =>
      Effect.gen(function* () {
        const parts: string[] = []

        for (const name of skillNames) {
          const skill = yield* registry.get(name)
          parts.push(buildInjection(skill))
        }

        return parts.join("\n\n")
      })

    const injectRelevantSkills = (userMessage: string) =>
      Effect.gen(function* () {
        const allSkills = yield* registry.list()
        const lowerMsg = userMessage.toLowerCase()

        // 按关联度评分
        const scored = allSkills.map((skill) => {
          let score = 0

          // 名称匹配：+5
          if (lowerMsg.includes(skill.name.toLowerCase())) score += 5

          // 分类匹配：+3
          if (lowerMsg.includes(skill.category.toLowerCase())) score += 3

          // 标签匹配：每个标签 +2
          for (const tag of skill.tags) {
            if (lowerMsg.includes(tag.toLowerCase())) score += 2
          }

          // 描述关键词匹配：从 description 拆词
          const descWords = skill.description.split(/[\s,，、]+/)
          for (const word of descWords) {
            if (word.length >= 2 && lowerMsg.includes(word.toLowerCase())) {
              score += 1
            }
          }

          return { skill, score }
        })

        // 筛选得分 > 0 的，按得分降序排列，最多返回 5 个
        const relevant = scored
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((s) => s.skill)

        if (relevant.length === 0) return ""

        const parts = relevant.map(buildInjection)
        return parts.join("\n\n")
      })

    return { injectSkills, injectRelevantSkills, buildInjection }
  }),
)
