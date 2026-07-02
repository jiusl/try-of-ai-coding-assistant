// src/project/live.ts
// ====================================================
// Project 层 Live Layer — SQLite 实现
// ====================================================

import { Effect, Layer, Option } from "effect"
import { Database } from "../infra/database.js"
import { Project } from "./types.js"
import type { ProjectService, ProjectInfo, CreateProjectInput, UpdateProjectInput } from "./types.js"
import { existsSync } from "fs"

export const ProjectLive = Layer.effect(
  Project,
  Effect.gen(function* () {
    const db = yield* Database

    // ── 确保 projects 表存在（新鲜 DB 场景，既有 DB 由迁移处理）──
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        path             TEXT NOT NULL,
        last_activated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    // 确保默认项目存在
    yield* db.run(`
      INSERT OR IGNORE INTO projects (id, name, path, last_activated_at, created_at, updated_at)
      VALUES ('__default__', '默认项目', '', datetime('now'), datetime('now'), datetime('now'))
    `)

    const generateId = () => crypto.randomUUID()

    // ── 辅助：row → ProjectInfo ──
    const mapRow = (row: {
      id: string; name: string; path: string
      last_activated_at: string; created_at: string; updated_at: string
      session_count: number
    }): ProjectInfo => ({
      id: row.id,
      name: row.name,
      path: row.path,
      lastActivatedAt: new Date(row.last_activated_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      sessionCount: row.session_count,
    })

    // ── list ──
    const list = (): Effect.Effect<ProjectInfo[], Error> =>
      Effect.gen(function* () {
        const rows = yield* db.query<{
          id: string; name: string; path: string
          last_activated_at: string; created_at: string; updated_at: string
          session_count: number
        }>(`
          SELECT p.*, COUNT(s.id) as session_count
          FROM projects p
          LEFT JOIN sessions s ON p.id = s.project_id AND s.status != 'deleted'
          GROUP BY p.id
          ORDER BY
            CASE WHEN p.id = '__default__' THEN 1 ELSE 0 END,
            p.last_activated_at DESC
        `)
        return rows.map(mapRow)
      })

    // ── get ──
    const get = (id: string): Effect.Effect<Option.Option<ProjectInfo>, Error> =>
      Effect.gen(function* () {
        const rows = yield* db.query<{
          id: string; name: string; path: string
          last_activated_at: string; created_at: string; updated_at: string
          session_count: number
        }>(`
          SELECT p.*, COUNT(s.id) as session_count
          FROM projects p
          LEFT JOIN sessions s ON p.id = s.project_id AND s.status != 'deleted'
          WHERE p.id = ?
          GROUP BY p.id
        `, [id])
        if (rows.length === 0) return Option.none()
        return Option.some(mapRow(rows[0]!))
      })

    // ── create ──
    const create = (input: CreateProjectInput): Effect.Effect<ProjectInfo, Error> =>
      Effect.gen(function* () {
        // 路径校验
        if (!existsSync(input.path)) {
          return yield* Effect.fail(new Error(`路径不存在: ${input.path}`))
        }

        // 去重：同路径不重复创建
        const existing = yield* db.query<{ id: string; name: string; path: string; last_activated_at: string; created_at: string; updated_at: string; session_count: number }>(`
          SELECT p.*, COUNT(s.id) as session_count
          FROM projects p
          LEFT JOIN sessions s ON p.id = s.project_id AND s.status != 'deleted'
          WHERE p.path = ? AND p.id != '__default__'
          GROUP BY p.id
        `, [input.path])
        if (existing.length > 0) {
          return mapRow(existing[0]!)
        }

        const id = generateId()
        const now = new Date().toISOString()

        yield* db.run(
          "INSERT INTO projects (id, name, path, last_activated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [id, input.name, input.path, now, now, now]
        )

        return {
          id,
          name: input.name,
          path: input.path,
          lastActivatedAt: new Date(now),
          createdAt: new Date(now),
          updatedAt: new Date(now),
          sessionCount: 0,
        }
      })

    // ── update ──
    const update = (id: string, input: UpdateProjectInput): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        if (id === "__default__") {
          return yield* Effect.fail(new Error("默认项目不可修改"))
        }

        const opt = yield* get(id)
        if (Option.isNone(opt)) {
          return yield* Effect.fail(new Error("项目不存在"))
        }

        const fields: string[] = []
        const params: string[] = []
        if (input.name !== undefined) { fields.push("name = ?"); params.push(input.name) }
        if (input.path !== undefined) {
          if (!existsSync(input.path)) {
            return yield* Effect.fail(new Error(`路径不存在: ${input.path}`))
          }
          fields.push("path = ?"); params.push(input.path)
        }
        if (fields.length === 0) return

        fields.push("updated_at = datetime('now')")
        params.push(id)
        yield* db.run(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`, params)
      })

    // ── delete（级联删除会话）──
    const delete_ = (id: string): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        if (id === "__default__") {
          return yield* Effect.fail(new Error("默认项目不可删除"))
        }

        const opt = yield* get(id)
        if (Option.isNone(opt)) {
          return yield* Effect.fail(new Error("项目不存在"))
        }

        // 先删会话（messages 有 ON DELETE CASCADE），再删项目
        yield* db.run("DELETE FROM sessions WHERE project_id = ?", [id])
        yield* db.run("DELETE FROM projects WHERE id = ?", [id])
      })

    // ── touch ──
    const touch = (id: string): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        yield* db.run(
          "UPDATE projects SET last_activated_at = datetime('now') WHERE id = ?",
          [id]
        )
      })

    // ── 组装服务 ──
    const service: ProjectService = { list, get, create, update, delete: delete_, touch }
    return service
  })
)
