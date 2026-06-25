---
name: kraken-guide
version: 1.0.0
description: Guide for using Kraken knowledge processing service — when and how to use kraken_search and kraken_ingest
author: user
tags: [kraken, knowledge, rag, workflow]
category: knowledge
---

# Kraken 知识处理服务使用指南

Kraken 是一个知识处理微服务，提供爬取、摘要、语义搜索和智能路由能力。

## 配置

Kraken 服务地址存在 `auth.json`（不提交仓库），与 provider API keys 统一管理。模板见 `auth.example.json`。

优先级：

| 优先级 | 方式 | 适用场景 |
|--------|------|---------|
| 1 (最高) | 环境变量 `KRAKEN_BASE_URL` | CI/CD / 服务器部署 |
| 2 | `auth.json` → `kraken.baseUrl` | 本地开发 |
| 3 (兜底) | 默认 `http://localhost:3000` | 无需配置 |

**本地开发**：复制并编辑 `auth.json`：
```json
{
  "kraken": {
    "baseUrl": "http://localhost:3000"
  }
}
```

**服务器部署**：不接触 auth.json，直接设环境变量：
```bash
export KRAKEN_BASE_URL=https://kraken.your-server.com
```

健康检查：`<baseUrl>/health` 返回 200 即为可用。

## 可用工具

| 工具 | 用途 | 何时使用 |
|------|------|---------|
| `kraken_search` | 语义搜索已入库的知识 | 用户问"我们之前了解过 X 吗"、"搜索知识库中的 Y" |
| `kraken_ingest` | 智能路由摄入网页内容 | 用户提供 URL 需要分析、或需要获取外部信息来回答问题 |

## 典型工作流

### 工作流 1：先存后查
```
用户: "帮我分析 https://example.com/article 的内容，并记住它"
Agent:
  1. kraken_ingest(urls=["https://example.com/article"])
  2. kraken_search(query="关于 article 的关键信息")
```

### 工作流 2：补充搜索
```
用户: "TensorFlow 2.0 有哪些新特性？"
Agent:
  1. kraken_ingest(urls=[], query="TensorFlow 2.0 new features")  ← Kraken 自动搜索
  2. kraken_search(query="TensorFlow 2.0 新特性")
```

### 工作流 3：存量查询
```
用户: "我们上次分析的那个项目用了什么架构？"
Agent:
  1. kraken_search(query="项目架构")
  2. 基于搜索结果回答用户
```

## 决策树

```
用户请求
├─ 涉及外部 URL？
│  ├─ 是 → kraken_ingest(urls=[...]) → kraken_search(query=...)
│  └─ 否 → 继续
├─ 需要最新网络信息？
│  ├─ 是 → kraken_ingest(urls=[], query="...") → kraken_search(query=...)
│  └─ 否 → 继续
├─ 查询历史知识？
│  ├─ 是 → kraken_search(query=...)
│  └─ 否 → 使用其他工具
```

## 注意事项

- Kraken 服务必须先启动（健康检查 `<baseUrl>/health` 返回 200）
- `kraken_ingest` 的 supplement 模式需要 SearXNG 运行
- `kraken_ingest` 可能需要较长时间（timeout: 120s），耐心等待
- 摄入后建议立即用 `kraken_search` 验证结果
- 搜索结果按相关性排序，score 越高越相关
