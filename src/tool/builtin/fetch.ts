// src/tool/builtin/fetch.ts
import { Effect, Schema } from "effect"
import type { ToolDefinition } from "../types.js"
import { ToolExecutionError } from "../types.js"

const FetchInputSchema = Schema.Struct({
  url: Schema.String,
  query: Schema.optional(Schema.String)
})

export const FetchWebpageTool: ToolDefinition<typeof FetchInputSchema.Type, string> = {
  name: "fetch_webpage",
  description:
    "Fetch and extract the main text content from a web page given its URL. " +
    "Optionally provide a query to search for specific information within the page. " +
    "Use this tool to read documentation, API references, tutorials, blog posts, or any publicly accessible web content.",
  category: "search",
  permission: "read",
  inputSchema: FetchInputSchema,
  defaultEnabled: true,

  execute: (input) =>
    Effect.gen(function* () {
      const url = input.url
      let finalUrl: string = url
      if (!/^https?:\/\//i.test(url)) {
        finalUrl = "https://" + url
      }

      const result = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(finalUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; OpenCodeBot/1.0)",
            },
            signal: AbortSignal.timeout(15_000),
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          const contentType = response.headers.get("content-type") ?? ""
          if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
            throw new Error(`不支持的内容类型: ${contentType}`)
          }

          const html = await response.text()
          return extractText(html, input.query)
        },
        catch: (err) =>
          new ToolExecutionError({
            toolName: "fetch_webpage",
            message: `网页抓取失败: ${String(err)}`,
            cause: err,
          }),
      })

      return result
    }),
}

// ====================================================
// 简易 HTML → 文本提取
// ====================================================

function extractText(html: string, query?: string): string {
  // 去除 script / style / head / nav / footer / header 标签内容
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")

  // 提取 title
  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1]!.trim() : ""

  // 转为纯文本
  let text = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")

  // 按行处理
  const lines = text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  // 如果有查询，只保留包含查询关键词的行及上下文
  if (query) {
    const keywords = query.toLowerCase().split(/\s+/)
    const relevant: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i]!.toLowerCase()
      if (keywords.some((kw) => lower.includes(kw))) {
        // 添加上下文（前后各 2 行）
        const start = Math.max(0, i - 2)
        const end = Math.min(lines.length, i + 3)
        for (let j = start; j < end; j++) {
          if (!relevant.includes(lines[j]!)) {
            relevant.push(lines[j]!)
          }
        }
      }
    }
    if (relevant.length > 0) {
      return (title ? `# ${title}\n\n` : "") + relevant.join("\n")
    }
  }

  return (title ? `# ${title}\n\n` : "") + lines.join("\n")
}
