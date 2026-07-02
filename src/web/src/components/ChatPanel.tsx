// src/web/src/components/ChatPanel.tsx
// ====================================================
// 聊天面板 — SSE 流式消息、消息列表、输入框
// ====================================================

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Box, Button, HStack, IconButton, Textarea, Text, VStack, Badge,
} from "@chakra-ui/react"
import type { ChatMessage, ConfirmRequest, StreamSegment } from "../types"
import * as api from "../api"
import { ChatBubble } from "./ChatBubble"
import { ConfirmDialog } from "./ConfirmDialog"
import { MiniTimeline } from "./MiniTimeline"
import { ModelSelectorBar } from "./ModelSelectorBar"
import { useToast } from "./Toast"

interface ChatPanelProps {
  sessionId: string | null
  agentId: string
  messages: ChatMessage[]
  onMessagesChange: (msgs: ChatMessage[]) => void
  onProcessingChange: (processing: boolean) => void
  /** 每次对话完成（成功/超限）后触发，用于刷新配额 UI */
  onChatComplete?: () => void
  /** Tab 键循环切换 Agent 回调 (1=下一个, -1=上一个) */
  onCycleAgent?: (direction: 1 | -1) => void
}

/** 欢迎界面（无消息时） */
function WelcomeScreen({ onQuickAction }: { onQuickAction: (prompt: string) => void }) {
  return (
    <VStack flex={1} justify="center" gap={4} color="gray.500">
      <Text fontSize="5xl">🤖</Text>
      <Text fontSize="2xl" fontWeight="bold" color="gray.300">欢迎使用 Try</Text>
      <Text>AI 驱动的编程助手，帮助你编码、调试和重构。</Text>
      <HStack gap={3} flexWrap="wrap" justify="center" maxW="600px" mt={2}>
        {[
          { icon: "📂", label: "分析项目", prompt: "帮我分析这个项目的整体结构和架构" },
          { icon: "💡", label: "解释代码", prompt: "帮我解释这段代码的作用和原理" },
          { icon: "✏️", label: "编写代码", prompt: "帮我编写一个功能函数：" },
          { icon: "🔍", label: "代码审查", prompt: "帮我审查以下代码，找出潜在问题和改进点" },
        ].map((qa) => (
          <Button
            key={qa.label}
            size="sm"
            variant="outline"
            borderColor="gray.700"
            color="gray.400"
            _hover={{ bg: "gray.800", color: "white" }}
            onClick={() => onQuickAction(qa.prompt)}
          >
            {qa.icon} {qa.label}
          </Button>
        ))}
      </HStack>
    </VStack>
  )
}

/** 已附加的引用文件 */
export interface AttachedFile {
  name: string
  size: number
  content: string   // 文件内容（浏览器端通过 FileReader 读取）
}

/** 最大引用文件数 */
const MAX_ATTACHED_FILES = 10
/** 单文件最大 200KB，超出不读取（避免消耗过多 token） */
const MAX_FILE_SIZE = 200 * 1024

/** 允许读取的文本文件扩展名白名单 */
const ALLOWED_EXTENSIONS = new Set([
  // 代码
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java", ".kt", ".kts",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".hh", ".cs", ".swift", ".scala", ".rb", ".php",
  ".lua", ".r", ".jl", ".dart", ".ex", ".exs", ".erl", ".hrl", ".hs", ".ml", ".mli",
  ".clj", ".cljs", ".edn", ".elm", ".v", ".vh", ".sv", ".zig", ".nim", ".cr",
  // 配置 / 数据
  ".json", ".jsonc", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".xml", ".csv", ".tsv", ".env", ".properties", ".editorconfig",
  // 文档
  ".md", ".mdx", ".txt", ".log", ".rst", ".tex", ".adoc", ".org",
  // Web
  ".html", ".htm", ".css", ".scss", ".less", ".sass", ".svg",
  // Shell / 脚本
  ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".psd1", ".bat", ".cmd",
  // 数据库
  ".sql", ".prisma", ".graphql", ".gql",
  // 其他文本
  ".dockerfile", ".gitignore", ".gitattributes", ".makefile", ".cmake",
  ".proto", ".tf", ".hcl", ".nginx",
])

