// src/permission/permission.ts
import { Context, Effect, Layer, Option, Ref } from "effect"
import type { 
  Action, 
  Decision, 
  PermissionRequest, 
  PermissionRule,
  PermissionContext 
} from "./types.js"
import { PermissionDeniedError, PermissionAskError, matchesPattern } from "./types.js"
import { RuleEngineService } from "./rule-engine.js"
import { Config } from "../config/config.js"
import type { PermissionRule as ConfigPermissionRule } from "../config/config.js"

// ====================================================
// 配置规则转换器：将 try.json 的 rules 格式 转换为 PermissionRule 格式
// ====================================================

const convertConfigRules = (configRules: ConfigPermissionRule[]): PermissionRule[] => {
  const result: PermissionRule[] = []
  
  for (const cr of configRules) {
    const actions = cr.allow ?? []
    
    if (actions.length === 0) {
      // allow 为空 → 对 read/write/edit 各生成一条 deny 规则
      for (const denyAction of ["read", "write", "edit"] as Action[]) {
        const rule: PermissionRule = {
          id: `config-deny-${denyAction}-${cr.pattern.replace(/[^a-zA-Z0-9]/g, "-")}`,
          action: denyAction,
          pattern: cr.pattern,
          decision: "deny",
          priority: 25,
          description: cr.description ?? `禁止 ${denyAction}: ${cr.pattern}`
        }
        if (cr.requireConfirm !== undefined) rule.requireConfirm = cr.requireConfirm
        result.push(rule)
      }
    } else {
      // 为每个 action 生成一条 allow 规则
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]!
        const rule: PermissionRule = {
          id: `config-${action}-${cr.pattern.replace(/[^a-zA-Z0-9]/g, "-")}`,
          action: action as Action,
          pattern: cr.pattern,
          decision: "allow",
          priority: 20,
          description: cr.description ?? `Allow ${action} on ${cr.pattern}`
        }
        if (cr.requireConfirm !== undefined) rule.requireConfirm = cr.requireConfirm
        result.push(rule)
      }
    }
  }
  
  return result
}

// ====================================================
// 默认规则配置
// ====================================================

