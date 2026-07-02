// src/web/src/components/ProjectList.tsx
// ====================================================
// 项目选择器 — 侧边栏顶部的项目下拉列表
// ====================================================

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Box, Button, HStack, IconButton, Text, VStack, Separator,
} from "@chakra-ui/react"
import type { ProjectInfo } from "../types"
import * as api from "../api"

interface ProjectListProps {
  projects: ProjectInfo[]
  currentProjectId: string | null
  onSelect: (project: ProjectInfo) => void
  onRefresh: () => void
  disabled?: boolean
}

/** 从绝对路径中提取简短显示名 */
function shortPath(abs: string): string {
  if (!abs) return ""
  const parts = abs.replace(/\\/g, "/").split("/").filter(Boolean)
  if (parts.length <= 3) return abs
  return `…/${parts.slice(-2).join("/")}`
}

export function ProjectList({
  projects,
  currentProjectId,
  onSelect,
  onRefresh,
  disabled,
}: ProjectListProps) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")
  const [browsing, setBrowsing] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const currentProject = projects.find((p) => p.id === currentProjectId)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setAdding(false)
        setError("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const handleSelect = useCallback((project: ProjectInfo) => {
    setOpen(false)
    setAdding(false)
    setError("")
    if (project.id !== currentProjectId) {
      onSelect(project)
    }
  }, [currentProjectId, onSelect])

  const handleBrowseAdd = useCallback(async () => {
    setBrowsing(true)
    setError("")
    try {
      const dir = await api.browseFolder("")
      if (dir) {
        const created = await api.createProject(dir)
        setOpen(false)
        setAdding(false)
        onRefresh()
        onSelect(created)
      } else {
        setAdding(false)
      }
    } catch {
      // 后端不可用时回退到浏览器原生选择器
      folderInputRef.current?.click()
    } finally {
      setBrowsing(false)
    }
  }, [onRefresh, onSelect])

  const handleFolderInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const firstPath = files[0]!.webkitRelativePath || files[0]!.name
    const folderName = firstPath.split("/")[0] ?? firstPath
    // 尝试猜测完整路径（浏览器只给相对名，无法获取完整绝对路径）
    const guessed = folderName
    e.target.value = ""
    setError("")
    setBrowsing(true)
    try {
      const created = await api.createProject(guessed)
      setOpen(false)
      setAdding(false)
      onRefresh()
      onSelect(created)
    } catch (err: any) {
      setError(err.message || "创建项目失败，请使用浏览按钮选择文件夹")
    } finally {
      setBrowsing(false)
    }
  }, [onRefresh, onSelect])

  // 点击"添加项目…"时立即触发浏览
  const handleStartAdd = useCallback(() => {
    setAdding(true)
    // 小小延迟等 state 更新后再触发浏览
    setTimeout(() => handleBrowseAdd(), 50)
  }, [handleBrowseAdd])

  const handleDelete = useCallback(async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (!confirm("确定删除此项目？该项目的所有会话将被永久删除。")) return
    try {
      await api.deleteProject(projectId)
      onRefresh()
    } catch (err: any) {
      alert(err.message || "删除失败")
    }
  }, [onRefresh])

  return (
    <Box ref={dropdownRef} position="relative">
      {/* 触发器按钮 */}
      <Button
        size="xs"
        variant="outline"
        borderColor="gray.700"
        color="gray.300"
        _hover={{ bg: "gray.800", borderColor: "gray.600" }}
        onClick={() => setOpen((p) => !p)}
        disabled={disabled}
        w="100%"
        justifyContent="space-between"
        fontFamily="mono"
        fontSize="11px"
      >
        <Text truncate maxW="180px">
          {currentProject ? `📂 ${currentProject.name}` : "📂 选择项目"}
        </Text>
        <Text fontSize="10px" color="gray.500">
          {open ? "▲" : "▼"}
        </Text>
      </Button>

      {/* 下拉面板 */}
      {open && (
        <Box
          position="absolute"
          top="100%"
          left={0}
          mt={1}
          w="260px"
          bg="gray.900"
          border="1px solid"
          borderColor="gray.700"
          borderRadius="md"
          boxShadow="lg"
          zIndex={200}
          overflow="hidden"
        >
          {/* 项目列表 */}
          <Box maxH="280px" overflowY="auto">
            {projects.length === 0 && (
              <Text fontSize="xs" color="gray.500" textAlign="center" py={4}>
                暂无项目
              </Text>
            )}
            {projects.map((p) => {
              const active = p.id === currentProjectId
              const isDefault = p.id === "__default__"
              return (
                <HStack
                  key={p.id}
                  px={3}
                  py={2}
                  cursor="pointer"
                  bg={active ? "gray.700" : "transparent"}
                  _hover={{ bg: active ? "gray.700" : "gray.800" }}
                  onClick={() => handleSelect(p)}
                  justify="space-between"
                  transition="background 0.1s"
                >
                  <Box flex={1} minW={0}>
                    <Text
                      fontSize="xs"
                      fontWeight={active ? "medium" : "normal"}
                      color={active ? "white" : "gray.300"}
                      truncate
                    >
                      {p.name}
                      {isDefault && (
                        <Text as="span" fontSize="10px" color="gray.500" ml={1}>
                          (默认)
                        </Text>
                      )}
                    </Text>
                    <Text fontSize="10px" color="gray.500" truncate title={p.path}>
                      {shortPath(p.path)}
                    </Text>
                  </Box>
                  <HStack gap={1}>
                    <Text fontSize="10px" color="gray.600">
                      {p.sessionCount}
                    </Text>
                    {!isDefault && (
                      <IconButton
                        aria-label="删除项目"
                        size="xs"
                        variant="ghost"
                        color="gray.500"
                        _hover={{ color: "red.300" }}
                        onClick={(e) => handleDelete(e, p.id)}
                        title="删除项目"
                      >
                        ×
                      </IconButton>
                    )}
                  </HStack>
                </HStack>
              )
            })}
          </Box>

          <Separator borderColor="gray.700" />

          {/* 添加项目区域 */}
          {adding ? (
            <Box px={3} py={2}>
              <VStack gap={1} align="stretch">
                {browsing ? (
                  <Text fontSize="xs" color="gray.400" textAlign="center" py={1}>
                    正在选择文件夹…
                  </Text>
                ) : (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      borderColor="gray.600"
                      color="gray.300"
                      _hover={{ bg: "gray.700", borderColor: "gray.500" }}
                      onClick={handleBrowseAdd}
                      w="100%"
                    >
                      📁 选择文件夹…
                    </Button>
                    <Text fontSize="10px" color="gray.600" textAlign="center">
                      或
                    </Text>
                    <Button
                      size="xs"
                      variant="ghost"
                      color="gray.400"
                      onClick={() => setAdding(false)}
                    >
                      取消
                    </Button>
                  </>
                )}
                {error && (
                  <Text fontSize="10px" color="red.400">
                    {error}
                  </Text>
                )}
              </VStack>
            </Box>
          ) : (
            <Box
              px={3}
              py={2}
              cursor="pointer"
              _hover={{ bg: "gray.800" }}
              onClick={handleStartAdd}
            >
              <Text fontSize="xs" color="gray.400">
                ➕ 添加项目…
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* 隐藏的文件夹选择器 — 后端不可用时的回退 */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory 非标准属性
        webkitdirectory=""
        directory=""
        style={{ display: "none" }}
        onChange={handleFolderInputChange}
      />
    </Box>
  )
}
