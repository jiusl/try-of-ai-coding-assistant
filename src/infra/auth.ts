// src/infra/auth.ts
// ====================================================
// 认证服务 — 密码哈希、登录验证、令牌管理
// ====================================================

import { Database as BunDatabase } from "bun:sqlite"
import { logger } from "./logger.js"

// -------------------------------------------------
// 类型定义
// -------------------------------------------------

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput {
  name: string
  email: string
  password: string
}

export interface AuthUser {
  id: string
  name: string
  email: string | undefined
  apiToken: string
  roles: string[]
  createdAt: string
}

// -------------------------------------------------
// 错误类型
// -------------------------------------------------

export class AuthError extends Error {
  constructor(
    message: string,
    public code: "invalid_credentials" | "user_not_found" | "email_exists" | "token_expired" | "token_revoked" | "weak_password",
  ) {
    super(message)
    this.name = "AuthError"
  }
}

// -------------------------------------------------
// 工具函数
// -------------------------------------------------

function getDbPath(): string {
  return process.env.TRY_DB_PATH ?? "./try.db"
}

/** 密码强度检查 */
function isPasswordStrong(password: string): boolean {
  return password.length >= 8
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
}

// -------------------------------------------------
// 认证服务
// -------------------------------------------------

class AuthService {
  /**
   * 用户注册（需要 License 未达上限）
   */
  register(input: RegisterInput): AuthUser {
    const db = new BunDatabase(getDbPath())
    try {
      // 检查邮箱是否已存在
      const existing = db.query("SELECT id FROM users WHERE email = ?").get(input.email) as { id: string } | undefined | null
      if (existing) {
        throw new AuthError("该邮箱已被注册", "email_exists")
      }

      // 密码强度检查
      if (!isPasswordStrong(input.password)) {
        throw new AuthError("密码需要至少8位，包含大小写字母和数字", "weak_password")
      }

      const id = crypto.randomUUID()
      const apiToken = crypto.randomUUID().replace(/-/g, "")
      const passwordHash = Bun.password.hashSync(input.password)
      const now = new Date().toISOString()

      db.run(
        `INSERT INTO users (id, name, api_token, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, input.name, apiToken, input.email, passwordHash, now, now],
      )

      // 默认赋予 viewer 角色
      db.run(
        `INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?)`,
        [id, "viewer", "system"],
      )

      logger.info(`认证: 用户注册 ${input.email} (${id})`)

      return {
        id,
        name: input.name,
        email: input.email,
        apiToken,
        roles: ["viewer"],
        createdAt: now,
      }
    } finally {
      db.close()
    }
  }

  /**
   * 用户登录 — 验证邮箱和密码，返回 API Token
   */
  login(input: LoginInput): { user: AuthUser; tokens: AuthTokens } {
    const db = new BunDatabase(getDbPath())
    try {
      const row = db.query(
        `SELECT u.id, u.name, u.api_token, u.email, u.password_hash, u.created_at,
                GROUP_CONCAT(r.id) as role_ids
         FROM users u
         LEFT JOIN user_roles ur ON u.id = ur.user_id
         LEFT JOIN roles r ON ur.role_id = r.id
         WHERE u.email = ?
         GROUP BY u.id`,
      ).get(input.email) as {
        id: string
        name: string
        api_token: string
        email: string | null
        password_hash: string | null
        created_at: string
        role_ids: string | null
      } | undefined | null

      if (!row) {
        throw new AuthError("邮箱或密码错误", "invalid_credentials")
      }

      if (!row.password_hash) {
        throw new AuthError("该账户未设置密码，请使用 API Token 登录", "invalid_credentials")
      }

      const passwordValid = Bun.password.verifySync(input.password, row.password_hash)
      if (!passwordValid) {
        throw new AuthError("邮箱或密码错误", "invalid_credentials")
      }

      // 生成刷新令牌
      const refreshToken = crypto.randomUUID().replace(/-/g, "")
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7天

      db.run(
        `INSERT INTO auth_tokens (id, user_id, token, type, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), row.id, refreshToken, "refresh", expiresAt],
      )

      const user: AuthUser = {
        id: row.id,
        name: row.name,
        email: row.email ?? undefined,
        apiToken: row.api_token,
        roles: row.role_ids ? row.role_ids.split(",") : [],
        createdAt: row.created_at,
      }

