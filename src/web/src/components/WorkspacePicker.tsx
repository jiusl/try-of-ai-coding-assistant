// src/web/src/components/WorkspacePicker.tsx
// ====================================================
// 工作路径选择器 — 仅浏览 + 显示
// ====================================================

import { useCallback, useRef } from "react"
import { HStack, IconButton, Text } from "@chakra-ui/react"
import * as api from "../api"

interface WorkspacePickerProps {
  sessionId: string | null
  workspace: string
  onChange: (workspace: string) => void
  disabled?: boolean
}

/** 从绝对路径中提取用于显示的简短路径 */
function shortPath(abs: string): string {
  if (!abs) return ""
  const parts = abs.replace(/\\/g, "/").split("/").filter(Boolean)
  if (parts.length <= 3) return abs
  return `…/${parts.slice(-2).join("/")}`
}

export function WorkspacePicker({ sessionId, workspace, onChange, disabled }: WorkspacePickerProps) {
  const folderInputRef = useRef<HTMLInputElement>(null)

  const handleBrowse = useCallback(async () => {
    try {
      const dir = await api.browseFolder(workspace)
      if (dir && dir !== workspace) {
        if (sessionId) {
          await api.updateSessionWorkspace(sessionId, dir)
        }
        onChange(dir)
      }
    } catch {
      // 后端不可用时回退到浏览器原生选择器
      folderInputRef.current?.click()
    }
  }, [workspace, sessionId, onChange])

  const handleFolderInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const firstPath = files[0]!.webkitRelativePath || files[0]!.name
    const folderName = firstPath.split("/")[0] ?? firstPath
    const parentDir = workspace.replace(/\\/g, "/").replace(/\/[^/]+$/, "")
    const guessed = parentDir ? `${parentDir}/${folderName}`.replace(/\//g, "\\") : folderName
    e.target.value = ""
    if (sessionId) {
      await api.updateSessionWorkspace(sessionId, guessed)
    }
    onChange(guessed)
  }, [workspace, sessionId, onChange])

  return (
    <HStack gap={1}>
      <IconButton
        aria-label="浏览并选择工作目录"
        size="sm"
        variant="ghost"
        color="gray.400"
        _hover={{ color: "white", bg: "gray.800" }}
        disabled={disabled}
        onClick={handleBrowse}
        title={"浏览文件夹…\n当前: " + workspace}
      >
        📁
      </IconButton>

      <Text
        fontSize="xs"
        color="gray.500"
        maxW="180px"
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        title={workspace}
      >
        {shortPath(workspace)}
      </Text>

      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory
        webkitdirectory=""
        style={{ display: "none" }}
        onChange={handleFolderInputChange}
      />
    </HStack>
  )
}
