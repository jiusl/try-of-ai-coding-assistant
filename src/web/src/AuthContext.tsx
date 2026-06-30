// src/web/src/AuthContext.tsx
// ====================================================
// 认证上下文 — 全应用共享登录状态
// ====================================================

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import type { AuthUser } from "./types"
import * as api from "./api"

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // 初始化 — 从 localStorage 恢复 token 并验证
  useEffect(() => {
    const token = api.getAuthToken()
    if (!token) {
      setIsLoading(false)
      return
    }
    api.fetchMe()
      .then((u) => setUser(u))
      .catch(() => {
        // token 已过期/无效，清除
        api.setAuthToken(null)
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password)
    api.setAuthToken(result.tokens.accessToken)
    setUser(result.user)
  }, [])

  const register = useCallback(async (name: string, email: string, password: string) => {
    const result = await api.register(name, email, password)
    api.setAuthToken(result.tokens.accessToken)
    setUser(result.user)
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } catch { /* 忽略网络错误 */ }
    api.setAuthToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be inside AuthProvider")
  return ctx
}
