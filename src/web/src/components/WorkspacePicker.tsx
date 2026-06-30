// src/web/src/components/WorkspacePicker.tsx
// ====================================================
// 工作路径选择器 — 显示/修改当前工作目录
// ====================================================

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Box, HStack, IconButton, Input, Text, VStack, Portal,
} from "@chakra-ui/react"
import * as api from "../api"

interface WorkspacePickerProps {
  sessionId: string | null
  workspace: string
  onChange: (workspace: string) => void
  disabled?: boolean
}

/** 从绝对路径中提取用于显示的简短路径 */
function shortPath(abs: string): string {
  const parts = abs.replace(/\\/g, "/").split("/")
  if (parts.length <= 3) return abs
  return `…/${parts.slice(-2).join("/")}`
}

export function WorkspacePicker({ sessionId, workspace, onChange, disabled }: WorkspacePickerProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(workspace)
  const [subdirs, setSubdirs] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 加载默认工作目录和子目录列表
  useEffect(() => {
    api.fetchDefaultWorkspace().then((info) => {
      setSubdirs(info.subdirs ?? [])
    }).catch(() => {})
  }, [sessionId])

  // 编辑时聚焦输入框
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  // 点击外部关闭下拉/编辑
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
        setEditing(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === workspace) {
      setEditing(false)
      return
    }
    try {
      if (sessionId) {
        await api.updateSessionWorkspace(sessionId, trimmed)
      }
      onChange(trimmed)
      setEditing(false)
    } catch (e: any) {
      // 失败恢复原值
      setEditValue(workspace)
      setEditing(false)
    }
  }, [editValue, workspace, sessionId, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSave()
    }
    if (e.key === "Escape") {
      setEditValue(workspace)
      setEditing(false)
    }
  }, [handleSave, workspace])

  const handleSelectSubdir = useCallback((dir: string) => {
    setEditValue(dir)
    setShowDropdown(false)
    if (sessionId) {
      api.updateSessionWorkspace(sessionId, dir).then(() => {
        onChange(dir)
      }).catch(() => {})
    } else {
      onChange(dir)
    }
    setEditing(false)
  }, [sessionId, onChange])

  return (
    <HStack ref={containerRef} gap={1} position="relative">
      <IconButton
        aria-label="工作目录"
        size="sm"
        variant="ghost"
        color="gray.400"
        _hover={{ color: "white", bg: "gray.800" }}
        disabled={disabled}
        onClick={() => {
          setEditValue(workspace)
          setEditing(!editing)
        }}
        title={workspace}
      >
        📁
      </IconButton>

      {!editing ? (
        <Text
          as="span"
          fontSize="xs"
          color="gray.500"
          maxW="180px"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          cursor="pointer"
          _hover={{ color: "gray.300" }}
          onClick={() => {
            setEditValue(workspace)
            setEditing(true)
          }}
          title={workspace}
        >
          {shortPath(workspace)}
        </Text>
      ) : (
        <HStack gap={1}>
          <Input
            ref={inputRef}
            size="xs"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowDropdown(true)}
            placeholder="输入工作目录路径…"
            w="260px"
            bg="gray.900"
            borderColor="gray.700"
            color="white"
            _hover={{ borderColor: "gray.600" }}
            _focus={{ borderColor: "blue.500" }}
          />
          <IconButton
            aria-label="确认"
            size="xs"
            colorScheme="blue"
            variant="ghost"
            onClick={handleSave}
          >
            ✓
          </IconButton>
          <IconButton
            aria-label="取消"
            size="xs"
            variant="ghost"
            color="gray.500"
            onClick={() => {
              setEditValue(workspace)
              setEditing(false)
              setShowDropdown(false)
            }}
          >
            ✕
          </IconButton>

          {/* 子目录下拉 */}
          {showDropdown && subdirs.length > 0 && (
            <Portal>
              <Box
                position="fixed"
                top={`${(containerRef.current?.getBoundingClientRect().bottom ?? 100) + 4}px`}
                left={`${containerRef.current?.getBoundingClientRect().left ?? 16}px`}
                bg="gray.900"
                border="1px solid"
                borderColor="gray.700"
                borderRadius="md"
                boxShadow="lg"
                maxH="200px"
                overflowY="auto"
                zIndex={200}
                minW="260px"
              >
                <VStack gap={0} align="stretch">
                  {subdirs.map((dir) => (
                    <Box
                      key={dir}
                      px={3} py={1.5}
                      cursor="pointer"
                      fontSize="xs"
                      color="gray.300"
                      _hover={{ bg: "gray.700", color: "white" }}
                      onClick={() => handleSelectSubdir(dir)}
                      title={dir}
                    >
                      📁 {shortPath(dir)}
                    </Box>
                  ))}
                </VStack>
              </Box>
            </Portal>
          )}
        </HStack>
      )}
    </HStack>
  )
}
