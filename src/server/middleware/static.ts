// src/server/middleware/static.ts
// ====================================================
// 静态文件服务
// ====================================================

import { existsSync } from "fs"
import { CORS_HEADERS } from "./cors.js"

// 静态文件目录：编译模式用 binary 旁边的 web/，开发模式用 ../../../dist/web/
const DIST_WEB_DIR: string = (() => {
  const compiledDir = import.meta.dir + "/web/"
  if (existsSync(compiledDir)) return compiledDir
  return import.meta.dir + "/../../../dist/web/"
})()

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

/** 返回 React 构建产物的静态文件，不存在则 null */
export async function serveStatic(pathname: string): Promise<Response | null> {
  // 规范化路径
  let filePath = pathname.replace(/^\/+/, "") || "index.html"
  
  // 安全检查：防止目录穿越
  if (filePath.includes("..")) return null

  const distPath = DIST_WEB_DIR + filePath
  const distFile = Bun.file(distPath)
  if (await distFile.exists()) {
    const ext = "." + (filePath.split(".").pop() ?? "")
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
    return new Response(distFile, {
      headers: { "Content-Type": contentType, ...CORS_HEADERS },
    })
  }

  return null
}
