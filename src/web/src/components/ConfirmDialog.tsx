// src/web/src/components/ConfirmDialog.tsx
// ====================================================
// 工具调用确认对话框（始终渲染 + Esc 关闭）
// ====================================================

import { useEffect, useState, type CSSProperties } from "react"
import { Box, Button, HStack, Text, VStack, Code } from "@chakra-ui/react"
import type { ConfirmRequest } from "../types"

interface ConfirmDialogProps {
  /** 始终渲染，通过 open 控制 */
  open: boolean
  request: ConfirmRequest | null
  /** 确认回调 */
  onApprove: () => void | Promise<void>
  /** 拒绝回调 */
  onDeny: () => void | Promise<void>
}

export function ConfirmDialog({ open, request, onApprove, onDeny }: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)

  // Esc 关闭
  useEffect(() => {
    if (!open || !request) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDeny()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, request])

  if (!request) return null

  const handleApprove = async () => {
    setLoading(true)
    try { await onApprove() } finally { setLoading(false) }
  }

  const handleDeny = async () => {
    setLoading(true)
    try { await onDeny() } finally { setLoading(false) }
  }

  // Overlay 样式
  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(2px)",
    display: open ? "flex" : "none",
    alignItems: "center",
    justifyContent: "center",
    animation: open ? "fadeIn 0.2s ease" : undefined,
  }

  const cardStyle: CSSProperties = {
    background: "#1a1a2e",
    borderRadius: 12,
    border: "1px solid #334",
    padding: 24,
    maxWidth: 480,
    width: "90vw",
    boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
    animation: open ? "slideUp 0.3s ease" : undefined,
  }

  const hasArgs = request.args && (typeof request.args === "string" ? request.args.length > 0 : Object.keys(request.args || {}).length > 0)
  const argsDisplay = typeof request.args === "string" ? request.args : JSON.stringify(request.args || {}, null, 2)

  return (
    <Box style={overlayStyle}>
        <Box style={cardStyle}>
          <VStack gap={4} align="stretch">
            {/* 头部 */}
            <HStack gap={2}>
              <Text fontSize="xl">⚠️</Text>
              <Text fontWeight={700} fontSize="lg" color="white">
                确认工具调用
              </Text>
            </HStack>

            {/* 说明 */}
            <Text fontSize="sm" color="gray.300" lineHeight="1.6">
              {request.message || `Agent 想要执行工具 "${request.toolName}"`}
            </Text>

            {/* 工具参数 */}
            {hasArgs && (
              <Box
                bg="gray.900"
                borderRadius={8}
                p={3}
                maxH="160px"
                overflow="auto"
                border="1px solid #222"
              >
                <Text fontSize="xs" color="gray.500" mb={1}>
                  参数
                </Text>
                <Code
                  fontSize="xs"
                  whiteSpace="pre-wrap"
                  display="block"
                  color="gray.300"
                  bg="transparent"
                >
                  {argsDisplay}
                </Code>
              </Box>
            )}

            {/* 工具名 */}
            <HStack gap={2} fontSize="xs" color="gray.500">
              <Text>工具：</Text>
              <Code fontSize="xs" px={1.5} py={0.5} borderRadius={4} bg="gray.800" color="cyan.300">
                {request.toolName}
              </Code>
            </HStack>

            {/* 按钮 */}
            <HStack gap={3} justify="flex-end" pt={2}>
              <Button
                size="sm"
                variant="outline"
                colorPalette="red"
                onClick={handleDeny}
                loading={loading}
                disabled={loading}
              >
                拒绝
              </Button>
              <Button
                size="sm"
                colorPalette="green"
                onClick={handleApprove}
                loading={loading}
                disabled={loading}
              >
                批准
              </Button>
            </HStack>
          </VStack>
        </Box>
      </Box>
  )
}