export const DEFAULT_RULES: PermissionRule[] = [
  // ================================================================
  // 优先级分层：
  //   P0 (0)  — 全局兜底允许
  //   P10 (10) — 需确认的敏感操作
  //   P30 (30) — 安全拒绝（.env / .git / 删除）
  //   P50 (50) — 危险命令拒绝
  // ================================================================

  // ==================== P0: 全局兜底 — 允许所有文件读写（含 dotfile）、常用命令 ====================
  {
    id: "file-read-all",
    action: "read",
    pattern: "**/{*,.*}",
    decision: "allow",
    priority: 0,
    description: "允许读取任意文件（含 dotfile 和绝对路径）"
  },
  {
    id: "file-write-all",
    action: "write",
    pattern: "**/{*,.*}",
    decision: "allow",
    priority: 0,
    description: "允许写入任意文件（含 dotfile 和绝对路径）"
  },
  {
    id: "file-edit-all",
    action: "edit",
    pattern: "**/{*,.*}",
    decision: "allow",
    priority: 0,
    description: "允许编辑任意文件（含 dotfile 和绝对路径）"
  },
  {
    id: "cmd-common-all",
    action: "execute",
    pattern: "{npm,bun,git,pnpm,yarn,node,python,py,pip,pip3,poetry,cargo,go,rustc,make,npx,tsc,eslint,prettier,deno,ls,dir,cat,type,echo,cd,mkdir,copy,cp,mv,ren,touch,which,where,whoami,pwd,printenv,env,rm,rmdir,chmod,chown,curl,wget,tar,zip,unzip,gzip,gunzip,find,grep,sed,awk,sort,uniq,wc,head,tail,tee,ping,traceroute,nslookup,ssh,scp,rsync,systeminfo,tasklist,taskkill,netstat,ipconfig,set,export}",
    decision: "allow",
    priority: 0,
    description: "允许常用开发和系统命令"
  },
  {
    id: "shell-common-all",
    action: "shell",
    pattern: "{npm,bun,git,pnpm,yarn,node,python,py,pip,pip3,poetry,cargo,go,rustc,make,npx,tsc,eslint,prettier,deno,ls,dir,cat,type,echo,cd,mkdir,copy,cp,mv,ren,touch,which,where,whoami,pwd,printenv,env}",
    decision: "allow",
    priority: 0,
    description: "允许常用 Shell 命令"
  },

  // ==================== P10: 敏感操作 — 需用户确认 ====================
  {
    id: "write-package-json",
    action: "write",
    pattern: "**/package.json",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "修改 package.json 需确认"
  },
  {
    id: "edit-package-json",
    action: "edit",
    pattern: "**/package.json",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "编辑 package.json 需确认"
  },
  {
    id: "write-tsconfig",
    action: "write",
    pattern: "**/tsconfig*.json",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "修改 tsconfig 需确认"
  },
  {
    id: "edit-tsconfig",
    action: "edit",
    pattern: "**/tsconfig*.json",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "编辑 tsconfig 需确认"
  },
  {
    id: "write-prettier-eslint",
    action: "write",
    pattern: "**/{.prettierrc,.prettierrc.json,.eslintrc,.eslintrc.json,.eslint.config.*}",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "修改 Prettier/ESLint 配置需确认"
  },
  {
    id: "edit-prettier-eslint",
    action: "edit",
    pattern: "**/{.prettierrc,.prettierrc.json,.eslintrc,.eslintrc.json,.eslint.config.*}",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "编辑 Prettier/ESLint 配置需确认"
  },
  // pip install/uninstall 需确认
  {
    id: "pip-install-confirm",
    action: "execute",
    pattern: "{pip install,pip3 install,python -m pip install,python3 -m pip install}",
    decision: "allow",
    requireConfirm: true,
    priority: 10,
    description: "pip install 需确认"
  },
  {
    id: "pip-uninstall-confirm",
    action: "execute",
    pattern: "{pip uninstall,pip3 uninstall,pip remove,pip3 remove,python -m pip uninstall,python3 -m pip uninstall}",
    decision: "allow",
    requireConfirm: true,
    priority: 10,
    description: "pip uninstall 需确认"
  },
  // Git 写操作需确认
  {
    id: "git-write-confirm",
    action: "execute",
    pattern: "{git add,git commit,git push,git pull,git merge,git rebase}",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "Git 写操作需确认"
  },
  // 本地网络请求需确认
  {
    id: "net-localhost-confirm",
    action: "network",
    pattern: "http://localhost:*",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "本地网络请求需确认"
  },
  // 敏感环境变量需确认
  {
    id: "env-sensitive-confirm",
    action: "env",
    pattern: "{*KEY,*SECRET,*TOKEN,*PASSWORD}",
    decision: "ask",
    priority: 10,
    requireConfirm: true,
    description: "敏感环境变量需确认"
  },

  // ==================== P30: 安全拒绝 ====================
  {
    id: "block-env",
    action: "read",
    pattern: "**/.env",
    decision: "deny",
    priority: 30,
    description: "禁止读取 .env 文件"
  },
  {
    id: "block-write-env",
    action: "write",
    pattern: "**/.env",
    decision: "deny",
    priority: 30,
    description: "禁止写入 .env 文件"
  },
  {
    id: "block-edit-env",
    action: "edit",
    pattern: "**/.env",
    decision: "deny",
    priority: 30,
    description: "禁止编辑 .env 文件"
  },
  {
    id: "block-git",
    action: "read",
    pattern: "**/.git/**",
    decision: "deny",
    priority: 30,
    description: "禁止访问 .git 目录"
  },
  {
    id: "block-write-git",
    action: "write",
    pattern: "**/.git/**",
    decision: "deny",
    priority: 30,
    description: "禁止写入 .git 目录"
  },
  {
    id: "block-delete",
    action: "delete",
    pattern: "**/{*,.*}",
    decision: "deny",
    priority: 30,
    description: "禁止删除文件"
  },

  // ==================== P50: 危险命令拒绝 ====================
  {
    id: "block-dangerous-exec",
    action: "execute",
    pattern: "{sudo,chmod,chown,kill,pkill}",
    decision: "deny",
    priority: 50,
    description: "禁止危险命令"
  },
  {
    id: "block-dangerous-shell",
    action: "shell",
    pattern: "{sudo,chmod,chown}",
    decision: "deny",
    priority: 50,
    description: "禁止危险 Shell 命令"
  },

  // ==================== P20: AI API 网络 ====================
  {
    id: "net-openai",
    action: "network",
    pattern: "https://api.openai.com/**",
    decision: "allow",
    priority: 20,
    description: "OpenAI API"
  },
  {
    id: "net-anthropic",
    action: "network",
    pattern: "https://api.anthropic.com/**",
    decision: "allow",
    priority: 20,
    description: "Anthropic API"
  },
  {
    id: "net-deepseek",
    action: "network",
    pattern: "https://api.deepseek.com/**",
    decision: "allow",
    priority: 20,
    description: "DeepSeek API"
  },
  {
    id: "net-npm",
    action: "network",
    pattern: "https://registry.npmjs.org/**",
    decision: "allow",
    priority: 20,
    description: "NPM Registry"
  },

  // ==================== P5: 安全环境变量 ====================
  {
    id: "env-safe",
    action: "env",
    pattern: "{NODE_ENV,CI,PORT}",
    decision: "allow",
    priority: 5,
    description: "安全环境变量"
  },
]

