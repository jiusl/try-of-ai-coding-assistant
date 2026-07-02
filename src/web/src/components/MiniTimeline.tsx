// src/web/src/components/MiniTimeline.tsx
// ====================================================
// 右侧迷你时间线 — DeepSeek 风格对话大纲
// 收起时: 窄条 + 小圆点
// 展开时(hover): 显示每条用户消息预览，点击跳转
// ====================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, Text, VStack } from "@chakra-ui/react"
import type { ChatMessage } from "../types"

interface Landmark {
  index: number            // 在 messages 数组中的索引
  preview: string          // 截断的文本预览
}

interface MiniTimelineProps {
  messages: ChatMessage[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/** 从消息中提取用户消息作为路标 */
function extractLandmarks(messages: ChatMessage[]): Landmark[] {
  const landmarks: Landmark[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role !== "user") continue
    const text = msg.content?.trim() ?? ""
    if (!text) continue
    landmarks.push({
      index: i,
      preview: text.length > 40 ? text.slice(0, 40) + "…" : text,
    })
  }
  return landmarks
}

export function MiniTimeline({ messages, scrollContainerRef }: MiniTimelineProps) {
  const [hovered, setHovered] = useState(false)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const landmarks = useMemo(() => extractLandmarks(messages), [messages])

  // ── 滚动时检测当前活跃路标 ──
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    // 从下往上找第一个在视口上方的用户消息
    let closestIdx: number | null = null
    for (let i = landmarks.length - 1; i >= 0; i--) {
      const lm = landmarks[i]!
      const el = document.querySelector(`[data-msg-index="${lm.index}"]`)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const relTop = rect.top - containerRect.top
      if (relTop <= container.clientHeight * 0.5) {
        closestIdx = lm.index
        break
      }
    }
    setActiveIdx(closestIdx)
  }, [landmarks, scrollContainerRef])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    container.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll() // initial
    return () => container.removeEventListener("scroll", handleScroll)
  }, [handleScroll, scrollContainerRef])

  // ── 点击路标 → 滚动到对应消息 ──
  const jumpTo = useCallback((index: number) => {
    const el = document.querySelector(`[data-msg-index="${index}"]`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [])

  // ── 延迟收起，避免鼠标快速划过时闪烁 ──
  const handleMouseEnter = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    setHovered(true)
  }, [])
  const handleMouseLeave = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => setHovered(false), 300)
  }, [])

  if (landmarks.length <= 1) return null

  return (
    <>
      {/* 收起态：右侧中间小把手，仅 ~48px 高，不占满全高 */}
      {!hovered && (
        <Box
          position="absolute"
          right={0}
          top="50%"
          transform="translateY(-50%)"
          zIndex={20}
          w="14px"
          h={`${Math.min(landmarks.length * 12 + 16, 120)}px`}
          display="flex"
          alignItems="center"
          justifyContent="center"
          cursor="pointer"
          onMouseEnter={handleMouseEnter}
          transition="background 0.2s"
          borderRadius="8px 0 0 8px"
          _hover={{ bg: "gray.800/60" }}
        >
          <VStack gap="5px" align="center">
            {landmarks.map((lm) => (
              <Box
                key={lm.index}
                w="4px"
                h="4px"
                borderRadius="full"
                bg={activeIdx === lm.index ? "blue.400" : "gray.600"}
                title={lm.preview}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); jumpTo(lm.index) }}
              />
            ))}
          </VStack>
        </Box>
      )}

      {/* 展开态：全高面板 */}
      {hovered && (
        <Box
          position="absolute"
          right={0}
          top={0}
          bottom={0}
          zIndex={20}
          width="180px"
          bg="gray.900/95"
          borderLeft="1px solid"
          borderColor="gray.800"
          style={{ backdropFilter: "blur(8px)" }}
          onMouseLeave={handleMouseLeave}
          animation="fadeIn 0.15s ease"
        >
          <Box flex={1} overflowY="auto" px={3} py={4} h="100%">
            <Text fontSize="xs" color="gray.500" mb={2} fontWeight="bold">
              对话大纲
            </Text>
            <VStack gap={0} align="stretch">
              {landmarks.map((lm) => (
                <Box
                  key={lm.index}
                  px={2}
                  py={1.5}
                  borderRadius="md"
                  cursor="pointer"
                  fontSize="xs"
                  color={activeIdx === lm.index ? "blue.300" : "gray.400"}
                  bg={activeIdx === lm.index ? "blue.900/40" : "transparent"}
                  borderLeft={activeIdx === lm.index ? "2px solid" : "2px solid transparent"}
                  borderColor={activeIdx === lm.index ? "blue.400" : "transparent"}
                  _hover={{ bg: "gray.800", color: "gray.200" }}
                  transition="all 0.15s"
                  onClick={() => jumpTo(lm.index)}
                  title={lm.preview}
                >
                  {lm.preview}
                </Box>
              ))}
            </VStack>
          </Box>
        </Box>
      )}
    </>
  )
}
