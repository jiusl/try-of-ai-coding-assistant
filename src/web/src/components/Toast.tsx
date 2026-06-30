// src/web/src/components/Toast.tsx
// ====================================================
// 轻量 Toast 通知系统（不依赖 Chakra UI toaster）
// ====================================================

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode, type CSSProperties } from "react"
import { Box, VStack, Text, HStack } from "@chakra-ui/react"

// ──── 类型 ────

export type ToastType = "success" | "error" | "warning" | "info"

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number // ms, 0 表示不自动关闭
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (t: Omit<Toast, "id">) => string
  removeToast: (id: string) => void
  success: (title: string, message?: string) => string
  error: (title: string, message?: string) => string
  warning: (title: string, message?: string) => string
  info: (title: string, message?: string) => string
}

// ──── Context ────

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}

// ──── Provider ────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const addToast = useCallback(
    (t: Omit<Toast, "id">): string => {
      const id = crypto.randomUUID()
      const toast: Toast = { ...t, id }
      setToasts((prev) => [...prev.slice(-4), toast]) // max 5 visible
      const dur = t.duration ?? 5000
      if (dur > 0) {
        const timer = setTimeout(() => removeToast(id), dur)
        timers.current.set(id, timer)
      }
      return id
    },
    [removeToast],
  )

  const success = useCallback((title: string, message?: string) => addToast({ type: "success", title, ...(message ? { message } : {}) }), [addToast])
  const error = useCallback((title: string, message?: string) => addToast({ type: "error", title, ...(message ? { message } : {}) }), [addToast])
  const warning = useCallback((title: string, message?: string) => addToast({ type: "warning", title, ...(message ? { message } : {}) }), [addToast])
  const info = useCallback((title: string, message?: string) => addToast({ type: "info", title, ...(message ? { message } : {}) }), [addToast])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t))
      timers.current.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </ToastContext.Provider>
  )
}

// ──── Toast Container ────

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "#0d2818", border: "#22c55e", icon: "✅" },
  error: { bg: "#2d0f0f", border: "#ef4444", icon: "❌" },
  warning: { bg: "#2d1f0a", border: "#f59e0b", icon: "⚠️" },
  info: { bg: "#0a1a2d", border: "#3b82f6", icon: "ℹ️" },
}

function ToastContainer({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  return (
    <VStack
      position="fixed"
      top={4}
      right={4}
      zIndex={9999}
      gap={2}
      align="stretch"
      maxW="380px"
      pointerEvents="none"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={onClose} />
      ))}
    </VStack>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: string) => void }) {
  const s = TYPE_STYLES[toast.type]
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // trigger enter animation
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const style: CSSProperties = {
    background: s.bg,
    borderLeft: `4px solid ${s.border}`,
    borderRadius: 8,
    padding: "12px 16px",
    pointerEvents: "auto",
    cursor: "pointer",
    opacity: visible ? 1 : 0,
    transform: visible ? "translateX(0)" : "translateX(40px)",
    transition: "opacity 0.3s, transform 0.3s",
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
  }

  return (
    <HStack gap={3} style={style} onClick={() => onClose(toast.id)}>
      <Text fontSize="lg">{s.icon}</Text>
      <Box flex={1}>
        <Text fontWeight={600} fontSize="sm" color="white">
          {toast.title}
        </Text>
        {toast.message && (
          <Text fontSize="xs" color="gray.400" mt={0.5}>
            {toast.message}
          </Text>
        )}
      </Box>
      <Text fontSize="xs" color="gray.500" cursor="pointer">
        ✕
      </Text>
    </HStack>
  )
}
