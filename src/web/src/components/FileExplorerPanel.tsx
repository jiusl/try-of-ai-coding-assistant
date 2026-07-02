// src/web/src/components/FileExplorerPanel.tsx
// ====================================================
// 右侧文件预览面板 — 多 tab 切换 + 可拖拽调宽
// ====================================================

import { useCallback, useRef, useEffect } from "react"
import { Box, HStack, Text, IconButton } from "@chakra-ui/react"
import { FileViewer } from "./FileViewer"

/** 从路径中提取文件名 */
function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || p
}

interface FileExplorerPanelProps {
  sessionId: string | null
  openTabs: string[]
  activeTabIndex: number
  isOpen: boolean
  onToggle: () => void
  onTabSwitch: (index: number) => void
  onTabClose: (index: number) => void
  /** 面板宽度（像素） */
  width: number
  /** 拖拽调整宽度回调（传入 deltaX，正值拓宽/负值缩窄） */
  onResize: (deltaX: number) => void
}

export function FileExplorerPanel({
  sessionId,
  openTabs,
  activeTabIndex,
  isOpen,
  onToggle,
  onTabSwitch,
  onTabClose,
  width,
  onResize,
}: FileExplorerPanelProps) {
  const resizingRef = useRef(false)
  const startXRef = useRef(0)
  const tabScrollRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    resizingRef.current = true
    startXRef.current = e.clientX
    e.preventDefault()
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      // 向左拖 = 拓宽面板，向右拖 = 缩窄面板
      const deltaX = startXRef.current - e.clientX
      startXRef.current = e.clientX
      onResize(deltaX)
    }
    const handleMouseUp = () => { resizingRef.current = false }
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [onResize])

  // 切换 tab 时自动滚动到可见位置
  useEffect(() => {
    if (!tabScrollRef.current) return
    const tabs = tabScrollRef.current.children
    if (activeTabIndex < tabs.length) {
      tabs[activeTabIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" })
    }
  }, [activeTabIndex])

  if (!isOpen) return null

  const activeFile = openTabs[activeTabIndex] ?? null

  return (
    <HStack gap={0} h="100vh" position="relative">
      {/* 拖拽手柄（左侧边框） */}
      <Box
        w="5px"
        h="100%"
        bg="gray.800"
        cursor="col-resize"
        _hover={{ bg: "blue.600" }}
        onMouseDown={handleMouseDown}
        flexShrink={0}
      />

      {/* 预览主体 */}
      <Box
        w={`${width}px`}
        minW="0px"
        h="100vh"
        borderLeft="1px solid"
        borderColor="gray.800"
        bg="gray.950"
        display="flex"
        flexDirection="column"
        overflow="hidden"
      >
        {/* Tab 栏 */}
        <HStack
          gap={0}
          borderBottom="1px solid"
          borderColor="gray.800"
          bg="gray.900"
          flexShrink={0}
          overflow="hidden"
        >
          {/* Tab 列表（可水平滚动） */}
          <Box
            ref={tabScrollRef}
            flex={1}
            overflowX="auto"
            overflowY="hidden"
            whiteSpace="nowrap"
            css={{
              "&::-webkit-scrollbar": { height: "3px" },
              "&::-webkit-scrollbar-thumb": { background: "#4a5568", borderRadius: "2px" },
            }}
          >
            {openTabs.map((tab, i) => {
              const active = i === activeTabIndex
              return (
                <Box
                  key={`${tab}-${i}`}
                  as="span"
                  display="inline-flex"
                  alignItems="center"
                  gap="4px"
                  px={3} py="6px"
                  fontSize="12px"
                  cursor="pointer"
                  color={active ? "white" : "gray.500"}
                  bg={active ? "gray.800" : "transparent"}
                  borderBottom={active ? "2px solid" : "2px solid transparent"}
                  borderColor={active ? "blue.400" : "transparent"}
                  _hover={active ? {} : { bg: "gray.800", color: "gray.300" }}
                  onClick={() => onTabSwitch(i)}
                  userSelect="none"
                  maxW="160px"
                >
                  <Text truncate flexShrink={1}>
                    {basename(tab)}
                  </Text>
                  <IconButton
                    aria-label={`关闭 ${basename(tab)}`}
                    size="2xs"
                    variant="ghost"
                    color="gray.500"
                    _hover={{ color: "red.300" }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onTabClose(i)
                    }}
                    flexShrink={0}
                    ml={1}
                  >
                    ✕
                  </IconButton>
                </Box>
              )
            })}
          </Box>

          {/* 关闭全部按钮 */}
          <IconButton
            aria-label="关闭文件浏览器"
            size="xs"
            variant="ghost"
            color="gray.500"
            onClick={onToggle}
            flexShrink={0}
            mr={1}
          >
            ✕
          </IconButton>
        </HStack>

        {/* 文件内容 */}
        <Box flex={1} overflow="hidden" display="flex" flexDirection="column">
          <FileViewer
            sessionId={sessionId}
            filePath={activeFile}
          />
        </Box>
      </Box>
    </HStack>
  )
}
