// src/permission/rule-engine.ts
import { Context, Effect, Layer, Option, Array, Ref } from "effect"
import type { Action, PermissionRule, PermissionRequest, Decision, Pattern } from "./types.js"
import { matchesPattern, PermissionDeniedError, PermissionConfigError } from "./types.js"

// ====================================================
// 服务接口
// ====================================================

export interface RuleEngine {
  /** 匹配最合适的规则（按优先级） */
  readonly matchRule: (
    action: Action,
    target: string
  ) => Effect.Effect<Option.Option<PermissionRule>>
  
  /** 评估决策 */
  readonly evaluate: (
    request: PermissionRequest
  ) => Effect.Effect<Decision, PermissionDeniedError>
  
  /** 添加规则 */
  readonly addRule: (rule: PermissionRule) => Effect.Effect<void, PermissionConfigError>
  
  /** 批量添加规则 */
  readonly addRules: (rules: PermissionRule[]) => Effect.Effect<void, PermissionConfigError>
  
  /** 移除规则 */
  readonly removeRule: (ruleId: string) => Effect.Effect<void>
  
  /** 获取所有规则 */
  readonly getAllRules: () => Effect.Effect<PermissionRule[]>
  
  /** 临时覆盖规则决策 */
  readonly temporaryOverride: (
    ruleId: string,
    decision: Decision
  ) => Effect.Effect<void>
  
  /** 清除所有临时覆盖 */
  readonly clearOverrides: () => Effect.Effect<void>
}

export class RuleEngineService extends Context.Tag("RuleEngineService")<
  RuleEngineService,
  RuleEngine
>() {}

// ====================================================
// 条件评估器 — 支持 ! && || 和内置函数
// ====================================================

type CondToken =
  | { type: "ident"; value: string }
  | { type: "eqeqeq" }
  | { type: "bool"; value: boolean }
  | { type: "string"; value: string }
  | { type: "dot" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "not" }
  | { type: "andand" }
  | { type: "oror" }
  | { type: "eof" }

const tokenize = (s: string): CondToken[] => {
  const tokens: CondToken[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]!
    if (/\s/.test(ch)) { i++; continue }
    if (ch === "!" && s[i + 1] !== "=") { tokens.push({ type: "not" }); i++; continue }
    if (s[i] === "&" && s[i + 1] === "&") { tokens.push({ type: "andand" }); i += 2; continue }
    if (s[i] === "|" && s[i + 1] === "|") { tokens.push({ type: "oror" }); i += 2; continue }
    if (s[i] === "=" && s[i + 1] === "=" && s[i + 2] === "=") { tokens.push({ type: "eqeqeq" }); i += 3; continue }
    if (ch === ".") { tokens.push({ type: "dot" }); i++; continue }
    if (ch === "(") { tokens.push({ type: "lparen" }); i++; continue }
    if (ch === ")") { tokens.push({ type: "rparen" }); i++; continue }
    if (ch === "'" || ch === '"') {
      const quote = ch
      let j = i + 1
      while (j < s.length && s[j] !== quote) j++
      tokens.push({ type: "string", value: s.slice(i + 1, j) })
      i = j + 1
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j]!)) j++
      const word = s.slice(i, j)
      if (word === "true") tokens.push({ type: "bool", value: true })
      else if (word === "false") tokens.push({ type: "bool", value: false })
      else tokens.push({ type: "ident", value: word })
      i = j
      continue
    }
    // unknown char — skip
    i++
  }
  tokens.push({ type: "eof" })
  return tokens
}