/** 检查文件名是否在允许的白名单内 */
function isAllowedFileType(name: string): boolean {
  const lower = name.toLowerCase()
  // 特殊无扩展名文件
  const basenames = new Set(["dockerfile", "makefile", "gemfile", "rakefile", "procfile", "vagrantfile"])
  const base = lower.split("/").pop()!.split("\\").pop()!
  if (basenames.has(base)) return true
  // 按扩展名判断
  const dot = base.lastIndexOf(".")
  if (dot === -1) return false
  return ALLOWED_EXTENSIONS.has(base.slice(dot))
}

/** 读取文件内容为文本 */
function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("读取失败"))
    reader.readAsText(file)
  })
}

export function ChatPanel({
  sessionId,
  agentId,
  messages,
  onMessagesChange,
  onProcessingChange,
  onChatComplete,
  onCycleAgent,
}: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState("")
  const [streamSegments, setStreamSegments] = useState<StreamSegment[]>([])
  const [showWelcome, setShowWelcome] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const confirmResolveRef = useRef<((approved: boolean) => void) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  // ── 滚动位置追踪（用于显示"回到底部"浮动按钮）──
  const [isAtBottom, setIsAtBottom] = useState(true)
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setIsAtBottom(nearBottom)
  }, [])

  // ── 文件引用状态 ──
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  /** dragenter/dragleave 计数器，避免子元素导致闪烁 */
  const dragCounterRef = useRef(0)

  // 添加文件到引用列表（异步读取内容）
  const addAttachedFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (arr.length === 0) return

    // 预检：过滤不支持格式和过大文件
    const validFiles: File[] = []
    let rejectedFormat = false
    let rejectedSize = false
    for (const file of arr) {
      if (!isAllowedFileType(file.name)) {
        rejectedFormat = true
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        rejectedSize = true
        continue
      }
      validFiles.push(file)
    }

    // 汇总提醒
    if (rejectedFormat) {
      toast.warning("格式不支持", "仅支持文本类文件（代码/配置/文档等），二进制文件已跳过")
    }
    if (rejectedSize) {
      toast.warning("文件过大", `单文件上限 ${MAX_FILE_SIZE / 1024}KB，已跳过超大文件`)
    }

    if (validFiles.length === 0) return

    // 先添加占位文件（content 为空），让 UI 立即反馈
    const placeholders: AttachedFile[] = []
    for (const file of validFiles) {
      if (placeholders.length >= MAX_ATTACHED_FILES) {
        toast.warning("已达上限", `最多引用 ${MAX_ATTACHED_FILES} 个文件`)
        break
      }
      placeholders.push({ name: file.name, size: file.size, content: "" })
    }
    if (placeholders.length === 0) return

    setAttachedFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      const toAdd = placeholders.filter((p) => !names.has(p.name))
      return [...prev, ...toAdd.slice(0, MAX_ATTACHED_FILES - prev.length)]
    })

    // 异步读取所有文件内容，读完后按顺序填充
    const readPromises = placeholders.map((p, i) =>
      readFileContent(validFiles[i]!).then(
        (content): { idx: number; name: string; content: string; error?: boolean } => ({ idx: i, name: p.name, content }),
        (_err): { idx: number; name: string; content: string; error?: boolean } => ({ idx: i, name: p.name, content: "", error: true }),
      )
    )

    const results = await Promise.all(readPromises)

    setAttachedFiles((prev) => {
      const updated = [...prev]
      for (const r of results) {
        const existing = updated.findIndex((f) => f.name === r.name)
        if (existing !== -1) {
          updated[existing] = { ...updated[existing]!, content: r.error ? "" : r.content }
        }
      }
      return updated
    })
  }, [toast])

  // 移除文件
  const removeAttachedFile = useCallback((idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  // ── 拖拽事件（统一放在最外层，用计数器防止子元素触发闪烁）──

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 仅当拖入的是文件时才点亮
    if (!e.dataTransfer.types.includes("Files")) return
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy"
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      addAttachedFiles(e.dataTransfer.files)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addAttachedFiles])

  // ── 文件选择按钮 ──

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addAttachedFiles(e.target.files)
      // 重置 input 以便可以再次选择相同文件
      e.target.value = ""
    }
  }, [addAttachedFiles])

  // 自动滚动
  const scrollToBottom = useCallback((force = false) => {
    const el = scrollContainerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (force || isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: force ? "smooth" : "auto" })
      if (force) setIsAtBottom(true)
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamContent, streamSegments, scrollToBottom])

  // 处理状态同步给父组件
  const updateProcessing = useCallback((val: boolean) => {
    setIsProcessing(val)
    onProcessingChange(val)
  }, [onProcessingChange])

  // 发送消息
  const handleSend = useCallback(async (text?: string) => {
    const message = (text || input.trim())
    if (!message || isProcessing) return
    if (!sessionId) return

    setInput("")
    setShowWelcome(false)
    updateProcessing(true)
    setIsStreaming(true)
    setStreamContent("")
    setStreamSegments([])

    // 读取完成的文件，content 非空才注入
    const attachedContents = attachedFiles.filter((f) => f.content)
    setAttachedFiles([])

    // 将文件内容内联注入到消息中（不依赖文件路径，浏览器安全限制不暴露路径）
    let enrichedMessage = message
    if (attachedContents.length > 0) {
      const blocks = attachedContents.map((f, i) => {
        // 对过长内容做截断
        const truncated = f.content.length > 8000
          ? f.content.slice(0, 8000) + `\n... (文件过长，已截断，原 ${f.content.length} 字符)`
          : f.content
        return `### 📄 ${f.name}\n\`\`\`\n${truncated}\n\`\`\``
      })
      enrichedMessage = `用户上传了以下 ${attachedContents.length} 个文件（内容已完整提供在下方的代码块中，**请直接使用这些内容，切勿调用 read_file 或其他文件读取工具去查找这些文件**）：\n\n${blocks.join("\n\n")}\n\n---\n\n${message}`
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    }
    const newMessages = [...messages, userMsg]
    onMessagesChange(newMessages)

    // 强制滚动到底部，确保用户能看到自己刚发的消息
    requestAnimationFrame(() => scrollToBottom(true))

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const token = api.getAuthToken()
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (token) headers["Authorization"] = `Bearer ${token}`

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId, message, enrichedMessage, agentId }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as Record<string, unknown>))
        const errMsg = body.error?.message || (res.status === 401 ? "登录已过期，请重新登录" : `请求失败 (${res.status})`)
        const err = new Error(errMsg) as Error & { status: number; details?: Record<string, string> }
        err.status = res.status
        if (body.error?.details) err.details = body.error.details as Record<string, string>
        throw err
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response body")

      const decoder = new TextDecoder()
      let buffer = ""
      let fullContent = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        let currentEvent = ""
        for (const line of lines) {
          const trimmed = line.trim()
          // 空行表示 SSE 事件边界，重置 currentEvent
          if (!trimmed) {
            currentEvent = ""
            continue
          }
          // 追踪 SSE event: 行
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7)
            continue
          }
          if (!trimmed.startsWith("data: ")) continue
          const data = trimmed.slice(6)
          if (data === "[DONE]") continue

          try {
            const parsed = JSON.parse(data)
            const eventType = currentEvent || parsed.type
            switch (eventType) {
              case "chunk":
                fullContent += parsed.content
                setStreamContent(fullContent)
                break
              case "tool_call":
                setStreamSegments((prev) => [...prev, {
                  type: "tool",
                  payload: {
                    tool: parsed.tool || "工具",
                    arguments: parsed.arguments || "",
                    result: null,
                  },
                }])
                break
              case "tool_result":
                setStreamSegments((prev) => {
                  const last = prev[prev.length - 1]
                  if (last?.type === "tool" && last.payload.result === null) {
                    const updated = [...prev]
                    updated[updated.length - 1] = {
                      ...last,
                      payload: { ...last.payload, result: parsed.result || "" },
                    }
                    return updated
                  }
                  return prev
                })
                break
              case "done":
                // Finalize — 工具调用不存入 messages，仅保留 assistant 回复
                const doneContent = parsed.content || fullContent
                const assistantMsg: ChatMessage = {
                  role: "assistant",
                  content: doneContent,
                  timestamp: new Date().toISOString(),
                }
                onMessagesChange([...newMessages, assistantMsg])
                setIsStreaming(false)
                setStreamContent("")
                setStreamSegments([])
                updateProcessing(false)
                return
              case "error":
                throw new Error(parsed.error || "Stream error")
              case "phase":
                // Just log phase changes
                console.log("Phase:", parsed.phase)
                break
              case "request_confirm":
                // 显示确认弹窗，等待用户操作
                setConfirmRequest({
                  sessionId,
                  toolCallId: parsed.toolCallId || "",
                  toolName: parsed.toolName || "未知工具",
                  args: parsed.arguments || {},
                  message: parsed.reason || `Agent 想要执行 "${parsed.toolName || "工具"}"`,
                })
                setConfirmOpen(true)
                break
            }
          } catch (e: any) {
            if (e.message?.includes("Stream error") || e.message?.includes("HTTP")) throw e
            console.warn("SSE parse error:", e)
          }
        }
      }

      // 如果流自然结束（没有 done 事件）
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: fullContent,
        timestamp: new Date().toISOString(),
      }
      onMessagesChange([...newMessages, assistantMsg])
    } catch (e: any) {
      if (e.name === "AbortError") return
      // 401 特殊处理 — 提示用户重新登录
      if (e.status === 401) {
        toast.error("登录失效", "登录已过期，请刷新页面重新登录")
        const errorMsg: ChatMessage = {
          role: "assistant",
          content: "🔒 登录已过期，请刷新页面重新登录",
          timestamp: new Date().toISOString(),
        }
        onMessagesChange([...newMessages, errorMsg])
      } else if (e.status === 429) {
        // 配额超限 — 解析 resetAt 并展示友好重置时间
        const resetAt = (e as Error & { details?: Record<string, string> }).details?.resetAt
        let resetHint = "请明天再试或升级等级"
        if (resetAt) {
          const resetDate = new Date(resetAt)
          const now = new Date()
          const diffMs = resetDate.getTime() - now.getTime()
          const diffH = Math.ceil(diffMs / 3600000)
          if (diffH <= 1) resetHint = "即将重置，请稍候"
          else if (diffH <= 8) resetHint = `预计 ${diffH} 小时后重置`
          else resetHint = `预计明天 ${resetDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })} 重置`
        }
        toast.warning("配额已用尽", `${e.message || "今日对话次数已达上限"}，${resetHint}`)
        const errorMsg: ChatMessage = {
          role: "assistant",
          content: `🚫 ${e.message || "配额已用尽"}，${resetHint}。`,
          timestamp: new Date().toISOString(),
        }
        onMessagesChange([...newMessages, errorMsg])
      } else {
        toast.error("请求失败", e.message || "未知错误")
        const errorMsg: ChatMessage = {
          role: "assistant",
          content: `❌ 错误: ${e.message || "未知错误"}`,
          timestamp: new Date().toISOString(),
        }
        onMessagesChange([...newMessages, errorMsg])
      }
    } finally {
      setIsStreaming(false)
      setStreamContent("")
      setStreamSegments([])
      updateProcessing(false)
      abortRef.current = null
      onChatComplete?.()
    }
  }, [input, isProcessing, sessionId, agentId, messages, attachedFiles, onMessagesChange, updateProcessing, onChatComplete])

  // 停止流式
  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
    updateProcessing(false)
  }, [updateProcessing])

  // 快捷操作
  const handleQuickAction = useCallback((prompt: string) => {
    setInput(prompt)
    setTimeout(() => handleSend(prompt), 50)
  }, [handleSend])

  // 编辑消息（把之前的用户消息放回输入框）
  const handleEdit = useCallback((msgIndex: number) => {
    if (isProcessing) return
    const msg = messages[msgIndex]
    if (msg?.role === "user") {
      setInput(msg.content)
      textareaRef.current?.focus()
    }
  }, [isProcessing, messages])

  // 重新生成
  const handleRegenerate = useCallback((msgIndex: number) => {
    if (isProcessing) return
    // 找前一个用户消息
    let userIdx = -1
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") { userIdx = i; break }
    }
    if (userIdx < 0) return
    const userMsg = messages[userIdx]
    if (!userMsg) return
    // 截断消息列表到 userIdx
    const truncated = messages.slice(0, userIdx)
    onMessagesChange(truncated)
    setTimeout(() => handleSend(userMsg.content), 100)
  }, [isProcessing, messages, onMessagesChange, handleSend])

  // 复制消息
  const handleCopy = useCallback((msgIndex: number) => {
    const msg = messages[msgIndex]
    if (msg) {
      navigator.clipboard.writeText(msg.content || "")
    }
  }, [messages])

  // 确认对话框 — 批准
  const handleConfirmApprove = useCallback(async () => {
    if (!sessionId) return
    try {
      await api.confirmTool(sessionId, true)
      setConfirmOpen(false)
      setConfirmRequest(null)
      toast.success("已批准", `工具 "${confirmRequest?.toolName}" 已执行`)
    } catch (e: any) {
      toast.error("批准失败", e.message)
    }
  }, [sessionId, confirmRequest, toast])

  // 确认对话框 — 拒绝
  const handleConfirmDeny = useCallback(async () => {
    if (!sessionId) return
    try {
      await api.confirmTool(sessionId, false)
      setConfirmOpen(false)
      setConfirmRequest(null)
      toast.warning("已拒绝", "工具调用已被拒绝")
    } catch (e: any) {
      toast.error("操作失败", e.message)
    }
  }, [sessionId, toast])

  // 键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" && onCycleAgent) {
      e.preventDefault()
      onCycleAgent(e.shiftKey ? -1 : 1)
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = "auto"
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px"
  }

  return (
    <Box
      flex={1}
      display="flex"
      flexDirection="column"
      h="100vh"
      overflow="hidden"
      position="relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 隐藏文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      {/* 拖拽覆盖层（纯展示，事件由外层容器处理） */}
      {isDragOver && (
        <Box
          position="absolute"
          inset={0}
          zIndex={100}
          border="3px dashed"
          borderColor="blue.400"
          bg="blue.900/30"
          display="flex"
          alignItems="center"
          justifyContent="center"
          pointerEvents="none"
        >
          <VStack gap={3}>
            <Text fontSize="3xl">📂</Text>
            <Text fontSize="lg" color="blue.200" fontWeight="bold">释放文件以引用</Text>
            <Text fontSize="sm" color="gray.400">Agent 将会优先关注这些文件的内容</Text>
          </VStack>
        </Box>
      )}

      {/* 消息列表 */}
      <Box
        ref={scrollContainerRef}
        flex={1}
        overflowY="auto"
        px={4}
        py={4}
        onScroll={handleScroll}
      >
        {showWelcome && messages.length === 0 && (
          <WelcomeScreen onQuickAction={handleQuickAction} />
        )}

        {/* 消息列表 */}
        {messages.map((msg, i) => (
          <div key={i} data-msg-index={i} data-role={msg.role}>
            <ChatBubble
              msg={msg}
              onEdit={() => handleEdit(i)}
              onCopy={() => handleCopy(i)}
              onRegenerate={() => handleRegenerate(i)}
            />
          </div>
        ))}

        {/* 流式输出中的临时气泡 — 工具调用状态合并为文字 */}
        {isStreaming && (() => {
          const toolNames = streamSegments.filter(s => s.type === "tool").map(s => s.payload.tool)
          const statusText = toolNames.length > 0
            ? `调用工具中：${toolNames.join("、")}`
            : (streamContent || "思考中…")
          return (
            <ChatBubble
              msg={{ role: "assistant", content: statusText, timestamp: new Date().toISOString() }}
              isStreaming
            />
          )
        })()}

        <div ref={messagesEndRef} />
      </Box>

      {/* 浮动"回到底部"按钮 — 右下角小圆形，不遮挡内容 */}
      {!isAtBottom && (
        <Box
          position="absolute"
          bottom="100px"
          right="28px"
          zIndex={25}
        >
          <Box
            as="button"
            w="36px"
            h="36px"
            borderRadius="full"
            bg="gray.800"
            border="1px solid"
            borderColor="gray.600"
            color="gray.300"
            display="flex"
            alignItems="center"
            justifyContent="center"
            cursor="pointer"
            fontSize="lg"
            boxShadow="0 2px 10px rgba(0,0,0,0.4)"
            onClick={() => scrollToBottom(true)}
            animation="fadeIn 0.2s ease"
            title="回到底部"
          >
            ↓
          </Box>
        </Box>
      )}

      {/* 右侧迷你时间线 — DeepSeek 风格对话大纲 */}
      <MiniTimeline messages={messages} scrollContainerRef={scrollContainerRef} />

      {/* 输入区域 */}
      <Box
        borderTop="1px solid"
        borderColor="gray.800"
        px={4}
        py={3}
        bg="gray.950"
      >
        {/* 已附加文件 Chips */}
        {attachedFiles.length > 0 && (
          <HStack flexWrap="wrap" gap={1} mb={2}>
            {attachedFiles.map((file, idx) => {
              const isLoading = !file.content
              return (
              <Badge
                key={`${file.name}-${idx}`}
                colorPalette={isLoading ? "gray" : "blue"}
                variant="surface"
                size="lg"
                borderRadius="md"
                cursor="default"
              >
                <HStack gap={1}>
                  <Text fontSize="xs" maxW="200px" truncate title={file.name}>
                    {isLoading ? "⏳ " : ""}{file.name}
                  </Text>
                  <Box
                    as="span"
                    cursor="pointer"
                    onClick={() => removeAttachedFile(idx)}
                    px={1}
                    color="gray.400"
                    _hover={{ color: "red.300" }}
                    fontSize="xs"
                  >
                    ×
                  </Box>
                </HStack>
              </Badge>
            )})}
          </HStack>
        )}
        <HStack align="flex-end" gap={2}>
          <IconButton
            aria-label="附加文件"
            size="sm"
            variant="ghost"
            onClick={handleAttachClick}
            disabled={isProcessing}
            color="gray.400"
            _hover={{ color: "blue.300" }}
          >
            📎
          </IconButton>
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            placeholder={sessionId ? "输入消息… (Enter 发送, Shift+Enter 换行, Tab 切换Chat/Builder)" : "创建或选择一个会话开始对话"}
            disabled={!sessionId || isProcessing}
            minH="40px"
            maxH="200px"
            resize="none"
            bg="gray.900"
            border="none"
            _focus={{ outline: "none", boxShadow: "none" }}
            _placeholder={{ color: "gray.600" }}
            rows={1}
          />
          {isProcessing ? (
            <IconButton
              aria-label="停止"
              colorPalette="red"
              size="sm"
              onClick={handleStop}
            >
              ⏹
            </IconButton>
          ) : (
            <IconButton
              aria-label="发送"
              colorPalette="blue"
              size="sm"
              onClick={() => handleSend()}
              disabled={!sessionId || !input.trim()}
            >
              ↑
            </IconButton>
          )}
        </HStack>
        <Text fontSize="xs" color="gray.600" mt={1}>
          {attachedFiles.length > 0 && `📎 ${attachedFiles.length} 个文件引用 | `}
          {input.length > 0 && `${input.length} 字符`}
        </Text>
      </Box>

      {/* 模型选择器 */}
      <ModelSelectorBar />

      {/* 确认对话框 */}
      <ConfirmDialog
        open={confirmOpen}
        request={confirmRequest}
        onApprove={handleConfirmApprove}
        onDeny={handleConfirmDeny}
      />
    </Box>
  )
}
