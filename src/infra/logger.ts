// src/infra/logger.ts
// ====================================================
// 结构化日志系统 — JSON 格式输出，支持 traceId 全链路追踪
// ====================================================

export type LogLevel = "debug" | "info" | "warn" | "error"

interface LogEntry {
  timestamp: string
  level: LogLevel
  traceId?: string
  message: string
  [key: string]: unknown
}

/** 当前日志级别，低于此级别的日志不会被输出 */
let currentLevel: LogLevel = (process.env.TRY_LOG_LEVEL as LogLevel) ?? "info"

/** 全局 traceId 存储，可通过 AsyncLocalStorage 或手动设置 */
const traceIdStore: { current: string | undefined } = { current: undefined }

/**
 * 设置当前请求的 traceId，贯穿整个请求生命周期
 */
export const setTraceId = (id: string) => { traceIdStore.current = id }
export const getTraceId = () => traceIdStore.current

/**
 * 生成新的 traceId
 */
export const newTraceId = (): string => crypto.randomUUID()

/**
 * 设置日志级别
 */
export const setLogLevel = (level: LogLevel) => { currentLevel = level }

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const shouldLog = (level: LogLevel) => LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel]

const formatEntry = (entry: LogEntry): string => JSON.stringify(entry)

const log = (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
  if (!shouldLog(level)) return

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(traceIdStore.current ? { traceId: traceIdStore.current } : {}),
    ...(extra ?? {}),
  }

  const output = formatEntry(entry)

  switch (level) {
    case "error":
      process.stderr.write(output + "\n")
      break
    default:
      process.stdout.write(output + "\n")
      break
  }
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>) => log("debug", message, extra),
  info: (message: string, extra?: Record<string, unknown>) => log("info", message, extra),
  warn: (message: string, extra?: Record<string, unknown>) => log("warn", message, extra),
  error: (message: string, extra?: Record<string, unknown>) => log("error", message, extra),

  /** 带 traceId 的子 logger，用于请求级别日志 */
  child: (traceId: string) => ({
    debug: (message: string, extra?: Record<string, unknown>) => {
      const prev = traceIdStore.current
      traceIdStore.current = traceId
      log("debug", message, extra)
      traceIdStore.current = prev
    },
    info: (message: string, extra?: Record<string, unknown>) => {
      const prev = traceIdStore.current
      traceIdStore.current = traceId
      log("info", message, extra)
      traceIdStore.current = prev
    },
    warn: (message: string, extra?: Record<string, unknown>) => {
      const prev = traceIdStore.current
      traceIdStore.current = traceId
      log("warn", message, extra)
      traceIdStore.current = prev
    },
    error: (message: string, extra?: Record<string, unknown>) => {
      const prev = traceIdStore.current
      traceIdStore.current = traceId
      log("error", message, extra)
      traceIdStore.current = prev
    },
  }),
}
