// src/web/src/components/SessionSidebar.tsx
// ====================================================
// 会话侧边栏 — 列表 + 搜索 + CRUD
// ====================================================

import { useState } from "react"
import {
  Box, Button, HStack, IconButton, Input, Text, VStack, Heading,
} from "@chakra-ui/react"
import type { SessionInfo, ProjectInfo } from "../types"
import { formatTime } from "../utils"
import { ProjectList } from "./ProjectList"
import { FileTree } from "./FileTree"

interface SessionSidebarProps {
  sessions: SessionInfo[]
  currentSessionId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  /** 移动端是否展开 */
  isOpen?: boolean
  /** 切换展开/收起 */
  onToggle?: () => void
  /** 项目相关 */
  projects: ProjectInfo[]
  currentProjectId: string | null
  onProjectSelect: (project: ProjectInfo) => void
  onProjectsRefresh: () => void
  /** 文件浏览相关 */
  sessionId: string | null
  onFileSelect: (path: string) => void
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  isOpen = true,
  onToggle,
  projects,
  currentProjectId,
  onProjectSelect,
  onProjectsRefresh,
  sessionId,
  onFileSelect,
}: SessionSidebarProps) {
  const [search, setSearch] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [fileRefreshCounter, setFileRefreshCounter] = useState(0)

  const filtered = search
    ? sessions.filter((s) => (s.title || "").toLowerCase().includes(search.toLowerCase()))
    : sessions

  return (
    <Box
      as="aside"
      className={`sidebar${isOpen ? " open" : ""}`}
      w="280px"
      minW="280px"
      h="100vh"
      bg="gray.900"
      borderRight="1px solid"
      borderColor="gray.800"
      display={{ base: isOpen ? "flex" : "none", md: "flex" }}
      flexDirection="column"
      overflow="hidden"
    >
      {/* Header */}
      <HStack px={4} py={4} justify="space-between">
        <Heading size="md" fontFamily="mono">🤖 Try</Heading>
        {/* 移动端关闭按钮 */}
        <IconButton
          aria-label="关闭侧栏"
          display={{ base: "inline-flex", md: "none" }}
          size="xs"
          variant="ghost"
          onClick={onToggle}
        >
          ✕
        </IconButton>
      </HStack>

      {/* 项目选择器 */}
      <Box px={3} pb={1}>
        <ProjectList
          projects={projects}
          currentProjectId={currentProjectId}
          onSelect={onProjectSelect}
          onRefresh={onProjectsRefresh}
        />
      </Box>

      {/* 文件目录树 */}
      <Box flex={2} overflow="auto" minH={0} borderTop="1px solid" borderColor="gray.800">
        <HStack justify="space-between" px={3} pt={2} pb={1}>
          <Text fontSize="11px" color="gray.600">
            📁 文件浏览
          </Text>
          <IconButton
            aria-label="刷新文件列表"
            size="2xs"
            variant="ghost"
            color="gray.500"
            _hover={{ color: "blue.300" }}
            onClick={() => setFileRefreshCounter((c) => c + 1)}
          >
            🔄
          </IconButton>
        </HStack>
        <FileTree
          key={sessionId ?? "__no_session__"}
          sessionId={sessionId}
          onFileSelect={onFileSelect}
          refreshCounter={fileRefreshCounter}
        />
      </Box>

      {/* 搜索 + 新建 */}
      <Box px={3} pt={2} pb={1} borderTop="1px solid" borderColor="gray.800">
        <HStack gap={2}>
          <Input
            placeholder="搜索会话…"
            size="xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            bg="gray.800"
            border="none"
            _placeholder={{ color: "gray.500" }}
          />
          <Button
            size="xs"
            colorScheme="blue"
            variant="solid"
            onClick={onCreate}
            flexShrink={0}
          >
            ＋ 新建
          </Button>
        </HStack>
      </Box>

      {/* 列表 */}
      <Box flex={3} overflowY="auto" px={2} minH={0}>
        {sessions.length === 0 && (
          <Text fontSize="sm" color="gray.600" textAlign="center" mt={8}>
            暂无会话
          </Text>
        )}
        {sessions.length > 0 && filtered.length === 0 && (
          <Text fontSize="sm" color="gray.600" textAlign="center" mt={8}>
            无匹配结果
          </Text>
        )}
        {filtered.map((s) => {
          const active = s.id === currentSessionId
          const isEditing = editingId === s.id
          return (
            <Box
              key={s.id}
              onClick={() => { if (!isEditing) onSelect(s.id) }}
              cursor={isEditing ? "default" : "pointer"}
              bg={active ? "gray.700" : "transparent"}
              _hover={!isEditing ? { bg: (active ? "gray.700" : "gray.800") as "gray.700" | "gray.800" } : {}}
              borderRadius="md"
              px={3}
              py={2}
              mb={1}
              transition="background 0.15s"
            >
              {isEditing ? (
                <HStack gap={1}>
                  <Input
                    size="xs"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(s.id, editTitle.trim() || s.title || "会话")
                        setEditingId(null)
                      } else if (e.key === "Escape") {
                        setEditingId(null)
                      }
                    }}
                    autoFocus
                    bg="gray.800"
                    border="none"
                  />
                  <IconButton
                    aria-label="确认"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      onRename(s.id, editTitle.trim() || s.title || "会话")
                      setEditingId(null)
                    }}
                  >
                    ✓
                  </IconButton>
                </HStack>
              ) : (
                <HStack justify="space-between">
                  <Box flex={1} minW={0}>
                    <Text
                      fontSize="sm"
                      color={active ? "white" : "gray.300"}
                      fontWeight={active ? "medium" : "normal"}
                      truncate
                    >
                      {s.title || "新会话"}
                    </Text>
                    <Text fontSize="xs" color="gray.500">
                      {formatTime(s.updatedAt || s.createdAt)}
                    </Text>
                  </Box>
                  <HStack gap={0}>
                    <IconButton
                      aria-label="重命名"
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(s.id)
                        setEditTitle(s.title || "")
                      }}
                    >
                      ✏️
                    </IconButton>
                    <IconButton
                      aria-label="删除"
                      size="xs"
                      variant="ghost"
                      color="red.400"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm("确定删除此会话？")) onDelete(s.id)
                      }}
                    >
                      ×
                    </IconButton>
                  </HStack>
                </HStack>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
