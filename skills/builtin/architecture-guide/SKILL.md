---
name: architecture-guide
version: "1.0.0"
description: 项目架构指南，帮助你了解代码库的整体架构设计
author: team
tags: [architecture, design, guide]
category: documentation
---

# Architecture Guide Skill

## 用途

当用户询问项目架构、技术选型或模块关系时，此 Skill 提供架构设计上下文。

## 架构概览

本项目采用分层架构：

- **Agent 层**: Agent 调度、执行、注册
- **Tool 层**: 文件读写、搜索、命令执行等基础工具
- **Session 层**: 对话会话管理
- **Provider 层**: LLM 供应商接口
- **Config 层**: 配置管理
- **Permission 层**: 权限控制与规则引擎
- **Skill 层**: 可扩展的知识注入系统

## 关键决策

1. Effect-TS 用于错误处理与依赖注入
2. Bun 作为运行时和测试框架
3. Agent 间通过 delegate 机制协调

