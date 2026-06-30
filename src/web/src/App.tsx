// src/web/src/App.tsx
// ====================================================
// 主布局 — 侧边栏 + 聊天面板 + 设置
// ====================================================

import { useCallback, useEffect, useState } from "react"
import { Box, HStack, IconButton, Text, Spinner, VStack } from "@chakra-ui/react"
import type { ChatMessage, SessionInfo, AgentInfo } from "./types"
import * as api from "./api"
import { useAuth } from "./AuthContext"
import { ChatPanel } from "./components/ChatPanel"
import { SessionSidebar } from "./components/SessionSidebar"
import { AgentSelector } from "./components/AgentSelector"
import { WorkspacePicker } from "./components/WorkspacePicker"
import { SettingsDrawer } from "./components/SettingsDrawer"
import { StatusIndicator } from "./components/StatusIndicator"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { LoginPage } from "./components/LoginPage"
import { useWebSocket } from "./hooks/useWebSocket"
import { useToast } from "./components/Toast"

export function App() {
  const { user, isLoading, isAuthenticated, logout } = useAuth()
  const toast = useToast()

  // 核心状态
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [currentAgentId, setCurrentAgentId] = useState("builtin:chat")
  const [isProcessing, setIsProcessing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [workspace, setWorkspace] = useState("")

  // 配额刷新版本号 — 每次创建/删除会话后递增，驱动 TierPanel 重新加载
  const [quotaVersion, setQuotaVersion] = useState(0)

  // 会话缓存
  const [sessionCache, setSessionCache] = useState<Record<string, ChatMessage[]>>({})

  const ws = useWebSocket({
    onMessage: (msg) => {
      // 处理 WebSocket 消息（如远程操作更新）
      if (msg.type === "refresh" && msg.sessionId === currentSessionId) {
        loadSession(currentSessionId!)
      }
    },
    ...(currentSessionId ? { sessionId: currentSessionId } : {}),
  })

  // 初始加载 — 登录成功后加载数据
  useEffect(() => {
    if (!isAuthenticated) return
    loadSessions()
    loadAgents()
  }, [isAuthenticated])

  // 会话切换时通知 WebSocket
  useEffect(() => {
    if (currentSessionId) ws.subscribe(currentSessionId)
    return () => {
      if (currentSessionId) ws.unsubscribe(currentSessionId)
    }
  }, [currentSessionId])

  // ──── 数据加载 ────

  const loadSessions = async () => {
    try {
      const list = await api.fetchSessions()
      setSessions(list)
      if (!currentSessionId && list.length > 0) {
        switchToSession(list[0]!.id)
      } else if (list.length === 0) {
        // 无会话时加载默认工作目录
        try {
          const info = await api.fetchDefaultWorkspace()
          setWorkspace(info.workspace)
        } catch { /* ignore */ }
      }
    } catch (e) {
      console.error("加载会话失败:", e)
    }
  }

  const loadAgents = async () => {
    try {
      const list = await api.fetchAgents()
      setAgents(list.filter((a) => a.enabled !== false))
    } catch (e) {
      console.error("加载Agent失败:", e)
    }
  }

  const loadSession = async (id: string) => {
    try {
      const data = await api.fetchSession(id)
      setMessages(data.messages || [])
      setSessionCache((c) => ({ ...c, [id]: data.messages || [] }))
    } catch (e) {
      console.error("加载会话消息失败:", e)
    }
  }

  // ──── 会话操作 ────

  const switchToSession = useCallback(async (id: string) => {
    if (id === currentSessionId) return
    setCurrentSessionId(id)

    // 从缓存读取
    const cached = sessionCache[id]
    if (cached) {
      setMessages(cached)
    } else {
      setMessages([])
      await loadSession(id)
    }

    // 加载工作目录
    try {
      const info = await api.getSessionWorkspace(id)
      setWorkspace(info.workspace)
    } catch {
      setWorkspace("")
    }
  }, [currentSessionId, sessionCache])

  const handleCreateSession = async () => {
    try {
      const s = await api.createSession()
      setSessions((prev) => [s, ...prev])
      setCurrentSessionId(s.id)
      setMessages([])
      setWorkspace(s.workspace ?? "")
      setSessionCache((c) => ({ ...c, [s.id]: [] }))
      setQuotaVersion((v) => v + 1)
    } catch (e: any) {
      if (e.status === 429) {
        toast.warning("会话数已达上限", e.message || "请删除部分会话后再创建")
      } else {
        toast.error("创建会话失败", e.message || "未知错误")
      }
    }
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await api.deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setSessionCache((c) => {
        const n = { ...c }
        delete n[id]
        return n
      })
      setQuotaVersion((v) => v + 1)
      if (currentSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id)
        if (remaining.length > 0) {
          switchToSession(remaining[0]!.id)
        } else {
          setCurrentSessionId(null)
          setMessages([])
        }
      }
    } catch (e: any) {
      toast.error("删除会话失败", e.message || "未知错误")
    }
  }

  const handleRenameSession = async (id: string, title: string) => {
    try {
      await api.renameSession(id, title)
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title } : s))
      )
    } catch (e) {
      console.error("重命名失败:", e)
    }
  }

  const handleAgentChange = async (agentId: string) => {
    setCurrentAgentId(agentId)
    if (currentSessionId) {
      try {
        await api.setSessionAgent(currentSessionId, agentId)
      } catch (e) {
        console.error("设置Agent失败:", e)
      }
    }
  }

  const handleWorkspaceChange = (ws: string) => {
    setWorkspace(ws)
    // 同时更新 session 缓存
    if (currentSessionId) {
      setSessionCache((c) => {
        const msgs = c[currentSessionId] ?? []
        return { ...c, [currentSessionId]: msgs }
      })
    }
  }

  /** Tab 键在 Chat ↔ Builder 之间切换 */
  const handleCycleAgent = useCallback((_direction: 1 | -1) => {
    const nextId = currentAgentId === "builtin:builder" ? "builtin:chat" : "builtin:builder"
    const nextAgent = agents.find((a) => a.id === nextId)
    if (nextAgent) {
      handleAgentChange(nextId)
      toast.info(`已切换至 ${nextAgent.name}`, `${nextAgent.description.slice(0, 40)}…`)
    }
  }, [agents, currentAgentId, currentSessionId])

  // 全局键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable

      // Escape: 关闭设置 / 关闭侧栏
      if (e.key === "Escape") {
        if (settingsOpen) {
          e.preventDefault()
          setSettingsOpen(false)
          return
        }
        // 侧栏打开时 Esc 关闭
        if (sidebarOpen && window.innerWidth <= 768) {
          e.preventDefault()
          setSidebarOpen(false)
          return
        }
      }

      // Ctrl+N: 新建会话
      if (e.key === "n" && e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault()
        handleCreateSession()
        return
      }

      // Ctrl+K: 聚焦搜索（侧栏搜索框）
      if (e.key === "k" && e.ctrlKey && !e.shiftKey && !e.metaKey && !isInput) {
        e.preventDefault()
        // 打开侧栏然后聚焦搜索
        if (window.innerWidth <= 768) setSidebarOpen(true)
        setTimeout(() => {
          const searchInput = document.querySelector('[placeholder="搜索会话…"]') as HTMLInputElement
          searchInput?.focus()
        }, 150)
        return
      }

      // Ctrl+B: 切换侧栏
      if (e.key === "b" && e.ctrlKey && !e.shiftKey && !e.metaKey && !isInput) {
        e.preventDefault()
        setSidebarOpen((prev) => !prev)
        return
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [settingsOpen, sidebarOpen, handleCreateSession])

  // ──── 认证门控 ────
  if (isLoading) {
    return (
      <Box w="100vw" h="100vh" display="flex" alignItems="center" justifyContent="center" bg="gray.950">
        <VStack gap={3}>
          <Spinner size="lg" color="blue.400" />
          <Text color="gray.400">正在加载...</Text>
        </VStack>
      </Box>
    )
  }
  if (!isAuthenticated) {
    return <LoginPage />
  }

  return (
    <ErrorBoundary>
    <HStack gap={0} h="100vh" overflow="hidden" bg="gray.950" color="white" position="relative">
      {/* 移动端侧栏遮罩 */}
      {sidebarOpen && (
        <Box
          display={{ base: "block", md: "none" }}
          position="fixed"
          inset={0}
          bg="blackAlpha.700"
          zIndex={100}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 */}
      <SessionSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelect={(id) => { switchToSession(id); setSidebarOpen(false) }}
        onCreate={() => { handleCreateSession(); setSidebarOpen(false) }}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((p) => !p)}
      />

      {/* 主区域 */}
      <Box flex={1} display="flex" flexDirection="column" h="100vh" overflow="hidden">
        {/* 顶栏 */}
        <HStack
          px={4} py={2}
          borderBottom="1px solid"
          borderColor="gray.800"
          justify="space-between"
          bg="gray.950"
        >
          <HStack gap={3}>
            {/* 汉堡菜单 — 移动端 */}
            <IconButton
              aria-label="切换侧栏"
              display={{ base: "inline-flex", md: "none" }}
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen((p) => !p)}
            >
              {sidebarOpen ? "✕" : "☰"}
            </IconButton>
            <AgentSelector
              agents={agents}
              currentAgentId={currentAgentId}
              onChange={handleAgentChange}
              disabled={isProcessing}
            />
            {/* 工作路径选择器 */}
            <WorkspacePicker
              sessionId={currentSessionId}
              workspace={workspace}
              onChange={handleWorkspaceChange}
              disabled={isProcessing}
            />
          </HStack>
          <HStack gap={3}>
            <StatusIndicator wsStatus={ws.status} isProcessing={isProcessing} />
            {user && (
              <Text fontSize="sm" color="gray.500" display={{ base: "none", md: "inline" }}>
                {user.name}
              </Text>
            )}
            <Box
              as="button"
              fontSize="xs"
              px={2} py={1}
              borderRadius="md"
              color="gray.500"
              _hover={{ bg: "gray.800", color: "red.300" }}
              onClick={logout}
              title="退出登录"
            >
              退出
            </Box>
            <Box
              as="button"
              fontSize="lg"
              px={2}
              py={1}
              borderRadius="md"
              _hover={{ bg: "gray.800" }}
              onClick={() => setSettingsOpen(true)}
              aria-label="设置"
            >
              ⚙️
            </Box>
          </HStack>
        </HStack>

        {/* 聊天面板 */}
        <ChatPanel
          sessionId={currentSessionId}
          agentId={currentAgentId}
          messages={messages}
          onMessagesChange={(msgs) => {
            setMessages(msgs)
            if (currentSessionId) {
              setSessionCache((c) => ({ ...c, [currentSessionId]: msgs }))
            }
          }}
          onProcessingChange={setIsProcessing}
          onChatComplete={() => { setQuotaVersion((v) => v + 1); loadSessions() }}
          onCycleAgent={handleCycleAgent}
        />
      </Box>

      {/* 设置抽屉 */}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} quotaVersion={quotaVersion} onLicenseActivated={() => setQuotaVersion(v => v + 1)} />
    </HStack>
    </ErrorBoundary>
  )
}