      logger.info(`认证: 用户登录 ${input.email}`)

      return {
        user,
        tokens: {
          accessToken: row.api_token,
          refreshToken,
          expiresAt,
        },
      }
    } finally {
      db.close()
    }
  }

  /**
   * 刷新访问令牌 — 用 refresh token 换新的 access token
   */
  refreshToken(refreshToken: string): AuthTokens {
    const db = new BunDatabase(getDbPath())
    try {
      const row = db.query(
        `SELECT t.id as token_id, t.user_id, t.expires_at, t.revoked_at, u.api_token
         FROM auth_tokens t
         INNER JOIN users u ON t.user_id = u.id
         WHERE t.token = ? AND t.type = 'refresh'`,
      ).get(refreshToken) as {
        token_id: string
        user_id: string
        expires_at: string
        revoked_at: string | null
        api_token: string
      } | undefined | null

      if (!row) {
        throw new AuthError("无效的刷新令牌", "token_expired")
      }

      if (row.revoked_at) {
        throw new AuthError("刷新令牌已被撤销", "token_revoked")
      }

      if (new Date(row.expires_at) < new Date()) {
        throw new AuthError("刷新令牌已过期", "token_expired")
      }

      // 撤销旧刷新令牌
      db.run("UPDATE auth_tokens SET revoked_at = datetime('now') WHERE id = ?", [row.token_id])

      // 生成新的 API Token 和刷新令牌
      const newApiToken = crypto.randomUUID().replace(/-/g, "")
      const newRefreshToken = crypto.randomUUID().replace(/-/g, "")
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      db.run("UPDATE users SET api_token = ?, updated_at = datetime('now') WHERE id = ?", [newApiToken, row.user_id])
      db.run(
        `INSERT INTO auth_tokens (id, user_id, token, type, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), row.user_id, newRefreshToken, "refresh", newExpiresAt],
      )

      logger.info(`认证: 刷新令牌 user=${row.user_id}`)

      return {
        accessToken: newApiToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
      }
    } finally {
      db.close()
    }
  }

  /**
   * 登出 — 撤销所有刷新令牌
   */
  logout(apiToken: string): void {
    const db = new BunDatabase(getDbPath())
    try {
      const user = db.query("SELECT id FROM users WHERE api_token = ?").get(apiToken) as { id: string } | undefined | null
      if (!user) return

      db.run("UPDATE auth_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL", [user.id])
      // 重新生成 API Token（使旧 token 失效）
      const newApiToken = crypto.randomUUID().replace(/-/g, "")
      db.run("UPDATE users SET api_token = ?, updated_at = datetime('now') WHERE id = ?", [newApiToken, user.id])

      logger.info(`认证: 用户登出 user=${user.id}`)
    } finally {
      db.close()
    }
  }

  /**
   * 修改密码
   */
  changePassword(userId: string, oldPassword: string, newPassword: string): void {
    const db = new BunDatabase(getDbPath())
    try {
      const row = db.query("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string | null } | undefined | null
      if (!row) {
        throw new AuthError("用户不存在", "user_not_found")
      }

      if (row.password_hash) {
        const valid = Bun.password.verifySync(oldPassword, row.password_hash)
        if (!valid) {
          throw new AuthError("原密码错误", "invalid_credentials")
        }
      }

      if (!isPasswordStrong(newPassword)) {
        throw new AuthError("新密码需要至少8位，包含大小写字母和数字", "weak_password")
      }

      const newHash = Bun.password.hashSync(newPassword)
      db.run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [newHash, userId])

      // 撤销所有刷新令牌（强制重新登录）
      db.run("UPDATE auth_tokens SET revoked_at = datetime('now') WHERE user_id = ?", [userId])

      logger.info(`认证: 密码已修改 user=${userId}`)
    } finally {
      db.close()
    }
  }

  /**
   * 检查用户是否有密码（是否支持密码登录）
   */
  hasPassword(userId: string): boolean {
    const db = new BunDatabase(getDbPath())
    try {
      const row = db.query("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string | null } | undefined | null
      return !!(row?.password_hash)
    } finally {
      db.close()
    }
  }
}

// -------------------------------------------------
// 单例导出
// -------------------------------------------------

export const authService = new AuthService()