// ====================================================
// 服务接口
// ====================================================

export interface PermissionService {
  /** 检查权限（不询问用户） */
  readonly check: (
    action: Action,
    target: string,
    metadata?: PermissionRequest["metadata"]
  ) => Effect.Effect<Decision, PermissionDeniedError>
  
  /** 请求权限（如果 needAsk 则询问用户） */
  readonly request: (
    action: Action,
    target: string,
    metadata?: PermissionRequest["metadata"]
  ) => Effect.Effect<void, PermissionDeniedError | PermissionAskError>
  
  /** 响应用户决策 */
  readonly respond: (
    requestId: string,
    approved: boolean,
    remember?: boolean
  ) => Effect.Effect<void>
  
  /** 获取当前会话的权限上下文 */
  readonly getContext: () => Effect.Effect<PermissionContext>
  
  /** 临时授予权限（用于当前操作） */
  readonly grantTemporary: (
    action: Action,
    target: string,
    durationMs: number
  ) => Effect.Effect<void>
  
  /** 加载默认规则 */
  readonly loadDefaultRules: () => Effect.Effect<void>
  
  /** 添加自定义规则 */
  readonly addRule: (rule: PermissionRule) => Effect.Effect<void>
  
  /** 移除规则 */
  readonly removeRule: (ruleId: string) => Effect.Effect<void>
  
  /** 获取所有规则 */
  readonly getAllRules: () => Effect.Effect<readonly PermissionRule[]>
  
  /** 清除所有临时授权 */
  readonly clearTemporaryGrants: () => Effect.Effect<void>
}

export class Permission extends Context.Tag("Permission")<
  Permission,
  PermissionService
>() {}

// ====================================================
// Live Layer
// ====================================================

