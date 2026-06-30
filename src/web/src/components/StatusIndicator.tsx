// src/web/src/components/StatusIndicator.tsx
// ====================================================
// WebSocket / 服务连接状态指示器
// ====================================================

import { Box, HStack, Text } from "@chakra-ui/react"
import type { WSStatus } from "../hooks/useWebSocket"

interface StatusIndicatorProps {
  wsStatus: WSStatus
  isProcessing: boolean
}

const statusMap: Record<WSStatus, { color: string; label: string }> = {
  connected: { color: "green.400", label: "已连接" },
  connecting: { color: "yellow.400", label: "连接中…" },
  disconnected: { color: "red.400", label: "未连接" },
}

export function StatusIndicator({ wsStatus, isProcessing }: StatusIndicatorProps) {
  const s = statusMap[wsStatus]

  return (
    <HStack gap={2}>
      <Box
        w="8px"
        h="8px"
        borderRadius="full"
        bg={isProcessing ? "yellow.400" : s.color}
        animation={isProcessing ? "pulse 1.5s infinite" : undefined}
      />
      <Text fontSize="xs" color="gray.500">
        {isProcessing ? "处理中…" : s.label}
      </Text>
    </HStack>
  )
}
