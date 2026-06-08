// src/skill/registry.ts
import { Context, Effect, Layer, Ref } from "effect"
import type { SkillDefinition, SkillSource, SkillType } from "./types.js"
import { SkillNotFoundError } from "./types.js"

// ====================================================
// 服务接口
// ====================================================

export interface SkillRegistryService {
  /** 注册一个 Skill */
  readonly register: (skill: SkillDefinition) => Effect.Effect<void>

  /** 批量注册 */
  readonly registerAll: (skills: SkillDefinition[]) => Effect.Effect<void>

  /** 按名称获取 Skill */
  readonly get: (name: string) => Effect.Effect<SkillDefinition, SkillNotFoundError>

  /** 列出所有 Skill */
  readonly list: (options?: SkillListOptions) => Effect.Effect<SkillDefinition[]>

  /** 按名称查找（可能不存在） */
  readonly findByName: (name: string) => Effect.Effect<SkillDefinition | undefined>

  /** 按标签搜索 */
  readonly findByTags: (tags: string[]) => Effect.Effect<SkillDefinition[]>

  /** 按分类搜索 */
  readonly findByCategory: (category: string) => Effect.Effect<SkillDefinition[]>

  /** 获取所有标签 */
  readonly allTags: () => Effect.Effect<string[]>

  /** 获取所有分类 */
  readonly allCategories: () => Effect.Effect<string[]>

  /** 清空所有注册（用于测试/重载） */
  readonly clear: () => Effect.Effect<void>
}

export interface SkillListOptions {
  readonly source?: SkillSource
  readonly type?: SkillType
  readonly tag?: string
  readonly category?: string
}

export class SkillRegistry extends Context.Tag("SkillRegistry")<
  SkillRegistry,
  SkillRegistryService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const SkillRegistryLive = Layer.effect(
  SkillRegistry,
  Effect.gen(function* () {
    // name → definition
    const skillsRef = yield* Ref.make<Map<string, SkillDefinition>>(new Map())
    // tag → name[]
    const tagIndexRef = yield* Ref.make<Map<string, Set<string>>>(new Map())
    // category → name[]
    const categoryIndexRef = yield* Ref.make<Map<string, Set<string>>>(new Map())

    const addToIndex = (
      index: Map<string, Set<string>>,
      key: string,
      name: string,
    ): Map<string, Set<string>> => {
      const updated = new Map(index)
      const set = updated.get(key)
      if (set) {
        const newSet = new Set(set)
        newSet.add(name)
        updated.set(key, newSet)
      } else {
        updated.set(key, new Set([name]))
      }
      return updated
    }

    const removeFromIndex = (
      index: Map<string, Set<string>>,
      name: string,
    ): Map<string, Set<string>> => {
      const updated = new Map(index)
      for (const [key, set] of updated) {
        if (set.has(name)) {
          const newSet = new Set(set)
          newSet.delete(name)
          if (newSet.size > 0) {
            updated.set(key, newSet)
          } else {
            updated.delete(key)
          }
        }
      }
      return updated
    }

    const buildIndexes = (
      skill: SkillDefinition,
      tagIdx: Map<string, Set<string>>,
      catIdx: Map<string, Set<string>>,
    ): [Map<string, Set<string>>, Map<string, Set<string>>] => {
      let t = tagIdx
      for (const tag of skill.tags) {
        t = addToIndex(t, tag.toLowerCase(), skill.name)
      }
      let c = catIdx
      c = addToIndex(c, skill.category.toLowerCase(), skill.name)
      return [t, c]
    }

    const register = (skill: SkillDefinition) =>
      Effect.gen(function* () {
        yield* Ref.update(skillsRef, (m) => {
          const updated = new Map(m)
          updated.set(skill.name, skill)
          return updated
        })

        yield* Ref.update(tagIndexRef, (idx) => {
          let result = removeFromIndex(idx, skill.name)
          for (const tag of skill.tags) {
            result = addToIndex(result, tag.toLowerCase(), skill.name)
          }
          return result
        })

        yield* Ref.update(categoryIndexRef, (idx) => {
          let result = removeFromIndex(idx, skill.name)
          result = addToIndex(result, skill.category.toLowerCase(), skill.name)
          return result
        })
      })

    const registerAll = (skills: SkillDefinition[]) =>
      Effect.gen(function* () {
        for (const skill of skills) {
          yield* register(skill)
        }
      })

    const get = (name: string) =>
      Effect.gen(function* () {
        const skills = yield* Ref.get(skillsRef)
        const skill = skills.get(name)
        if (!skill) {
          return yield* Effect.fail(new SkillNotFoundError({ name }))
        }
        return skill
      })

    const findByName = (name: string) =>
      Ref.get(skillsRef).pipe(Effect.map((m) => m.get(name)))

    const list = (options?: SkillListOptions) =>
      Ref.get(skillsRef).pipe(
        Effect.map((m) => {
          let results = [...m.values()]
          if (options?.source) {
            results = results.filter((s) => s.source === options.source)
          }
          if (options?.type) {
            results = results.filter((s) => s.type === options.type)
          }
          if (options?.tag) {
            const tag = options.tag.toLowerCase()
            results = results.filter((s) =>
              s.tags.some((t) => t.toLowerCase() === tag),
            )
          }
          if (options?.category) {
            const cat = options.category.toLowerCase()
            results = results.filter((s) => s.category.toLowerCase() === cat)
          }
          return results
        }),
      )

    const findByTags = (tags: string[]) =>
      Ref.get(skillsRef).pipe(
        Effect.map((m) => {
          const lowerTags = tags.map((t) => t.toLowerCase())
          return [...m.values()].filter((s) =>
            lowerTags.some((lt) =>
              s.tags.some((st) => st.toLowerCase() === lt),
            ),
          )
        }),
      )

    const findByCategory = (category: string) =>
      Ref.get(skillsRef).pipe(
        Effect.map((m) => {
          const cat = category.toLowerCase()
          return [...m.values()].filter((s) => s.category.toLowerCase() === cat)
        }),
      )

    const allTags = () =>
      Ref.get(tagIndexRef).pipe(
        Effect.map((idx) => [...idx.keys()].sort()),
      )

    const allCategories = () =>
      Ref.get(categoryIndexRef).pipe(
        Effect.map((idx) => [...idx.keys()].sort()),
      )

    const clear = () =>
      Effect.gen(function* () {
        yield* Ref.set(skillsRef, new Map())
        yield* Ref.set(tagIndexRef, new Map())
        yield* Ref.set(categoryIndexRef, new Map())
      })

    return {
      register,
      registerAll,
      get,
      list,
      findByName,
      findByTags,
      findByCategory,
      allTags,
      allCategories,
      clear,
    }
  }),
)
