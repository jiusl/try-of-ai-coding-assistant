// src/server/router.ts
// ====================================================
// 简单路由：路径匹配 + 参数提取
// ====================================================

import type { HttpMethod, Route, RequestContext } from "./types.js"

/** 将路由路径转为正则（支持 :param 参数） */
function pathToRegex(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  // 先提取 :param 参数名，再用正则捕获组替换
  const regexStr = pattern
    .replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name)
      return "([^/]+)"
    })
    .replace(/\//g, "\\/")
  return {
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  }
}

/** 预编译的路由条目 */
interface CompiledRoute {
  method: HttpMethod
  regex: RegExp
  paramNames: string[]
  handler: Route["handler"]
}

/** 路由表 */
export class Router {
  private routes: CompiledRoute[] = []

  /** 注册路由 */
  add(method: HttpMethod, path: string, handler: Route["handler"]): this {
    const { regex, paramNames } = pathToRegex(path)
    this.routes.push({ method, regex, paramNames, handler })
    return this
  }

  /** 便捷方法 */
  get(path: string, handler: Route["handler"]) { return this.add("GET", path, handler) }
  post(path: string, handler: Route["handler"]) { return this.add("POST", path, handler) }
  put(path: string, handler: Route["handler"]) { return this.add("PUT", path, handler) }
  delete(path: string, handler: Route["handler"]) { return this.add("DELETE", path, handler) }
  patch(path: string, handler: Route["handler"]) { return this.add("PATCH", path, handler) }

  /** 匹配请求并返回 handler + 参数，找不到返回 null */
  match(method: string, pathname: string): { handler: Route["handler"]; ctx: RequestContext } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue

      const match = route.regex.exec(pathname)
      if (!match) continue

      const params: Record<string, string> = {}
      for (let i = 0; i < route.paramNames.length; i++) {
        const name = route.paramNames[i]!
        const value = match[i + 1]
        if (value !== undefined) params[name] = decodeURIComponent(value)
      }

      return {
        handler: route.handler,
        ctx: {
          request: null as unknown as Request, // 将由外层填充
          params,
          query: new URLSearchParams(),
        },
      }
    }
    return null
  }
}
