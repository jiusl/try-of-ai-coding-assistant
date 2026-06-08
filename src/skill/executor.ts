// src/skill/executor.ts
import { Context, Data, Effect, Layer } from "effect"
import type { SkillDefinition } from "./types.js"
import type { SkillRegistryService } from "./registry.js"
import { SkillRegistry } from "./registry.js"
import { SkillNotFoundError } from "./types.js"

// ====================================================
// 执行结果
// ====================================================

export interface SkillExecutionResult {
  readonly skillName: string
  readonly success: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly durationMs: number
}

export class SkillExecutionError extends Data.TaggedError("SkillExecutionError")<{
  readonly skillName: string
  readonly reason: string
}> {
  override get message(): string {
    return `Skill "${this.skillName}" 执行失败: ${this.reason}`
  }
}

// ====================================================
// 解释器推断
// ====================================================

const EXT_INTERPRETER: Record<string, string> = {
  ".ts": "bun run",
  ".js": "bun run",
  ".py": "python3",
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

// ====================================================
// 服务接口
// ====================================================

export interface SkillExecutorService {
  /**
   * 执行混合型 Skill 的入口脚本。
   * 纯文档型 Skill 调用此方法会报错。
   */
  readonly execute: (
    name: string,
    args?: string[],
  ) => Effect.Effect<SkillExecutionResult, SkillNotFoundError | SkillExecutionError>

  /**
   * 检查 Skill 是否可执行（是否为混合型且有有效入口脚本）
   */
  readonly isExecutable: (name: string) => Effect.Effect<boolean, SkillNotFoundError>
}

export class SkillExecutor extends Context.Tag("SkillExecutor")<
  SkillExecutor,
  SkillExecutorService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const SkillExecutorLive = Layer.effect(
  SkillExecutor,
  Effect.gen(function* () {
    const registry = yield* SkillRegistry

    const isExecutable = (name: string) =>
      Effect.gen(function* () {
        const skill = yield* registry.get(name)
        return skill.type === "hybrid" && !!skill.frontmatter.execution?.entry
      })

    const execute = (name: string, args: string[] = []) =>
      Effect.gen(function* () {
        const skill = yield* registry.get(name)

        if (skill.type !== "hybrid" || !skill.frontmatter.execution?.entry) {
          return yield* Effect.fail(
            new SkillExecutionError({
              skillName: name,
              reason: `Skill "${name}" 是纯文档型，不支持脚本执行`,
            }),
          )
        }

        const exec = skill.frontmatter.execution
        const interpreter = inferInterpreter(exec.entry, exec.interpreter)

        if (!interpreter) {
          return yield* Effect.fail(
            new SkillExecutionError({
              skillName: name,
              reason: `无法推断 "${exec.entry}" 的解释器，请在 execution.interpreter 中指定`,
            }),
          )
        }

        // 构建命令
        const cwd = skill.skillDir
        const cmdParts = [...interpreter.split(" "), exec.entry, ...args]
        const cmd = cmdParts.join(" ")

        const startTime = Date.now()

        const result = yield* Effect.tryPromise({
          try: async () => {
            const proc = Bun.spawn(cmdParts, {
              cwd,
              stdout: "pipe",
              stderr: "pipe",
            })

            const timeout = exec.timeout > 0 ? exec.timeout : 60000
            const timer = setTimeout(() => {
              proc.kill()
            }, timeout)

            const stdout = await new Response(proc.stdout).text()
            const stderr = await new Response(proc.stderr).text()
            clearTimeout(timer)

            const exitCode = await proc.exited
            return { stdout, stderr, exitCode }
          },
          catch: (err) =>
            new SkillExecutionError({
              skillName: name,
              reason: `脚本执行失败: ${String(err)}`,
            }),
        })

        const durationMs = Date.now() - startTime

        return {
          skillName: name,
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs,
        }
      })

    return { execute, isExecutable }
  }),
)
