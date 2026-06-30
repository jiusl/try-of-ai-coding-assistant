// src/infra/circuit-breaker.ts
// ====================================================
// 熔断器 — 保护下游 Provider 调用不被雪崩
// ====================================================

import { Effect, Duration, Schedule, Ref, Option } from "effect"
import { logger } from "./logger.js"

// -------------------------------------------------
// 类型定义
// -------------------------------------------------

export type CircuitState = "closed" | "open" | "half_open"

export interface CircuitBreakerConfig {
  /** 失败阈值（连续失败多少次后熔断） */
  failureThreshold: number
  /** 熔断后等待多久尝试半开（毫秒） */
  openTimeoutMs: number
  /** 半开状态下允许的探测请求数 */
  halfOpenMaxProbes: number
  /** 成功窗口大小（连续成功多少次后完全闭合） */
  successThreshold: number
}

export interface CircuitBreakerState {
  state: CircuitState
  failureCount: number
  successCount: number
  lastFailureTime: number
  openedAt: number
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  openTimeoutMs: 30_000,    // 30 秒后尝试半开
  halfOpenMaxProbes: 1,     // 半开时最多 1 个探测请求
  successThreshold: 2,      // 连续 2 次成功后闭合
}

// -------------------------------------------------
// 熔断器实现
// -------------------------------------------------

export class CircuitBreaker {
  private config: CircuitBreakerConfig
  private stateRef: Ref.Ref<CircuitBreakerState>
  /** 半开状态下正在执行的探测请求数 */
  private probeCount: number

  constructor(
    public readonly name: string,
    config?: Partial<CircuitBreakerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.stateRef = Ref.unsafeMake<CircuitBreakerState>({
      state: "closed",
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      openedAt: 0,
    })
    this.probeCount = 0
  }

  /** 获取当前状态快照 */
  getState(): Effect.Effect<CircuitBreakerState> {
    return Ref.get(this.stateRef)
  }

  /** 包装一个 Effect，加入熔断保护 */
  wrap<A, E>(
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | CircuitBreakerOpenError> {
    const self = this
    return Effect.gen(function* () {
      // 1. 检查熔断状态
      const state = yield* Ref.get(self.stateRef)

      if (state.state === "open") {
        const elapsed = Date.now() - state.openedAt
        if (elapsed >= self.config.openTimeoutMs) {
          // 进入半开状态
          yield* Ref.set(self.stateRef, {
            state: "half_open" as CircuitState,
            failureCount: state.failureCount,
            successCount: 0,
            lastFailureTime: state.lastFailureTime,
            openedAt: state.openedAt,
          })
          logger.info(`熔断器 [${self.name}]: 进入半开状态`)
        } else {
          // 仍在熔断中
          return yield* Effect.fail(
            new CircuitBreakerOpenError({ breakerName: self.name }),
          )
        }
      }

      // 2. 半开状态下限制探测请求数
      const currentState = yield* Ref.get(self.stateRef)
      if (currentState.state === "half_open") {
        if (self.probeCount >= self.config.halfOpenMaxProbes) {
          return yield* Effect.fail(
            new CircuitBreakerOpenError({ breakerName: self.name }),
          )
        }
        self.probeCount++
      }

      // 3. 执行实际请求
      try {
        const result = yield* effect

        // 成功：记录成功
        if (currentState.state === "half_open") {
          const newSuccessCount = currentState.successCount + 1
          if (newSuccessCount >= self.config.successThreshold) {
            yield* Ref.set(self.stateRef, {
              state: "closed" as CircuitState,
              failureCount: 0,
              successCount: 0,
              lastFailureTime: 0,
              openedAt: 0,
            })
            logger.info(`熔断器 [${self.name}]: 闭合（恢复）`)
          } else {
            yield* Ref.update(self.stateRef, (s) => ({
              ...s,
              successCount: newSuccessCount,
            }))
          }
        } else {
          // closed 状态下也重置失败计数
          yield* Ref.update(self.stateRef, (s) => ({
            ...s,
            failureCount: 0,
          }))
        }

        return result
      } catch (error) {
        // 失败：记录失败
        const newState = yield* Ref.updateAndGet(self.stateRef, (s) => ({
          ...s,
          failureCount: s.failureCount + 1,
          lastFailureTime: Date.now(),
        }))

        if (
          newState.state === "closed" &&
          newState.failureCount >= self.config.failureThreshold
        ) {
          yield* Ref.set(self.stateRef, {
            state: "open" as CircuitState,
            failureCount: newState.failureCount,
            successCount: 0,
            lastFailureTime: Date.now(),
            openedAt: Date.now(),
          })
          logger.warn(
            `熔断器 [${self.name}]: 打开 — 连续 ${newState.failureCount} 次失败`,
          )
        }

        if (newState.state === "half_open") {
          yield* Ref.set(self.stateRef, {
            state: "open" as CircuitState,
            failureCount: newState.failureCount,
            successCount: 0,
            lastFailureTime: Date.now(),
            openedAt: Date.now(),
          })
          logger.warn(`熔断器 [${self.name}]: 半开探测失败，重新打开`)
        }

        throw error
      } finally {
        if (currentState.state === "half_open") {
          self.probeCount--
        }
      }
    })
  }

  /** 手动重置熔断器 */
  reset(): Effect.Effect<void> {
    return Ref.set(this.stateRef, {
      state: "closed" as CircuitState,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      openedAt: 0,
    })
  }
}

// -------------------------------------------------
// 错误类型
// -------------------------------------------------

export class CircuitBreakerOpenError {
  readonly _tag = "CircuitBreakerOpenError"
  constructor(readonly options: { breakerName: string; message?: string }) {}
  get message(): string {
    return this.options.message ?? `熔断器已打开: ${this.options.breakerName}`
  }
  toString(): string {
    return `CircuitBreakerOpenError: ${this.message}`
  }
}

// -------------------------------------------------
// 预置熔断器实例
// -------------------------------------------------

/** Provider 调用熔断器 */
export const providerBreaker = new CircuitBreaker("provider", {
  failureThreshold: 3,
  openTimeoutMs: 15_000,
  halfOpenMaxProbes: 1,
  successThreshold: 2,
})

/** 工具执行熔断器 */
export const toolBreaker = new CircuitBreaker("tool", {
  failureThreshold: 5,
  openTimeoutMs: 10_000,
  halfOpenMaxProbes: 1,
  successThreshold: 1,
})