export const PermissionLive = Layer.effect(
  Permission,
  Effect.gen(function* () {
    const ruleEngine = yield* RuleEngineService
    const config = yield* Config
    
    // 存储等待用户确认的请求
    const pendingRequests = yield* Ref.make<Map<string, PermissionRequest>>(new Map())
    
    // 临时授权缓存（带过期时间）
    const temporaryGrants = yield* Ref.make<Map<string, { expiresAt: number }>>(new Map())
    
    // 稳定的会话标识 & 批准记录
    const sessionId = crypto.randomUUID()
    const recentApprovals = yield* Ref.make<Set<string>>(new Set())
    
    // 加载默认规则
    yield* ruleEngine.addRules(DEFAULT_RULES)
    
    // 从配置文件加载自定义规则（转换 config 格式到 permission 格式）
    const customRules = yield* config.getPermissions()
    if (customRules.length > 0) {
      yield* ruleEngine.addRules(convertConfigRules(customRules))
    }
    
    // 获取当前上下文（sessionId 稳定，recentApprovals 可累积）
    const getContext = (): Effect.Effect<PermissionContext> =>
      Effect.gen(function* () {
        const approvals = yield* Ref.get(recentApprovals)
        return {
          sessionId,
          projectPath: process.cwd(),
          isCI: process.env.CI === "true",
          isInteractive: process.stdin.isTTY ?? false,
          recentApprovals: approvals
        } as PermissionContext
      })
    
    // 检查权限
    const check = (
      action: Action,
      target: string,
      metadata?: PermissionRequest["metadata"]
    ): Effect.Effect<Decision, PermissionDeniedError> =>
      Effect.gen(function* () {
        // 1. 检查临时授权缓存
        const grantKey = `${action}:${target}`
        const grants = yield* Ref.get(temporaryGrants)
        const grant = grants.get(grantKey)
        
        if (grant && grant.expiresAt > Date.now()) {
          return "allow" as Decision
        }
        
        // 2. 清理过期的临时授权
        const now = Date.now()
        for (const [key, value] of grants) {
          if (value.expiresAt <= now) {
            yield* Ref.update(temporaryGrants, map => {
              map.delete(key)
              return map
            })
          }
        }
        
        // 3. 评估规则
        const context = yield* getContext()
        const request: PermissionRequest = {
          action,
          target,
          context,
          ...(metadata ? { metadata } : {})
        } as PermissionRequest
        const decision = yield* ruleEngine.evaluate(request)
        
        return decision
      })
    
    // 请求权限（支持用户交互）
    const request = (
      action: Action,
      target: string,
      metadata?: PermissionRequest["metadata"]
    ) =>
      Effect.gen(function* () {
        const decision = yield* check(action, target, metadata)
        
        switch (decision) {
          case "allow":
            return Effect.void
          
          case "deny":
            return yield* Effect.fail(new PermissionDeniedError({
              action,
              target,
              reason: "权限规则拒绝此操作"
            }))
          
          case "ask":
            const context = yield* getContext()
            const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
            const requestObj: PermissionRequest = {
              action,
              target,
              context,
              ...(metadata ? { metadata } : {})
            } as PermissionRequest
            
            yield* Ref.update(pendingRequests, map => map.set(requestId, requestObj))
            
            // 构建提示消息
            let message = `⚠️  Permission Request\n`
            message += `  Action: ${action}\n`
            message += `  Target: ${target}\n`
            if (metadata?.command) {
              message += `  Command: ${metadata.command}\n`
            }
            if (metadata?.fileSize) {
              message += `  File Size: ${metadata.fileSize} bytes\n`
            }
            message += `\n  Allow this operation? (y/N)`
            
            return yield* Effect.fail(new PermissionAskError({
              action,
              target,
              message,
              requestId
            }))
        }
      })
    
    // 响应用户决策
    const respond = (
      requestId: string,
      approved: boolean,
      remember: boolean = false
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const requestMap = yield* Ref.get(pendingRequests)
        const request = requestMap.get(requestId)
        
        if (!request) return
        
        if (approved) {
          // 记录到最近批准集合（用于条件评估）
          yield* Ref.update(recentApprovals, s => s.add(request.target))
          
          if (remember) {
            // 添加永久规则
            const rule: PermissionRule = {
              id: `user_approved_${requestId}`,
              action: request.action,
              pattern: request.target,
              decision: "allow",
              priority: 100,
              description: `User approved: ${request.action} on ${request.target}`,
              requireConfirm: false
            }
            yield* ruleEngine.addRule(rule).pipe(
              Effect.catchAll(() => Effect.void)
            )
          } else {
            // 临时授权（30 秒）
            const grantKey = `${request.action}:${request.target}`
            yield* Ref.update(temporaryGrants, map =>
              map.set(grantKey, { expiresAt: Date.now() + 30000 })
            )
          }
        }
        
        yield* Ref.update(pendingRequests, map => {
          map.delete(requestId)
          return map
        })
      })
    
    // 临时授予权限
    const grantTemporary = (action: Action, target: string, durationMs: number) =>
      Effect.gen(function* () {
        const grantKey = `${action}:${target}`
        yield* Ref.update(temporaryGrants, map =>
          map.set(grantKey, { expiresAt: Date.now() + durationMs })
        )
        
        // 自动清理（daemon fiber，不阻塞作用域关闭）
        yield* Effect.sleep(durationMs).pipe(
          Effect.andThen(Ref.update(temporaryGrants, map => {
            map.delete(grantKey)
            return map
          })),
          Effect.forkDaemon,
          Effect.asVoid
        )
      })
    
    // 加载默认规则（重置）
    const loadDefaultRules = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        // 清除所有非用户规则
        const existingRules = yield* ruleEngine.getAllRules()
        for (const rule of existingRules) {
          if (!rule.id.startsWith("user_")) {
            yield* ruleEngine.removeRule(rule.id).pipe(
              Effect.catchAll(() => Effect.void)
            )
          }
        }
        // 清除临时授权和批准记录
        yield* Ref.set(temporaryGrants, new Map())
        yield* Ref.set(recentApprovals, new Set())
        // 重新加载默认规则
        yield* ruleEngine.addRules(DEFAULT_RULES).pipe(
          Effect.catchAll(() => Effect.void)
        )
      })
    
    // 添加自定义规则
    const addRule = (rule: PermissionRule): Effect.Effect<void> =>
      ruleEngine.addRule(rule).pipe(
        Effect.catchAll(() => Effect.void)
      )
    
    // 移除规则
    const removeRule = (ruleId: string): Effect.Effect<void> =>
      ruleEngine.removeRule(ruleId).pipe(
        Effect.catchAll(() => Effect.void)
      )
    
    // 获取所有规则
    const getAllRules = (): Effect.Effect<readonly PermissionRule[]> =>
      ruleEngine.getAllRules()
    
    // 清除所有临时授权
    const clearTemporaryGrants = (): Effect.Effect<void> =>
      Ref.set(temporaryGrants, new Map())
    
    return {
      check,
      request,
      respond,
      getContext,
      grantTemporary,
      loadDefaultRules,
      addRule,
      removeRule,
      getAllRules,
      clearTemporaryGrants
    }
  })
)

