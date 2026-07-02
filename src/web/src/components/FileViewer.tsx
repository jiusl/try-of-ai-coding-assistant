// src/web/src/components/FileViewer.tsx
// ====================================================
// 文件内容预览 — 语法高亮 + 行号
// ====================================================

import { useEffect, useState } from "react"
import { Box, Text, HStack, Spinner, IconButton } from "@chakra-ui/react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import * as api from "../api"

interface FileViewerProps {
  sessionId: string | null
  filePath: string | null  // 相对于 workspace 的路径
  onClose?: () => void
}

export function FileViewer({ sessionId, filePath, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [language, setLanguage] = useState("text")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!filePath || !sessionId) {
      setContent(null)
      setError("")
      return
    }
    let cancelled = false
    setLoading(true)
    setError("")
    setContent(null)

    api.fetchFileContent(sessionId, filePath).then((data) => {
      if (cancelled) return
      setContent(data.content)
      setLanguage(data.language)
      setLoading(false)
    }).catch((e) => {
      if (cancelled) return
      setError(e.message || "读取失败")
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [sessionId, filePath])

  // 无文件选中
  if (!filePath) {
    return (
      <Box flex={1} display="flex" alignItems="center" justifyContent="center" p={4}>
        <Text fontSize="13px" color="gray.600">
          选择文件以预览
        </Text>
      </Box>
    )
  }

  if (loading) {
    return (
      <Box flex={1} display="flex" alignItems="center" justifyContent="center" p={4}>
        <HStack gap={2}>
          <Spinner size="sm" color="gray.500" />
          <Text fontSize="13px" color="gray.500">加载中…</Text>
        </HStack>
      </Box>
    )
  }

  if (error) {
    return (
      <Box flex={1} p={4}>
        <Text fontSize="12px" color="red.400" mb={2}>{error}</Text>
      </Box>
    )
  }

  if (content === null) return null

  return (
    <Box flex={1} overflow="auto">
      {/* 文件名标题栏 */}
      <HStack
        px={3} py={1}
        borderBottom="1px solid"
        borderColor="gray.800"
        justify="space-between"
        bg="gray.900"
        position="sticky"
        top={0}
        zIndex={1}
      >
        <Text fontSize="11px" color="gray.400" truncate>
          📄 {filePath}
        </Text>
        {onClose && (
          <IconButton
            aria-label="关闭预览"
            size="2xs"
            variant="ghost"
            color="gray.500"
            onClick={onClose}
          >
            ✕
          </IconButton>
        )}
      </HStack>

      {/* 语法高亮 */}
      <Box fontSize="12px" fontFamily="'Fira Code', 'Cascadia Code', monospace">
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          showLineNumbers
          wrapLines
          lineNumberStyle={{
            minWidth: "2.5em",
            paddingRight: "1em",
            color: "#636d83",
            userSelect: "none",
          }}
          customStyle={{
            margin: 0,
            padding: "8px 0",
            background: "transparent",
            fontSize: "12px",
          }}
          codeTagProps={{
            style: { fontFamily: "'Fira Code', 'Cascadia Code', monospace" }
          }}
        >
          {content}
        </SyntaxHighlighter>
      </Box>
    </Box>
  )
}
