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
      // allow 为空 → 生成一条 deny-all 规则
      const rule: PermissionRule = {
        id: `config-deny-${cr.pattern.replace(/[^a-zA-Z0-9]/g, "-")}`,
        action: "read" as Action,
        pattern: cr.pattern,
        decision: "deny",
        priority: 25,
        description: cr.description ?? `Blocked by config: ${cr.pattern}`
      }
      if (cr.requireConfirm !== undefined) rule.requireConfirm = cr.requireConfirm
      result.push(rule)
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
  // ==================== 全局文件操作（最低优先级，覆盖绝�?路径） ====================
  {
    id: "read-all-global",
    action: "read",
    pattern: "**/*",
    decision: "allow",
    priority: 1,
    description: "Allow reading any file from any directory (absolute or relative)"
  },
  {
    id: "write-all-global",
    action: "write",
    pattern: "**/*",
    decision: "allow",
    priority: 1,
    description: "Allow writing any file to any directory"
  },
  {
    id: "edit-all-global",
    action: "edit",
    pattern: "**/*",
    decision: "allow",
    priority: 1,
    description: "Allow editing any file in any directory"
  },
  // ==================== 全局命令执行（最低优先�?====================
  {
    id: "execute-dev-commands-global",
    action: "execute",
    pattern: "{npm *,bun *,git *,pnpm *,yarn *,node *,python *,py *,pip *,pip3 *,poetry *,cargo *,go *,rustc *,make *,npx *,tsc *,eslint *,prettier *,deno *,ls *,dir *,cat *,type *,echo *,cd *,mkdir *,copy *,cp *,mv *,ren *,touch *,which *,where *,whoami *,pwd *,printenv *,env *,rm *,rmdir *,chmod *,chown *,curl *,wget *,tar *,zip *,unzip *,gzip *,gunzip *,find *,grep *,sed *,awk *,sort *,uniq *,wc *,head *,tail *,tee *,ping *,traceroute *,nslookup *,ssh *,scp *,rsync *,systeminfo *,tasklist *,taskkill *,netstat *,ipconfig *,set *,export *}",
    decision: "allow",
    priority: 1,
    description: "Allow common development and shell commands"
  },
  {
    id: "shell-dev-commands-global",
    action: "shell",
    pattern: "{npm *,bun *,git *,pnpm *,yarn *,node *,python *,py *,pip *,pip3 *,poetry *,cargo *,go *,rustc *,make *,npx *,tsc *,eslint *,prettier *,deno *,ls,dir,cat,type,echo,cd,mkdir,copy,cp,mv,ren,touch,which,where,whoami,pwd,printenv,env}",
    decision: "allow",
    priority: 1,
    description: "Allow common shell commands"
  },

  // ==================== 文件读取（特定类型，优先级高于全局�?====================
  {
    id: "read-project-files",
    action: "read",
    pattern: "src/**/*.{ts,js,tsx,jsx}",
    decision: "allow",
    priority: 10,
    description: "Read project source files"
  },
  {
    id: "read-docs",
    action: "read",
    pattern: "docs/**/*.md",
    decision: "allow",
    priority: 10,
    description: "Read documentation files"
  },
  {
    id: "read-config-files",
    action: "read",
    pattern: "{package.json,tsconfig.json,.env.example}",
    decision: "allow",
    priority: 10,
    description: "Read configuration files"
  },
  {
    id: "read-sensitive-files",
    action: "read",
    pattern: ".env",
    decision: "deny",
    priority: 20,
    description: "Block sensitive environment files"
  },
  {
    id: "read-git-files",
    action: "read",
    pattern: ".git/**",
    decision: "deny",
    priority: 20,
    description: "Block git directory access"
  },
  {
    id: "read-node-modules",
    action: "read",
    pattern: "node_modules/**",
    decision: "allow",
    priority: 5,
    description: "Read node_modules (low priority)"
  },
  
  // ==================== 文件写入 ====================
  {
    id: "write-source-code",
    action: "write",
    pattern: "src/**/*.{ts,js,tsx,jsx}",
    decision: "allow",
    priority: 10,
    description: "Write source code"
  },
  {
    id: "write-docs",
    action: "write",
    pattern: "docs/**/*.md",
    decision: "allow",
    priority: 10,
    description: "Write documentation"
  },
  {
    id: "write-package-json",
    action: "write",
    pattern: "package.json",
    decision: "ask",
    priority: 15,
    description: "Modify package.json - requires confirmation",
    requireConfirm: true
  },
  {
    id: "write-config",
    action: "write",
    pattern: "{tsconfig.json,.prettierrc.json}",
    decision: "ask",
    priority: 15,
    description: "Modify config files - requires confirmation",
    requireConfirm: true
  },
  {
    id: "write-lock-files",
    action: "write",
    pattern: "{package-lock.json,bun.lock,yarn.lock}",
    decision: "allow",
    priority: 10,
    description: "Lock files can be written automatically"
  },
  
  // ==================== 文件编辑 ====================
  {
    id: "edit-source-code",
    action: "edit",
    pattern: "src/**/*.{ts,js,tsx,jsx}",
    decision: "allow",
    priority: 10,
    description: "Edit source code"
  },
  
  // ==================== 文件删除 ====================
  {
    id: "delete-any",
    action: "delete",
    pattern: "**",
    decision: "deny",
    priority: 100,
    description: "Deletion is completely forbidden"
  },
  
  // ==================== 命令执行 ====================
  {
    id: "execute-npm-safe",
    action: "execute",
    pattern: "{npm install,npm test,npm run build,npm run dev}",
    decision: "allow",
    priority: 10,
    description: "Safe npm commands"
  },
  {
    id: "execute-bun-safe",
    action: "execute",
    pattern: "{bun install*,bun test*,bun run*}",
    decision: "allow",
    priority: 10,
    description: "Safe bun commands"
  },
  {
    id: "execute-git-read",
    action: "execute",
    pattern: "{git status,git diff,git log,git branch}",
    decision: "allow",
    priority: 10,
    description: "Read-only git commands"
  },
  {
    id: "execute-git-write",
    action: "execute",
    pattern: "{git add,git commit,git push,git pull,git merge,git rebase}",
    decision: "ask",
    priority: 15,
    description: "Git write operations need confirmation",
    requireConfirm: true
  },
  {
    id: "execute-dangerous",
    action: "execute",
    pattern: "{rm*,sudo*,chmod*,chown*,kill*,pkill*}",
    decision: "deny",
    priority: 50,
    description: "Dangerous commands are blocked"
  },
  {
    id: "execute-shell-unsafe",
    action: "shell",
    pattern: "{rm*,sudo*,chmod*,chown*}",
    decision: "deny",
    priority: 50,
    description: "Unsafe shell commands are blocked"
  },
  
  // ==================== 网络请求 ====================
  {
    id: "network-ai-apis",
    action: "network",
    pattern: "https://api.openai.com/**",
    decision: "allow",
    priority: 10,
    description: "OpenAI API calls"
  },
  {
    id: "network-anthropic",
    action: "network",
    pattern: "https://api.anthropic.com/**",
    decision: "allow",
    priority: 10,
    description: "Anthropic API calls"
  },
  {
    id: "network-deepseek",
    action: "network",
    pattern: "https://api.deepseek.com/**",
    decision: "allow",
    priority: 10,
    description: "DeepSeek API calls"
  },
  {
    id: "network-npm-registry",
    action: "network",
    pattern: "https://registry.npmjs.org/**",
    decision: "allow",
    priority: 10,
    description: "NPM registry"
  },
  {
    id: "network-localhost",
    action: "network",
    pattern: "http://localhost:*",
    decision: "ask",
    priority: 15,
    description: "Local network requests need confirmation",
    requireConfirm: true
  },
  
  // ==================== 环境变量 ====================
  {
    id: "env-read-safe",
    action: "env",
    pattern: "{NODE_ENV,CI,PORT}",
    decision: "allow",
    priority: 10,
    description: "Safe environment variables"
  },
  {
    id: "env-read-sensitive",
    action: "env",
    pattern: "{*KEY,*SECRET,*TOKEN,*PASSWORD}",
    decision: "ask",
    priority: 15,
    description: "Sensitive environment variables need confirmation",
    requireConfirm: true
  }
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