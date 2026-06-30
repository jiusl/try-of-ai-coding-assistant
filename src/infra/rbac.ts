// src/infra/rbac.ts
// ====================================================
// RBAC 用户角色权限系统
// ====================================================

import { Database as BunDatabase } from "bun:sqlite"
import { logger } from "./logger.js"

// -------------------------------------------------
// 类型定义
// -------------------------------------------------

/** 权限标识 */
export type Permission =
  | "users:read"
  | "users:write"
  | "users:delete"
  | "roles:read"
  | "roles:write"
  | "roles:delete"
  | "sessions:read"
  | "sessions:write"
  | "sessions:delete"
  | "sessions:all"
  | "config:read"
  | "config:write"
  | "chat:send"
  | "tools:use"
  | "audit:read"
  | "metrics:read"
  | "license:read"
  | "license:write"
  | "admin:all"

/** 角色定义 */
export interface Role {
  id: string
  name: string
  description: string
  permissions: Permission[]
}

/** 用户信息 */
export interface User {
  id: string
  name: string
  apiToken: string
  email: string | undefined
  avatarUrl: string | undefined
  roles: string[]
  createdAt: string
  updatedAt: string
}

/** 用户查询结果 */
export interface UserQueryResult {
  id: string
  name: string
  api_token: string
  email: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
  role_ids: string | null
  role_names: string | null
}

// -------------------------------------------------
// 预置角色
// -------------------------------------------------

export const PREDEFINED_ROLES: Role[] = [
  {
    id: "admin",
    name: "管理员",
    description: "拥有所有权限",
    permissions: ["admin:all"],
  },
  {
    id: "editor",
    name: "编辑者",
    description: "可以创建和管理会话、发送聊天、使用工具",
    permissions: [
      "sessions:read",
      "sessions:write",
      "sessions:delete",
      "chat:send",
      "tools:use",
      "config:read",
      "metrics:read",
      "audit:read",
    ],
  },
  {
    id: "viewer",
    name: "观察者",
    description: "只能查看会话和配置，不可修改",
    permissions: [
      "sessions:read",
      "config:read",
      "metrics:read",
      "audit:read",
    ],
  },
]

// -------------------------------------------------
// 核心：检查权限
// -------------------------------------------------

export function isAdmin(permissions: Permission[]): boolean {
  return permissions.includes("admin:all")
}

export function hasPermission(
  userPermissions: Permission[],
  required: Permission
): boolean {
  if (isAdmin(userPermissions)) return true
  return userPermissions.includes(required)
}

export function hasAnyPermission(
  userPermissions: Permission[],
  required: Permission[]
): boolean {
  if (isAdmin(userPermissions)) return true
  return required.some((p) => userPermissions.includes(p))
}

export function requiresPermission(
  ...required: Permission[]
): Permission[] {
  return required
}

// -------------------------------------------------
// 数据库操作服务
// -------------------------------------------------

function getDbPath(): string {
  return process.env.TRY_DB_PATH ?? "./try.db"
}

class RbacService {
  /**
   * 初始化预置角色和默认管理员
   */
  initialize(): void {
    const db = new BunDatabase(getDbPath())
    try {
      // 插入预置角色
      for (const role of PREDEFINED_ROLES) {
        db.run(
          `INSERT OR IGNORE INTO roles (id, name, description, permissions) VALUES (?, ?, ?, ?)`,
          [role.id, role.name, role.description, JSON.stringify(role.permissions)]
        )
      }

      // 创建默认管理员用户（如果没有用户）
      const count = (db.query("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number })
      if (count.cnt === 0) {
        const adminId = crypto.randomUUID()
        const adminToken = crypto.randomUUID().replace(/-/g, "")
        db.run(
          `INSERT INTO users (id, name, api_token, email) VALUES (?, ?, ?, ?)`,
          [adminId, "Admin", adminToken, "admin@try.local"]
        )
        db.run(
          `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?)`,
          [adminId, "admin", "system"]
        )
        logger.info("RBAC 初始化: 已创建默认管理员用户", { adminToken })
      }

      logger.info("RBAC 初始化完成")
    } catch (err) {
      logger.error("RBAC 初始化失败", { error: String(err) })
    } finally {
      db.close()
    }
  }

  /**
   * 通过 API Token 查找用户及其权限
   */
  getUserByToken(apiToken: string): User | null {
    const db = new BunDatabase(getDbPath())
    try {
      const rows = db.query(`
        SELECT 
          u.id, u.name, u.api_token, u.email, u.avatar_url, 
          u.created_at, u.updated_at,
          GROUP_CONCAT(r.id) as role_ids,
          GROUP_CONCAT(r.name) as role_names
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        WHERE u.api_token = ?
        GROUP BY u.id
      `).all(apiToken) as UserQueryResult[]

      if (rows.length === 0) return null
      const row = rows[0]!
      return {
        id: row.id,
        name: row.name,
        apiToken: row.api_token,
        email: row.email ?? undefined,
        avatarUrl: row.avatar_url ?? undefined,
        roles: row.role_ids ? row.role_ids.split(",") : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    } finally {
      db.close()
    }
  }

  /**
   * 获取用户的所有权限
   */
  getUserPermissions(userId: string): Permission[] {
    const db = new BunDatabase(getDbPath())
    try {
      const rows = db.query(`
        SELECT r.permissions 
        FROM roles r
        INNER JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = ?
      `).all(userId) as { permissions: string }[]

      const perms = new Set<Permission>()
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.permissions) as Permission[]
          for (const p of parsed) perms.add(p)
        } catch { /* skip */ }
      }
      return [...perms]
    } finally {
      db.close()
    }
  }