const evaluateCondition = (
  condition: string,
  context: PermissionRequest["context"]
): Effect.Effect<boolean> => {
  return Effect.sync(() => {
    try {
      const tokens = tokenize(condition)
      let pos = 0
      
      const peek = (): CondToken => tokens[pos] ?? { type: "eof" } as CondToken
      const advance = (): CondToken => tokens[pos++] ?? { type: "eof" } as CondToken
      
      // expr := or_expr
      const parseExpr = (): boolean => {
        const left = parseOr()
        if (peek().type !== "eof") {
          // partial parse — treat as if it passed
        }
        return left
      }
      
      // or_expr := and_expr ("||" and_expr)*
      const parseOr = (): boolean => {
        let left = parseAnd()
        while (peek().type === "oror") {
          advance()
          const right = parseAnd()
          left = left || right
        }
        return left
      }
      
      // and_expr := primary ("&&" primary)*
      const parseAnd = (): boolean => {
        let left = parsePrimary()
        while (peek().type === "andand") {
          advance()
          const right = parsePrimary()
          left = left && right
        }
        return left
      }
      
      // primary := "!" primary | atom | "(" expr ")"
      const parsePrimary = (): boolean => {
        const tok = peek()
        
        if (tok.type === "not") {
          advance()
          return !parsePrimary()
        }
        
        if (tok.type === "lparen") {
          advance()
          const val = parseExpr()
          // expect rparen
          if (peek().type === "rparen") advance()
          return val
        }
        
        return parseAtom()
      }
      
      // atom := ident ("." ident)* ("===" bool) | ident "." ident "(" ")" | ident "." ident "(" string ")"
      const parseAtom = (): boolean => {
        const parts: string[] = []
        while (peek().type === "ident") {
          const tok = advance()
          if (tok.type === "ident") parts.push(tok.value)
          if (peek().type === "dot") { advance(); continue }
          break
        }
        
        // Function call: recentApprovals.has("xxx")
        if (peek().type === "lparen") {
          advance()
          let arg = ""
          const next = peek()
          if (next.type === "string") { arg = next.value; advance() }
          // skip rparen
          if (peek().type === "rparen") advance()
          
          const path = parts.join(".")
          if (path === "recentApprovals.has") {
            return context.recentApprovals.has(arg)
          }
          // unknown function — pass
          return true
        }
        
        // Comparison: context.isCI === true
        if (peek().type === "eqeqeq") {
          advance()
          const rhs = advance()
          
          const path = parts.join(".")
          let leftVal: unknown = undefined
          
          if (path === "context.isCI") leftVal = context.isCI
          else if (path === "context.isInteractive") leftVal = context.isInteractive
          else if (path === "context.projectPath") leftVal = context.projectPath
          else return true // unknown variable — pass
          
          if (rhs.type === "bool") return leftVal === rhs.value
          if (rhs.type === "string") return leftVal === rhs.value
          return true
        }
        
        // Standalone ident — truthy check
        return true
      }
      
      return parseExpr()
    } catch {
      // invalid expression — don't block, return true (condition passes)
      return true
    }
  })
}

// ====================================================
// 默认规则引擎实现
// ====================================================

