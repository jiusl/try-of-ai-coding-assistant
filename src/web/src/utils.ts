// src/web/src/utils.ts
// ====================================================
// 公共工具函数
// ====================================================

/** 格式化相对时间 */
export function formatTime(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return "刚刚"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  const days = Math.floor(diff / 86400000)
  if (days < 7) return `${days}天前`
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}
