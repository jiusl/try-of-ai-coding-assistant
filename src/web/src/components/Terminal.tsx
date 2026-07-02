// src/web/src/components/Terminal.tsx
// ====================================================
// Web 终端面板 — 基于 xterm.js + WebSocket PTY
// ====================================================

import { useEffect, useRef, useCallback, useState } from "react"
import { Box, HStack, Text, IconButton } from "@chakra-ui/react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
// @ts-expect-error CSS import has no type declarations
import "@xterm/xterm/css/xterm.css"

interface TerminalProps {
  sessionId: string | null
  workspace: string
  /** 终端面板高度（像素），由父组件控制 */
  height: number
  /** 拖拽调整高度回调 */
  onResize?: (deltaY: number) => void
  /** 关闭终端 */
  onClose: () => void
}

export function TerminalPanel({ sessionId, workspace, height, onResize, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<"connecting" | "connected" | "closed">("connecting")
  const resizingRef = useRef(false)
  const startYRef = useRef(0)

  // ── 拖拽调整高度 ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    resizingRef.current = true
    startYRef.current = e.clientY
    e.preventDefault()
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const deltaY = startYRef.current - e.clientY
      startYRef.current = e.clientY
      onResize?.(deltaY)
    }
    const handleMouseUp = () => { resizingRef.current = false }
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [onResize])

  // ── 初始化 & 连接 xterm ──
  useEffect(() => {
    if (!containerRef.current || !sessionId) return

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#00d4ff",
        selectionBackground: "#3a3a5e",
      },
      allowProposedApi: true,
    })
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    xtermRef.current = term

    // ── WebSocket 连接 ──
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.host}/api/terminal?sessionId=${encodeURIComponent(sessionId)}`
    const ws = new WebSocket(wsUrl)
    ws.binaryType = "arraybuffer"
    wsRef.current = ws

    ws.onopen = () => {
      setStatus("connected")
      term.focus()
      fitAddon.fit()
    }

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data))
      } else if (typeof event.data === "string") {
        term.write(event.data)
      }
    }

    ws.onclose = () => setStatus("closed")
    ws.onerror = () => setStatus("closed")

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data))
      }
    })

    // ── 窗口大小变化时重新适配 ──
    const handleResize = () => { fitAddon.fit() }
    const ro = new ResizeObserver(handleResize)
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      term.dispose()
      ws.close()
    }
  }, [sessionId])

  // ── 重新适配 (当 height 变化) ──
  useEffect(() => {
    fitAddonRef.current?.fit()
  }, [height])

  // ── 监听 Ctrl+D / exit 等关闭信号后聚焦回聊天 ──
  useEffect(() => {
    if (status === "closed") {
      // 自动关闭终端面板
      const timer = setTimeout(() => onClose(), 1000)
      return () => clearTimeout(timer)
    }
  }, [status, onClose])

  return (
    <Box
      borderTop="1px solid"
      borderColor="gray.700"
      bg="gray.950"
      position="relative"
    >
      {/* 拖拽调整栏 */}
      <Box
        h="5px"
        bg="gray.800"
        cursor="ns-resize"
        _hover={{ bg: "blue.700" }}
        onMouseDown={handleMouseDown}
        title="拖拽调整终端高度"
      />

      {/* 顶栏 */}
      <HStack
        px={3} py={1}
        bg="gray.900"
        borderBottom="1px solid"
        borderColor="gray.800"
        justify="space-between"
      >
        <HStack gap={2}>
          <Box
            w="8px" h="8px"
            borderRadius="full"
            bg={status === "connected" ? "green.400" : status === "connecting" ? "yellow.400" : "red.400"}
          />
          <Text fontSize="xs" color="gray.400" fontFamily="mono">
            终端 · {workspace || "—"}
          </Text>
          {status === "connecting" && (
            <Text fontSize="xs" color="yellow.400">连接中…</Text>
          )}
          {status === "closed" && (
            <Text fontSize="xs" color="red.400">已断开</Text>
          )}
        </HStack>
        <IconButton
          aria-label="关闭终端"
          size="2xs"
          variant="ghost"
          color="gray.500"
          _hover={{ color: "white", bg: "gray.800" }}
          onClick={onClose}
        >
          ✕
        </IconButton>
      </HStack>

      {/* xterm 容器 */}
      <Box
        ref={containerRef}
        w="100%"
        h={`${height}px`}
      />
    </Box>
  )
}
