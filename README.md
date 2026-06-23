<p align="center">
  <h1 align="center">🤖 Try</h1>
  <p align="center"><strong>AI-Powered Coding Assistant</strong></p>
  <p align="center">
    <em>参考 <a href="https://github.com/opencode-ai/opencode">OpenCode</a> 架构设计，基于 Effect-TS 构建的本地编程助手</em>
  </p>
</p>

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [配置](#配置)
- [使用方式](#使用方式)
- [Agent 系统](#agent-系统)
- [工具系统](#工具系统)
- [Skill 系统](#skill-系统)
- [权限系统](#权限系统)
- [项目结构](#项目结构)
- [技术栈](#技术栈)

---

## 功能特性

- 🧠 **多模型支持** — OpenAI / Anthropic / DeepSeek / Ollama / 本地 llama.cpp
- 🤖 **8 个内置 Agent** — Chat / Builder / Coder / Reviewer / Tester / Refactor / Researcher / Orchestrator
- 🔧 **14 个内置工具** — 读写文件、代码搜索、命令执行、网页抓取、记忆系统
- 🔐 **权限控制** — 基于规则的细粒度工具权限，支持敏感操作确认
- 📚 **Skill 系统** — 可扩展的知识注入，内置架构指南、代码审查规范、PR 模板
- 🧠 **记忆系统** — 自动压缩与嵌入检索，跨会话记忆上下文
- 🌐 **Web UI + CLI** — 支持终端对话和浏览器界面两种交互方式
- 📡 **SSE 流式推送** — 实时流式输出，支持工具调用可视化
- 🏗️ **Effect-TS 架构** — 函数式依赖注入、类型安全的错误处理

---

## 快速开始

### 环境要求

本项目仅依赖 [Bun](https://bun.sh)（≥1.0），无需 Node.js 或其他运行时。

安装 Bun：

| 平台 | 命令 |
|------|------|
| **macOS / Linux** | `curl -fsSL https://bun.sh/install \| bash` |
| **Windows** | `powershell -c "irm bun.sh/install.ps1 \| iex"` |

或通过包管理器安装：`brew install bun` / `npm install -g bun` / `scoop install bun`

### 安装

```bash
# 1. 克隆项目后安装依赖
bun install

# 2. 配置 API Key（拷贝模板文件）
cp auth.example.json auth.json
# 编辑 auth.json，填入你的 API Key
```

> 💡 `bun install` 即可完成所有必要依赖。`node-llama-cpp`（本地模型支持）为可选依赖，如果系统未安装 CMake 编译工具链，安装时会跳过，不影响在线 API 使用。

### 可选：本地模型

如需离线使用本地模型，先安装编译工具链再执行 `bun install`：

| 平台 | 前置依赖 |
|------|----------|
| **Windows** | [CMake](https://cmake.org/download/) + Visual Studio Build Tools (C++ 桌面开发) |
| **macOS** | `brew install cmake` + Xcode Command Line Tools |
| **Linux** | `apt install cmake build-essential` |

如果装完 CMake 后 `node-llama-cpp` 仍未安装，可单独执行：

```bash
npx node-llama-cpp download
```

或重新运行 `bun install` 让 Bun 自动检出并编译。

### 启动

```bash
# 终端对话模式
bun start -- chat

# 单次问答模式
bun start -- run "解释这个项目的架构"

# Web 界面模式（默认 http://127.0.0.1:3456）
bun start -- web

# 进入后在 CLI 中输入 /help 查看所有命令
```

---

## 配置

### 模型配置 (`try.json`)

```json
{
  "model": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash",
    "temperature": 0.7,
    "maxTokens": 4096
  },
  "models": [
    { "provider": "openai", "model": "gpt-4o-mini" },
    { "provider": "anthropic", "model": "claude-sonnet-4-20250514" },
    { "provider": "deepseek", "model": "deepseek-v4-flash" }
  ]
}
```

- `model` — 默认使用的模型
- `models` — 可选模型列表，可在会话中动态切换
- `provider` 支持：`openai` | `anthropic` | `deepseek` | `ollama` | `llama`

### 认证配置 (`auth.json`)

```json
{
  "defaultProvider": "deepseek",
  "providers": {
    "openai": {
      "apiKey": "sk-your-openai-key",
      "baseUrl": "https://api.openai.com/v1"
    },
    "anthropic": {
      "apiKey": "sk-ant-your-anthropic-key",
      "baseUrl": "https://api.anthropic.com"
    },
    "deepseek": {
      "apiKey": "sk-your-deepseek-key",
      "baseUrl": "https://api.deepseek.com/v1"
    }
  }
}
```

> ⚠️ `auth.json` 包含敏感信息，已加入 `.gitignore`

### 本地模型 (llama.cpp)

支持通过 [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) 加载本地 GGUF 格式模型，无需网络即可使用。

#### 下载模型

推荐以下途径获取 GGUF 模型：

| 模型 | 参数量 | 大小 | 推荐场景 | 下载 |
|------|--------|------|----------|------|
| Qwen2.5-0.5B-Instruct | 0.5B | ~0.4 GB | 轻量测试、低配机器 | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF) |
| Qwen2.5-1.5B-Instruct | 1.5B | ~1.0 GB | 日常使用入门 | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF) |
| Qwen2.5-7B-Instruct | 7B | ~4.7 GB | 性能较好 | [HuggingFace](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF) |
| Llama-3.2-3B-Instruct | 3B | ~2.0 GB | Meta 官方轻量模型 | [HuggingFace](https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF) |

> 💡 建议优先下载 **Q4_K_M** 量化版本，在质量与体积之间取得平衡。

#### 配置使用

将下载的 `.gguf` 文件放入 `model/` 目录，修改 `try.json`：

```json
{
  "model": {
    "provider": "llama",
    "model": "model/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    "temperature": 0.7,
    "maxTokens": 4096
  }
}
```

> ⚠️ 模型文件未被纳入仓库（`.gitignore`），需自行下载后放入 `model/` 目录。

---

## 使用方式

### CLI 模式

```bash
bun start -- chat
```

进入交互式对话后可用命令：

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助 |
| `/agent <id>` | 切换 Agent |
| `/agent list` | 列出所有 Agent |
| `/model <name>` | 切换模型 |
| `/file <path>` | 添加文件到对话上下文 |
| `/clear` | 清空当前对话 |
| `/exit` | 退出 |

### Web UI 模式

```bash
bun start -- web          # 默认端口 3456
bun start -- web -p 8080  # 自定义端口
```

浏览器打开 `http://127.0.0.1:3456`，提供完整的对话管理界面：
- 📝 多会话管理，支持会话切换和 AI 自动命名
- 🤖 Agent 选择和动态切换
- 🔧 工具调用实时可视化
- 📡 SSE 流式输出

---

## Agent 系统

项目内置 8 个专用 Agent，各有不同的工具集和能力边界：

| Agent | ID | 能力 | 工具数 |
|-------|-----|------|--------|
| **Chat** | `builtin:chat` | 只读分析、代码探索、规划 | 9 |
| **Builder** | `builtin:builder` | 全栈开发：读写文件、执行命令 | 12 |
| **Coder** | `builtin:coder` | 专注代码编写与修改 | — |
| **Reviewer** | `builtin:reviewer` | 代码审查、质量检查 | — |
| **Tester** | `builtin:tester` | 运行测试、编写测试用例 | — |
| **Refactor** | `builtin:refactor` | 代码重构与结构优化 | — |
| **Researcher** | `builtin:researcher` | 网络搜索、文档查阅 | — |
| **Orchestrator** | `builtin:orchestrator` | 任务分解、多 Agent 编排 | — |

### Agent 委托 (Delegation)

Builder 和 Orchestrator 可以将子任务委托给专业 Agent：

```
Builder → Coder (写代码)
Builder → Tester (跑测试)
Builder → Reviewer (代码审查)
Builder → Refactor (重构)
Builder → Researcher (查资料)
```

---

## 工具系统

14 个内置工具覆盖完整的开发工作流：

| 工具 | 类别 | 说明 |
|------|------|------|
| `read_file` | 文件 | 读取文件内容 |
| `write_file` | 文件 | 创建新文件 |
| `edit_file` | 文件 | 精确编辑文件 |
| `run_command` | 执行 | 运行 Shell 命令 |
| `read_command` | 执行 | 读取命令输出 |
| `glob` | 搜索 | 按 glob 模式查找文件 |
| `grep` | 搜索 | 文本内容搜索 |
| `file_exists` | 文件 | 检查文件是否存在 |
| `think` | 推理 | 内部思考与规划 |
| `fetch` | 网络 | 抓取网页内容 |
| `list_skills` | 知识 | 列出可用 Skill |
| `get_skill` | 知识 | 获取 Skill 详情 |
| `recall` | 记忆 | 回忆历史对话 |
| `remember` | 记忆 | 保存重要信息 |

---

## Skill 系统

Skill 是可扩展的知识注入模块，通过 Markdown 文件定义，Agent 可动态加载。

### 内置 Skills

| Skill | 说明 |
|-------|------|
| `architecture-guide` | 项目架构指南与设计决策 |
| `code-review` | 代码审查规范与质量标准 |
| `pr-template` | PR 提交模板与规范指引 |
| `tool-design` | Agent Tool 设计原则与实践 |

### 目录结构

```
skills/
├── builtin/           # 内置 Skill（随项目发布）
│   ├── architecture-guide/
│   │   └── SKILL.md
│   ├── code-review/
│   │   └── SKILL.md
│   ├── pr-template/
│   │   └── SKILL.md
│   └── tool-design/
│       └── SKILL.md
├── user/              # 用户自定义 Skill
└── remote/            # 远程 Skill
```

---

## 权限系统

基于规则的权限引擎，控制 Agent 对文件系统操作的范围。

### 权限级别

- **read** — 读取文件
- **write** — 写入文件
- **edit** — 编辑文件
- **execute** — 执行命令

### 规则示例

```json
{
  "permissions": {
    "defaultAllow": ["read"],
    "rules": [
      {
        "pattern": "**/*",
        "allow": ["read", "write", "edit"],
        "requireConfirm": false,
        "description": "允许读写所有文件"
      },
      {
        "pattern": "{npm *, bun *, git *, node *}",
        "allow": ["execute"],
        "requireConfirm": false,
        "description": "允许执行常用开发命令"
      }
    ]
  }
}
```

---

## 项目结构

```
try/
├── src/
│   ├── index.ts              # 入口，注册 CLI
│   ├── agent/                # Agent 系统
│   │   ├── agent.ts          # Agent 服务（run/runAuto）
│   │   ├── executor.ts       # 执行引擎（迭代循环）
│   │   ├── registry.ts       # Agent 注册表
│   │   ├── types.ts          # 类型定义
│   │   └── builtin/          # 内置 Agent
│   ├── tool/                 # 工具系统
│   │   ├── registry.ts       # 工具注册表
│   │   ├── types.ts          # 类型定义
│   │   └── builtin/          # 内置工具
│   ├── session/              # 会话管理
│   │   └── session.ts        # SQLite 持久化
│   ├── provider/             # LLM 供应商
│   │   ├── provider.ts       # 统一接口
│   │   └── auth.ts           # 认证管理
│   ├── skill/                # Skill 系统
│   │   ├── loader.ts         # Skill 加载器
│   │   ├── registry.ts       # Skill 注册表
│   │   └── executor.ts       # Skill 执行器
│   ├── memory/               # 记忆系统
│   │   ├── memory.ts         # 记忆存储
│   │   ├── compressor.ts     # 对话压缩
│   │   └── embedding.ts      # 嵌入检索
│   ├── permission/           # 权限系统
│   │   ├── permission.ts     # 权限检查
│   │   └── rule-engine.ts    # 规则引擎
│   ├── config/               # 配置管理
│   ├── server/               # Web 服务
│   │   ├── handler/          # API 路由处理
│   │   └── static/           # 前端静态资源
│   ├── cli/                  # CLI 界面
│   │   ├── repl.ts           # 交互式 REPL
│   │   └── commands/         # 命令定义
│   ├── infra/                # 基础设施
│   └── effect/               # Effect-TS 工具层
├── skills/                   # Skill 定义
├── model/                    # 本地模型文件
├── try.json                  # 项目配置
├── auth.example.json         # 认证配置模板
├── auth.json                 # 认证配置（不提交）
├── package.json
└── tsconfig.json
```

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | [Bun](https://bun.sh) |
| 语言 | TypeScript |
| 架构 | [Effect-TS](https://effect.website/) (依赖注入、错误处理、Stream) |
| CLI | [Commander](https://github.com/tj/commander.js) |
| 数据库 | SQLite (bun:sqlite, 含 FTS5 全文搜索) |
| LLM SDK | OpenAI / Anthropic / node-llama-cpp |
| 前端 | Vanilla JS + SSE (无框架，零构建) |
| 终端着色 | [Chalk](https://github.com/chalk/chalk) |

### 开发命令

```bash
bun test              # 运行测试
bun run typecheck     # TypeScript 类型检查
bun run build         # 构建
bun run dev           # 开发模式（热重载）
```

---

## 许可

MIT

