// src/tool/builtin/skill.ts
// Agent 按需查询 Skill 的工具：list_skills（浏览可用 Skill）+ get_skill（获取具体 Skill 文档）
import { Effect, Schema } from "effect"
import type { ToolDefinition } from "../types.js"
import { ToolExecutionError } from "../types.js"
import { SkillRegistry } from "../../skill/registry.js"

// ====================================================
// list_skills — 列出所有可用的 Skill（轻量元数据）
// ====================================================

const ListSkillsInputSchema = Schema.Struct({
  tag: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
})

export const ListSkillsTool: ToolDefinition<typeof ListSkillsInputSchema.Type, string> = {
  name: "list_skills",
  description:
    "List all available skills (domain-specific guides/instructions). " +
    "Use this to discover what expertise guides are available before deciding which to load. " +
    "Returns name, description, tags, and category for each skill.",
  category: "search",
  permission: "read",
  sideEffect: "read",
  safeToRetry: true,
  sensitivity: "low",
  defaultEnabled: true,
  inputSchema: ListSkillsInputSchema,

  execute: (input, _context) =>
    Effect.gen(function* () {
      const registry = yield* SkillRegistry
      const skills = yield* registry.list({
        ...(input.tag ? { tag: input.tag } : {}),
        ...(input.category ? { category: input.category } : {}),
      })

      if (skills.length === 0) {
        return "No skills found."
      }

      const lines = skills.map(
        (s) =>
          `- **${s.name}** (v${s.version}) [${s.category}] — ${s.description}\n` +
          `  tags: ${s.tags.join(", ")}`,
      )
      return `Available skills (${skills.length}):\n\n${lines.join("\n\n")}`
    }),
}

// ====================================================
// get_skill — 获取指定 Skill 的完整文档
// ====================================================

const GetSkillInputSchema = Schema.Struct({
  name: Schema.String,
})

export const GetSkillTool: ToolDefinition<typeof GetSkillInputSchema.Type, string> = {
  name: "get_skill",
  description:
    "Get the full documentation for a specific skill by name. " +
    "Use this after list_skills to load a skill's complete guide before applying it to your task.",
  category: "search",
  permission: "read",
  sideEffect: "read",
  safeToRetry: true,
  sensitivity: "low",
  defaultEnabled: true,
  inputSchema: GetSkillInputSchema,

  execute: (input, _context) =>
    Effect.gen(function* () {
      const registry = yield* SkillRegistry

      const skill = yield* Effect.either(registry.get(input.name))
      if (skill._tag === "Left") {
        return yield* Effect.fail(
          new ToolExecutionError({
            toolName: "get_skill",
            message: `Skill "${input.name}" not found. Use list_skills to see available skills.`,
            cause: skill.left,
          }),
        )
      }

      const s = skill.right
      const parts: string[] = [
        `# Skill: ${s.name} (v${s.version})`,
        `Category: ${s.category}`,
        `Tags: ${s.tags.join(", ")}`,
        `Description: ${s.description}`,
        ``,
        s.content,
      ]

      if (s.type === "hybrid" && s.frontmatter.execution) {
        const exec = s.frontmatter.execution
        parts.push(
          ``,
          `> 📎 This skill includes an executable script: \`${exec.entry}\` (timeout: ${exec.timeout}ms)`,
        )
      }

      return parts.join("\n")
    }),
}
