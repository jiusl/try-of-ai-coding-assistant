// src/web/src/components/FileTree.tsx
// ====================================================
// 递归目录树组件 — 懒加载 + 展开/折叠
// ====================================================

import { useCallback, useEffect, useState } from "react"
import { Box, Text, HStack, Spinner } from "@chakra-ui/react"
import type { FileEntry } from "../types"
import * as api from "../api"

interface FileTreeProps {
  sessionId: string | null
  onFileSelect: (path: string) => void
  /** 外部刷新计数器，每次自增触发重新加载 */
  refreshCounter?: number
}

/** 树节点：目录项 + 展开状态 + 子节点 */
interface TreeNode {
  entry: FileEntry
  children: TreeNode[] | null  // null = 未加载；[] = 已加载但为空
  loading: boolean
  loaded: boolean
}

/** 把 FileEntry[] 转成 TreeNode[] */
function toNodes(entries: FileEntry[]): TreeNode[] {
  return entries.map((e) => ({
    entry: e,
    children: e.isDir ? null : undefined as any,
    loading: false,
    loaded: false,
  }))
}

function FileTreeItem({
  node,
  depth,
  parentPath,
  sessionId,
  onFileSelect,
  onToggle,
}: {
  node: TreeNode
  depth: number
  parentPath: string
  sessionId: string | null
  onFileSelect: (path: string) => void
  onToggle: (node: TreeNode, path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const entry = node.entry
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
  const isDir = entry.isDir

  const handleClick = useCallback(() => {
    if (isDir) {
      if (!expanded) {
        setExpanded(true)
        onToggle(node, fullPath)
      } else {
        setExpanded(false)
      }
    } else {
      onFileSelect(fullPath)
    }
  }, [isDir, expanded, fullPath])

  const icon = isDir ? (expanded ? "📂" : "📁") : "📄"
  const indent = depth * 16

  return (
    <Box>
      <HStack
        gap={1}
        pl={`${indent + 8}px`}
        pr={2}
        py="2px"
        cursor="pointer"
        _hover={{ bg: "gray.800" }}
        borderRadius="sm"
        fontSize="13px"
        onClick={handleClick}
        overflow="hidden"
      >
        <Text flexShrink={0}>{icon}</Text>
        <Text
          flex={1}
          truncate
          color={isDir ? "blue.300" : "gray.300"}
        >
          {entry.name}
        </Text>
        {entry.size !== undefined && (
          <Text fontSize="10px" color="gray.600" flexShrink={0}>
            {formatSize(entry.size)}
          </Text>
        )}
      </HStack>

      {/* 展开的子目录 */}
      {expanded && node.loading && (
        <HStack pl={`${indent + 24}px`} py={1}>
          <Spinner size="xs" color="gray.500" />
          <Text fontSize="11px" color="gray.600">加载中…</Text>
        </HStack>
      )}
      {expanded && node.children?.map((child, i) => (
        <FileTreeItem
          key={`${fullPath}/${child.entry.name}-${i}`}
          node={child}
          depth={depth + 1}
          parentPath={fullPath}
          sessionId={sessionId}
          onFileSelect={onFileSelect}
          onToggle={onToggle}
        />
      ))}
    </Box>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileTree({ sessionId, onFileSelect, refreshCounter }: FileTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([])
  const [rootLoaded, setRootLoaded] = useState(false)
  const [rootLoading, setRootLoading] = useState(false)
  const [error, setError] = useState("")

  /** 加载根目录 */
  const loadRoot = useCallback(async () => {
    if (rootLoaded || rootLoading || !sessionId) return
    setRootLoading(true)
    setError("")
    try {
      const data = await api.fetchDirList(sessionId, "")
      setRootNodes(toNodes(data.entries))
      setRootLoaded(true)
    } catch (e: any) {
      setError(e.message || "加载失败")
    } finally {
      setRootLoading(false)
    }
  }, [sessionId, rootLoaded, rootLoading])

  // sessionId 变化时重置状态，重新加载
  useEffect(() => {
    setRootNodes([])
    setRootLoaded(false)
    setRootLoading(false)
    setError("")
  }, [sessionId])

  // refreshCounter 变化时刷新（用于外部刷新按钮）
  useEffect(() => {
    if (refreshCounter !== undefined && refreshCounter > 0) {
      setRootNodes([])
      setRootLoaded(false)
      setRootLoading(false)
      setError("")
    }
  }, [refreshCounter])

  /** 展开目录：懒加载子节点 */
  const handleToggle = useCallback((node: TreeNode, path: string) => {
    if (node.children !== null || !sessionId) return
    node.loading = true
    // trigger re-render
    setRootNodes([...rootNodes])
    api.fetchDirList(sessionId, path).then((data) => {
      node.children = toNodes(data.entries)
      node.loading = false
      node.loaded = true
      setRootNodes([...rootNodes])
    }).catch((e) => {
      node.loading = false
      setRootNodes([...rootNodes])
      console.error("加载子目录失败:", e)
    })
  }, [sessionId, rootNodes])

  // 会话变化时自动加载
  if (sessionId && !rootLoaded && !rootLoading) {
    loadRoot()
  }

  return (
    <Box overflow="auto" flex={1}>
      {error && (
        <Text fontSize="12px" color="red.400" px={2} py={1}>
          {error}
        </Text>
      )}
      {rootLoading && (
        <HStack px={3} py={2}>
          <Spinner size="xs" color="gray.500" />
          <Text fontSize="12px" color="gray.500">加载目录…</Text>
        </HStack>
      )}
      {rootNodes.map((node, i) => (
        <FileTreeItem
          key={`${node.entry.name}-${i}`}
          node={node}
          depth={0}
          parentPath=""
          sessionId={sessionId}
          onFileSelect={onFileSelect}
          onToggle={handleToggle}
        />
      ))}
      {rootLoaded && rootNodes.length === 0 && (
        <Text fontSize="12px" color="gray.600" px={3} py={2}>
          目录为空
        </Text>
      )}
    </Box>
  )
}
