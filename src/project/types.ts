// src/project/types.ts
// ====================================================
// Project 层：类型定义 + 服务接口 + Context.Tag
// ====================================================

import { Context, Effect, Option } from "effect"

// ====================================================
// 类型定义
// ====================================================

export interface ProjectInfo {
  id: string
  name: string
  path: string
  lastActivatedAt: Date
  createdAt: Date
  updatedAt: Date
  /** 该项目下的会话数量 */
  sessionCount: number
}

export interface CreateProjectInput {
  name: string
  path: string
}

export interface UpdateProjectInput {
  name?: string
  path?: string
}

// ====================================================
// 服务接口
// ====================================================

export interface ProjectService {
  /** 列出所有项目，按 last_activated_at 降序 */
  readonly list: () => Effect.Effect<ProjectInfo[], Error>
  /** 获取单个项目 */
  readonly get: (id: string) => Effect.Effect<Option.Option<ProjectInfo>, Error>
  /** 创建项目，path 必须存在 */
  readonly create: (input: CreateProjectInput) => Effect.Effect<ProjectInfo, Error>
  /** 更新项目（名称/路径） */
  readonly update: (id: string, input: UpdateProjectInput) => Effect.Effect<void, Error>
  /** 删除项目（级联删除所有会话），默认项目不可删 */
  readonly delete: (id: string) => Effect.Effect<void, Error>
  /** 激活项目：更新 last_activated_at（前端切换时调用） */
  readonly touch: (id: string) => Effect.Effect<void, Error>
}

export class Project extends Context.Tag("Project")<Project, ProjectService>() {}