  /**
   * 列出所有用户
   */
  listUsers(): User[] {
    const db = new BunDatabase(getDbPath())
    try {
      const rows = db.query(`
        SELECT 
          u.id, u.name, u.api_token, u.email, u.avatar_url, 
          u.created_at, u.updated_at,
          GROUP_CONCAT(r.id) as role_ids,
          GROUP_CONCAT(r.name) as role_names
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `).all() as UserQueryResult[]

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        apiToken: row.api_token,
        email: row.email ?? undefined,
        avatarUrl: row.avatar_url ?? undefined,
        roles: row.role_ids ? row.role_ids.split(",") : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    } finally {
      db.close()
    }
  }

  /**
   * 创建用户
   */
  createUser(input: {
    name: string
    email?: string
    roles?: string[]
  }): User {
    const db = new BunDatabase(getDbPath())
    try {
      const id = crypto.randomUUID()
      const apiToken = crypto.randomUUID().replace(/-/g, "")
      const now = new Date().toISOString()

      db.run(
        `INSERT INTO users (id, name, api_token, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.name, apiToken, input.email ?? null, now, now]
      )

      const roleIds = input.roles ?? ["viewer"]
      for (const roleId of roleIds) {
        db.run(
          `INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?)`,
          [id, roleId, "system"]
        )
      }

      logger.info(`RBAC: 创建用户 ${input.name} (${id})`)
      return {
        id,
        name: input.name,
        apiToken,
        email: input.email,
        avatarUrl: undefined,
        roles: roleIds,
        createdAt: now,
        updatedAt: now,
      }
    } finally {
      db.close()
    }
  }

  /**
   * 删除用户
   */
  deleteUser(userId: string): boolean {
    const db = new BunDatabase(getDbPath())
    try {
      // 不允许删除最后一个管理员
      const adminCount = (db.query(
        `SELECT COUNT(DISTINCT u.id) as cnt 
         FROM users u 
         INNER JOIN user_roles ur ON u.id = ur.user_id 
         WHERE ur.role_id = 'admin'`
      ).get() as { cnt: number })

      const result = db.run("DELETE FROM users WHERE id = ?", [userId])
      if (result.changes > 0) {
        logger.info(`RBAC: 删除用户 ${userId}`)
        return true
      }
      return false
    } finally {
      db.close()
    }
  }

  /**
   * 更新用户角色
   */
  setUserRoles(userId: string, roleIds: string[]): void {
    const db = new BunDatabase(getDbPath())
    try {
      db.run("DELETE FROM user_roles WHERE user_id = ?", [userId])
      for (const roleId of roleIds) {
        db.run(
          "INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?)",
          [userId, roleId, "system"]
        )
      }
      db.run("UPDATE users SET updated_at = datetime('now') WHERE id = ?", [userId])
      logger.info(`RBAC: 更新用户角色 ${userId} → [${roleIds.join(", ")}]`)
    } finally {
      db.close()
    }
  }

  /**
   * 列出所有角色
   */
  listRoles(): Role[] {
    const db = new BunDatabase(getDbPath())
    try {
      const rows = db.query("SELECT id, name, description, permissions FROM roles ORDER BY id").all() as {
        id: string
        name: string
        description: string
        permissions: string
      }[]
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        permissions: JSON.parse(r.permissions) as Permission[],
      }))
    } finally {
      db.close()
    }
  }

  /**
   * 根据 ID 查找用户
   */
  getUserById(userId: string): User | null {
    const db = new BunDatabase(getDbPath())
    try {
      const rows = db.query(`
        SELECT 
          u.id, u.name, u.api_token, u.email, u.avatar_url, 
          u.created_at, u.updated_at,
          GROUP_CONCAT(r.id) as role_ids,
          GROUP_CONCAT(r.name) as role_names
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        WHERE u.id = ?
        GROUP BY u.id
      `).all(userId) as UserQueryResult[]

      if (rows.length === 0) return null
      const row = rows[0]!
      return {
        id: row.id,
        name: row.name,
        apiToken: row.api_token,
        email: row.email ?? undefined,
        avatarUrl: row.avatar_url ?? undefined,
        roles: row.role_ids ? row.role_ids.split(",") : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    } finally {
      db.close()
    }
  }

  /**
   * 检查用户数量限制
   */
  getUserCount(): number {
    const db = new BunDatabase(getDbPath())
    try {
      const row = db.query("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number }
      return row.cnt
    } finally {
      db.close()
    }
  }

  /**
   * 生成新的 API Token
   */
  regenerateToken(userId: string): string | null {
    const db = new BunDatabase(getDbPath())
    try {
      const newToken = crypto.randomUUID().replace(/-/g, "")
      const result = db.run(
        "UPDATE users SET api_token = ?, updated_at = datetime('now') WHERE id = ?",
        [newToken, userId]
      )
      return result.changes > 0 ? newToken : null
    } finally {
      db.close()
    }
  }
}

/** 全局 RBAC 服务单例 */
export const rbac = new RbacService()