export const RuleEngineLive = Layer.effect(
  RuleEngineService,
  Effect.gen(function* () {
    // 规则存储
    const rulesRef = yield* Ref.make<PermissionRule[]>([])
    // 临时覆盖存储
    const overridesRef = yield* Ref.make<Map<string, Decision>>(new Map())
    
    // 按优先级排序（数字越大优先级越高）
    const sortByPriority = (rules: PermissionRule[]): PermissionRule[] =>
      [...rules].sort((a, b) => b.priority - a.priority)
    
    // 匹配规则
    const matchRule = (
      action: Action,
      target: string
    ): Effect.Effect<Option.Option<PermissionRule>> =>
      Effect.gen(function* () {
        const rules = yield* Ref.get(rulesRef)
        const sorted = sortByPriority(rules)
        
        for (const rule of sorted) {
          if (rule.action !== action) continue
          
          if (matchesPattern(target, rule.pattern)) {
            return Option.some(rule)
          }
        }
        
        return Option.none()
      })
    
    // 评估决策
    const evaluate = (request: PermissionRequest) =>
      Effect.gen(function* () {
        const ruleOpt = yield* matchRule(request.action, request.target)
        
        if (Option.isNone(ruleOpt)) {
          return "deny" as Decision
        }
        
        const rule = ruleOpt.value
        
        // 检查是否有临时覆盖
        const overrides = yield* Ref.get(overridesRef)
        const override = overrides.get(rule.id)
        if (override) {
          return override
        }
        
        // 检查条件
        if (rule.condition) {
          const conditionMet = yield* evaluateCondition(rule.condition, request.context)
          if (!conditionMet) {
            return "deny" as Decision
          }
        }
        
        // 如果规则要求确认，返回 ask
        if (rule.requireConfirm && rule.decision === "allow") {
          return "ask" as Decision
        }
        
        return rule.decision
      })
    
    // 验证规则
    const validateRule = (rule: PermissionRule): Effect.Effect<void, PermissionConfigError> =>
      Effect.gen(function* () {
        if (!rule.id || rule.id.trim() === "") {
          return yield* Effect.fail(new PermissionConfigError({
            message: "Rule must have an id"
          }))
        }
        
        if (!rule.action) {
          return yield* Effect.fail(new PermissionConfigError({
            message: "Rule must have an action",
            ruleId: rule.id
          }))
        }
        
        if (!rule.pattern) {
          return yield* Effect.fail(new PermissionConfigError({
            message: "Rule must have a pattern",
            ruleId: rule.id
          }))
        }
        
        if (rule.priority === undefined) {
          return yield* Effect.fail(new PermissionConfigError({
            message: "Rule must have a priority",
            ruleId: rule.id
          }))
        }
        
        // 检查 pattern 是否有效
        if (typeof rule.pattern === "string") {
          try {
            matchesPattern("test", rule.pattern)
          } catch {
            return yield* Effect.fail(new PermissionConfigError({
              message: `Invalid glob pattern: ${rule.pattern}`,
              ruleId: rule.id
            }))
          }
        }
        
        return Effect.void
      })
    
    // 添加规则
    const addRule = (rule: PermissionRule) =>
      Effect.gen(function* () {
        yield* validateRule(rule)
        
        yield* Ref.update(rulesRef, rules => {
          // 如果已存在相同 ID 的规则，先移除
          const filtered = rules.filter(r => r.id !== rule.id)
          return [...filtered, rule]
        })
      })
    
    // 批量添加规则
    const addRules = (rules: PermissionRule[]) =>
      Effect.gen(function* () {
        for (const rule of rules) {
          yield* addRule(rule)
        }
      })
    
    // 移除规则
    const removeRule = (ruleId: string) =>
      Effect.gen(function* () {
        yield* Ref.update(rulesRef, rules => rules.filter(r => r.id !== ruleId))
        yield* Ref.update(overridesRef, overrides => {
          overrides.delete(ruleId)
          return overrides
        })
      })
    
    // 获取所有规则
    const getAllRules = () => Ref.get(rulesRef)
    
    // 临时覆盖
    const temporaryOverride = (ruleId: string, decision: Decision) =>
      Effect.gen(function* () {
        yield* Ref.update(overridesRef, overrides => {
          overrides.set(ruleId, decision)
          return overrides
        })
        
        // 5 分钟后自动清除覆盖
        Effect.sleep(300_000).pipe(
          Effect.andThen(Effect.sync(() => {
            Ref.update(overridesRef, overrides => {
              overrides.delete(ruleId)
              return overrides
            })
          })),
          Effect.runFork
        )
      })
    
    // 清除所有覆盖
    const clearOverrides = () =>
      Effect.gen(function* () {
        yield* Ref.set(overridesRef, new Map())
      })
    
    return {
      matchRule,
      evaluate,
      addRule,
      addRules,
      removeRule,
      getAllRules,
      temporaryOverride,
      clearOverrides
    }
  })
)