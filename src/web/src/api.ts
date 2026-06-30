// src/web/src/api.ts
// ====================================================
// API 客户端层 — 所有后端通信
// ====================================================

import type { SessionInfo, ChatMessage, AgentInfo, AppConfig, QuotaInfo, TierInfo, SwitchTierResult, AuthUser, AuthTokens, LicenseInfo, ToolInfo, ToolReloadResult, AddToolResult, SkillInfo, SkillReloadResult, AddSkillResult } from "./types"

const BASE = "/api"

/** 请求超时毫秒数 */
const REQUEST_TIMEOUT = 30000

/** 当前认证令牌（由 AuthContext 注入） */
let authToken: string | null = localStorage.getItem("try_token")

export function setAuthToken(token: string | null) {
  authToken = token
  if (token) localStorage.setItem("try_token", token)
  else localStorage.removeItem("try_token")
}

export function getAuthToken(): string | null {
  return authToken
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  const { headers: optHeaders, ...rest } = options
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(optHeaders as Record<string, string> ?? {}),
    }
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`
    }
    const res = await fetch(BASE + path, {
      headers,
      signal: controller.signal,
      ...rest,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      let errMsg = body.error?.message ?? body.error ?? ""
      if (!errMsg) {
        errMsg = res.status === 401 ? "请先登录" : `请求失败 (HTTP ${res.status})`
      }
      const err = new Error(errMsg) as Error & { status: number; code: string }
      err.status = res.status
      err.code = body.error?.code ?? ""
      throw err
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ── 会话 ──

export async function fetchSessions(): Promise<SessionInfo[]> {
  const res = await request<{ success: boolean; data: SessionInfo[] }>("/sessions?limit=200")
  return res.data ?? []
}

export async function createSession(title?: string): Promise<SessionInfo> {
  const res = await request<{ success: boolean; data: SessionInfo }>("/sessions", {
    method: "POST",
    body: JSON.stringify({ title: title || "新会话" }),
  })
  return res.data!
}

export async function fetchSession(id: string): Promise<{ title: string; messages: ChatMessage[] }> {
  const res = await request<{ success: boolean; data: { title: string; messages: ChatMessage[] } }>(`/sessions/${id}`)
  return res.data!
}

export async function deleteSession(id: string): Promise<void> {
  await request(`/sessions/${id}`, { method: "DELETE" })
}

export async function renameSession(id: string, title: string): Promise<void> {
  await request(`/sessions/${id}/rename`, {
    method: "PUT",
    body: JSON.stringify({ title }),
  })
}

export async function clearSession(id: string): Promise<void> {
  await request(`/sessions/${id}/clear`, { method: "POST" })
}

export async function setSessionAgent(sessionId: string, agentId: string): Promise<void> {
  await request(`/sessions/${sessionId}/agent`, {
    method: "PUT",
    body: JSON.stringify({ agentId }),
  })
}

// ── Agent ──

export async function fetchAgents(): Promise<AgentInfo[]> {
  const res = await request<{ success: boolean; data: AgentInfo[] }>("/agents")
  return res.data ?? []
}

// ── 配置 ──

export async function fetchConfig(): Promise<AppConfig> {
  const res = await request<{ success: boolean; data: AppConfig }>("/config")
  return res.data!
}

export async function saveConfig(config: Partial<AppConfig>): Promise<void> {
  await request("/config", { method: "PUT", body: JSON.stringify(config) })
}

// ── 配额 ──

export async function fetchQuota(): Promise<QuotaInfo> {
  const res = await request<{ success: boolean; data: QuotaInfo }>("/subscription/quota")
  return res.data!
}

// ── 订阅等级 ──

export async function fetchTiers(): Promise<TierInfo[]> {
  const res = await request<{ success: boolean; data: TierInfo[] }>("/subscription/tiers")
  return res.data ?? []
}

export async function switchMyTier(tierId: string): Promise<SwitchTierResult> {
  const res = await request<{ success: boolean; data: SwitchTierResult }>("/subscription/me/tier", {
    method: "PUT",
    body: JSON.stringify({ tierId }),
  })
  return res.data!
}

// ── Workspace ──

export interface WorkspaceInfo {
  workspace: string
  subdirs?: string[]
  configured?: boolean
}

export async function fetchDefaultWorkspace(): Promise<WorkspaceInfo> {
  const res = await request<{ success: boolean; data: WorkspaceInfo }>("/workspace")
  return res.data!
}

export async function getSessionWorkspace(sessionId: string): Promise<WorkspaceInfo> {
  const res = await request<{ success: boolean; data: WorkspaceInfo }>(`/sessions/${sessionId}/workspace`)
  return res.data!
}

export async function updateSessionWorkspace(sessionId: string, workspace: string): Promise<WorkspaceInfo> {
  const res = await request<{ success: boolean; data: WorkspaceInfo }>(`/sessions/${sessionId}/workspace`, {
    method: "PUT",
    body: JSON.stringify({ workspace }),
  })
  return res.data!
}

// ── 确认 ──

export async function confirmTool(sessionId: string, approved: boolean): Promise<void> {
  await request("/chat/confirm", {
    method: "POST",
    body: JSON.stringify({ sessionId, approved }),
  })
}

// ── License ──

export async function fetchLicense(): Promise<LicenseInfo> {
  const res = await request<{ success: boolean; data: LicenseInfo }>("/license")
  return res.data!
}

export async function activateLicense(licenseKey: string, licensee?: string): Promise<LicenseInfo> {
  const res = await request<{ success: boolean; data: LicenseInfo }>("/license/activate", {
    method: "POST",
    body: JSON.stringify({ licenseKey, licensee }),
  })
  return res.data!
}

// ── 认证 ──

export async function login(email: string, password: string): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const res = await request<{ success: boolean; data: { user: AuthUser; tokens: AuthTokens } }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  return res.data!
}

export async function register(name: string, email: string, password: string): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const res = await request<{ success: boolean; data: { user: AuthUser; tokens: AuthTokens } }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  })
  return res.data!
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await request<{ success: boolean; data: AuthUser }>("/auth/me")
  return res.data!
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST" })
}

// ── 工具管理 ──

export async function fetchTools(): Promise<ToolInfo[]> {
  const res = await request<{ success: boolean; data: ToolInfo[] }>("/tools")
  return res.data ?? []
}

export async function reloadTools(): Promise<ToolReloadResult> {
  const res = await request<{ success: boolean; data: ToolReloadResult }>("/tools/reload", { method: "POST" })
  return res.data!
}

export async function addUserTool(sourcePath: string): Promise<AddToolResult> {
  const res = await request<{ success: boolean; data: AddToolResult }>("/tools/user", {
    method: "POST",
    body: JSON.stringify({ sourcePath }),
  })
  return res.data!
}

export async function deleteUserTool(name: string): Promise<ToolReloadResult> {
  const res = await request<{ success: boolean; data: { name: string; reloadResult: ToolReloadResult } }>(`/tools/user/${encodeURIComponent(name)}`, { method: "DELETE" })
  return res.data!.reloadResult
}

// ── Skill 管理 ──

export async function fetchSkills(): Promise<SkillInfo[]> {
  const res = await request<{ success: boolean; data: SkillInfo[] }>("/skills")
  return res.data ?? []
}

export async function reloadSkills(): Promise<SkillReloadResult> {
  const res = await request<{ success: boolean; data: SkillReloadResult }>("/skills/reload", { method: "POST" })
  return res.data!
}

export async function addUserSkill(sourcePath: string): Promise<AddSkillResult> {
  const res = await request<{ success: boolean; data: AddSkillResult }>("/skills/user", {
    method: "POST",
    body: JSON.stringify({ sourcePath }),
  })
  return res.data!
}

export async function deleteUserSkill(name: string): Promise<SkillReloadResult> {
  const res = await request<{ success: boolean; data: { name: string; total: number } }>(`/skills/user/${encodeURIComponent(name)}`, { method: "DELETE" })
  return { total: res.data!.total }
}
