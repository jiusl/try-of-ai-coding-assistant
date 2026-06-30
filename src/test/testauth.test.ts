// src/test/testauth.test.ts
// ====================================================
// 认证服务测试
// ====================================================

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { authService, AuthError } from "../infra/auth.js"
import { existsSync, unlinkSync } from "fs"

const TEST_DB = ".test_auth_test.db"

// 辅助：设置测试数据库
function setupTestDb(): BunDatabase {
  const db = new BunDatabase(TEST_DB)
  // 创建基础表（模拟 migration 结果）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      api_token TEXT UNIQUE,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, permissions TEXT);
    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      granted_by TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'refresh',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT OR IGNORE INTO roles (id, name, permissions) VALUES ('viewer', 'Viewer', '');
  `)
  return db
}

beforeAll(() => {
  // 先清理上次运行残留的测试数据库
  try { if (existsSync(TEST_DB)) unlinkSync(TEST_DB) } catch { /* ignore */ }
  try { if (existsSync(TEST_DB + "-shm")) unlinkSync(TEST_DB + "-shm") } catch { /* ignore */ }
  try { if (existsSync(TEST_DB + "-wal")) unlinkSync(TEST_DB + "-wal") } catch { /* ignore */ }
  setupTestDb()
  process.env.TRY_DB_PATH = TEST_DB
})

afterAll(() => {
  // 清理 — Windows 上 SQLite 文件可能被锁定，忽略 EBUSY
  try { if (existsSync(TEST_DB)) unlinkSync(TEST_DB) } catch { /* ignore */ }
  try { if (existsSync(TEST_DB + "-shm")) unlinkSync(TEST_DB + "-shm") } catch { /* ignore */ }
  try { if (existsSync(TEST_DB + "-wal")) unlinkSync(TEST_DB + "-wal") } catch { /* ignore */ }
  delete process.env.TRY_DB_PATH
})

describe("AuthService", () => {

  describe("register", () => {
    it("成功注册新用户", () => {
      const user = authService.register({
        name: "Test User",
        email: "test@example.com",
        password: "Strong1Pass",
      })
      expect(user.id).toBeTruthy()
      expect(user.name).toBe("Test User")
      expect(user.email).toBe("test@example.com")
      expect(user.apiToken).toBeTruthy()
      expect(user.roles).toContain("viewer")
    })

    it("重复邮箱注册报错", () => {
      expect(() =>
        authService.register({
          name: "Another",
          email: "test@example.com",
          password: "Strong1Pass",
        })
      ).toThrow(AuthError)
    })

    it("弱密码注册报错 — 太短", () => {
      expect(() =>
        authService.register({
          name: "Weak",
          email: "weak@example.com",
          password: "Ab1",
        })
      ).toThrow(AuthError)
    })

    it("弱密码注册报错 — 缺少大写", () => {
      expect(() =>
        authService.register({
          name: "NoUpper",
          email: "noupper@example.com",
          password: "alllowercase1",
        })
      ).toThrow(AuthError)
    })

    it("弱密码注册报错 — 缺少小写", () => {
      expect(() =>
        authService.register({
          name: "NoLower",
          email: "nolower@example.com",
          password: "ALLUPPERCASE1",
        })
      ).toThrow(AuthError)
    })

    it("弱密码注册报错 — 缺少数字", () => {
      expect(() =>
        authService.register({
          name: "NoDigit",
          email: "nodigit@example.com",
          password: "NoDigitHere",
        })
      ).toThrow(AuthError)
    })
  })

  describe("login", () => {
    it("正确凭据登录成功", () => {
      const result = authService.login({
        email: "test@example.com",
        password: "Strong1Pass",
      })
      expect(result.user.name).toBe("Test User")
      expect(result.tokens.accessToken).toBeTruthy()
      expect(result.tokens.refreshToken).toBeTruthy()
      expect(result.tokens.expiresAt).toBeTruthy()
    })

    it("错误密码登录失败", () => {
      expect(() =>
        authService.login({
          email: "test@example.com",
          password: "WrongPassword1",
        })
      ).toThrow(AuthError)
    })

    it("不存在用户登录失败", () => {
      expect(() =>
        authService.login({
          email: "nonexistent@example.com",
          password: "Whatever1Pass",
        })
      ).toThrow(AuthError)
    })
  })

  describe("hasPassword", () => {
    it("已设置密码返回 true", () => {
      const loginResult = authService.login({ email: "test@example.com", password: "Strong1Pass" })
      expect(authService.hasPassword(loginResult.user.id)).toBe(true)
    })

    it("不存在用户返回 false", () => {
      expect(authService.hasPassword("nonexistent-id")).toBe(false)
    })
  })

  describe("refreshToken", () => {
    let refreshToken: string

    it("使用有效 refresh token 刷新", () => {
      const loginResult = authService.login({ email: "test@example.com", password: "Strong1Pass" })
      refreshToken = loginResult.tokens.refreshToken

      const newTokens = authService.refreshToken(refreshToken)
      expect(newTokens.accessToken).toBeTruthy()
      expect(newTokens.refreshToken).toBeTruthy()
      expect(newTokens.accessToken).not.toBe(loginResult.tokens.accessToken)
      expect(newTokens.refreshToken).not.toBe(refreshToken)
    })

    it("重复使用同一 refresh token 失败", () => {
      expect(() => authService.refreshToken(refreshToken)).toThrow(AuthError)
    })

    it("无效 refresh token 失败", () => {
      expect(() => authService.refreshToken("invalid-token-xxxx")).toThrow(AuthError)
    })
  })

  describe("changePassword", () => {
    it("正确修改密码", () => {
      const loginResult = authService.login({ email: "test@example.com", password: "Strong1Pass" })
      authService.changePassword(loginResult.user.id, "Strong1Pass", "NewPass123")

      // 旧密码无法登录
      expect(() =>
        authService.login({ email: "test@example.com", password: "Strong1Pass" })
      ).toThrow(AuthError)

      // 新密码可以登录
      const newLogin = authService.login({ email: "test@example.com", password: "NewPass123" })
      expect(newLogin.user.name).toBe("Test User")
    })

    it("错误原密码修改失败", () => {
      const loginResult = authService.login({ email: "test@example.com", password: "NewPass123" })
      expect(() =>
        authService.changePassword(loginResult.user.id, "WrongOld", "Another1")
      ).toThrow(AuthError)
    })

    it("弱新密码修改失败", () => {
      const loginResult = authService.login({ email: "test@example.com", password: "NewPass123" })
      expect(() =>
        authService.changePassword(loginResult.user.id, "NewPass123", "weak")
      ).toThrow(AuthError)
    })
  })

  describe("logout", () => {
    it("登出后 refresh token 失效", () => {
      const loginResult = authService.login({ email: "test@example.com", password: "NewPass123" })
      const refreshToken = loginResult.tokens.refreshToken

      authService.logout(loginResult.tokens.accessToken)

      // refresh token 被撤销
      expect(() => authService.refreshToken(refreshToken)).toThrow(AuthError)
    })
  })
})