// ====================================================
// Mock 版本（用于测试）
// ====================================================

export const PermissionMockLive = Layer.succeed(Permission, {
  check: () => Effect.succeed("allow" as Decision),
  request: () => Effect.void,
  respond: () => Effect.void,
  getContext: () =>
    Effect.succeed({
      sessionId: "mock",
      userId: "mock-user",
      projectPath: "/mock/project",
      isCI: false,
      isInteractive: true,
      recentApprovals: new Set()
    }),
  grantTemporary: () => Effect.void,
  loadDefaultRules: () => Effect.void,
  addRule: () => Effect.void,
  removeRule: () => Effect.void,
  getAllRules: () => Effect.succeed([]),
  clearTemporaryGrants: () => Effect.void
})

// ====================================================
// 严格模式版本（默认拒绝所有需要确认的操作）
// ====================================================

export const PermissionStrictLive = Layer.effect(
  Permission,
  Effect.gen(function* () {
    const base = yield* Permission
    
    return {
      ...base,
      request: (action: Action, target: string, metadata?: PermissionRequest["metadata"]) =>
        Effect.gen(function* () {
          const decision = yield* base.check(action, target, metadata)
          
          if (decision === "ask") {
            return yield* Effect.fail(new PermissionDeniedError({
              action,
              target,
              reason: "严格模式：需要用户确认的操作被拒绝"
            }))
          }
          
          return yield* base.request(action, target, metadata)
        })
    } satisfies PermissionService
  })
)