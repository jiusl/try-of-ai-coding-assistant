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
- 📁 **Workspace + Project 管理** — 多 Project 切换，文件预览，会话级工作目录隔离
- 🔐 **权限控制** — 基于规则的细粒度工具权限，支持敏感操作确认，RBAC 角色管理
- 📚 **Skill 系统** — 可扩展的知识注入（Skill 自动注入到 System Prompt），内置架构指南、代码审查规范、PR 模板
- 🧠 **记忆系统** — 自动压缩与嵌入检索，跨会话记忆上下文
- 🌐 **Web UI + CLI** — 终端对话 / 浏览器界面双模式，模型快速切换，终端模拟器集成
- 📡 **SSE 流式推送** — 实时流式输出，支持工具调用可视化与步骤时间线
- 🏗️ **Effect-TS 架构** — 函数式依赖注入、类型安全的错误处理，中间件模块化拆分
- 🐳 **Docker 支持** — 提供完整 Docker / docker-compose 一键部署方案
- 🛡️ **License 授权** — RSA 公钥签名离线验证，支持有效期和设备绑定

---

## 快速开始

### 环境要求

| 运行时 | 版本要求 | 用途 |
|--------|----------|------|
| **[Bun](https://bun.sh)** | ≥1.0 | TypeScript 运行时 + 包管理 |
| **Python** | ≥3.10（可选） | 用户工具 & Skill 脚本执行 |

> 💡 Python 仅在使用含 `.py` 脚本的**用户工具**或 **Skill** 时才需要。纯对话 / 代码生成 / 内置工具无需 Python。

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

### Python 环境（可选）

项目已内置 `.venv` 虚拟环境，Agent 调用 Python 工具时会**自动检测并使用**它。

#### 手动创建 .venv

```bash
# 确保系统已安装 Python ≥3.10
python --version

# 创建虚拟环境
python -m venv .venv
```

> ⚠️ `.venv/` 已加入 `.gitignore`，不会提交到仓库。

#### 解释器查找优先级

Agent 执行 `.py` 脚本时的查找顺序：

1. **`.venv`** — 从当前目录向上遍历，优先使用项目虚拟环境
2. **`python`** — 系统 PATH 上的 python
3. **`python3`** — 回退到 python3

> 这解决了 Windows 上不存在 `python3.exe` 的问题，以及 Linux/macOS 上 `python` 指向 Python 2 的历史遗留问题。

#### 安装 Python 依赖

如果你的工具目录下有 `requirements.txt`，Agent **首次调用时自动安装**：

```
tools/user/my-tool/
├── TOOL.md
├── run.py
└── requirements.txt    ← Agent 自动 pip install -r
```

安装成功后会生成 `.requirements-installed` 标记文件（已加入 `.gitignore`），后续跳过安装。

> 你也可以手动激活 `.venv` 后自行安装：
> ```bash
> # Windows
> .venv\Scripts\activate
> # macOS / Linux
> source .venv/bin/activate
>
> pip install -r tools/user/my-tool/requirements.txt
> ```

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
- 📁 Workspace 选择器 — 会话级别的工作目录隔离与持久化
- 🤖 Agent 选择和动态切换
- 🔧 工具调用实时可视化
- 📡 SSE 流式输出
- 🎨 Chakra UI v3 组件库，响应式布局

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

## Workspace 管理

每个会话可以拥有独立的工作目录（workspace），Agent 的所有文件操作都在该目录下进行：

- **默认工作路径**: 项目根目录下的 `workspace/` 文件夹（自动创建）
- **会话级隔离**: 不同会话可设置不同的 workspace，互不干扰
- **前端切换**: Web UI 顶部 WorkspacePicker 组件实时切换
- **持久化存储**: workspace 路径写入 SQLite sessions 表，重启不丢失
- **安全校验**: 路径逃逸检测，禁止访问 workspace 之外的目录

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/workspace` | 获取默认 workspace 和子目录列表 |
| `GET` | `/api/sessions/:id/workspace` | 获取会话的 workspace 配置 |
| `PUT` | `/api/sessions/:id/workspace` | 更新会话的 workspace 路径 |
| `GET` | `/api/files?path=<path>` | 浏览目录 / 读取文件内容 |
| `GET` | `/api/projects` | 列出所有项目 |
| `POST` | `/api/projects` | 创建新项目 |
| `PUT` | `/api/projects/:id` | 更新项目信息 |
| `DELETE` | `/api/projects/:id` | 删除项目 |

---

## Project 管理

Project 是比 Workspace 更高层的组织单元，每个 Project 关联一个独立的目录，支持多项目切换和文件预览：

- **多项目支持**: 创建多个 Project，每个指向不同目录，Web UI 实时切换
- **文件预览**: 一键预览项目中的 README、package.json 等关键文件，快速了解项目结构
- **会话关联**: 每个会话可绑定一个 Project，Agent 自动感知项目上下文
- **持久化**: Project 信息存储在 SQLite 中，重启不丢失

### 数据库迁移

Project 表由迁移 `008_projects.ts` 自动创建：

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

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
│   │   ├── executor.ts       # 执行引擎（迭代循环，含 workspace 支持）
│   │   ├── registry.ts       # Agent 注册表
│   │   ├── types.ts          # 类型定义
│   │   ├── protocol.ts       # Agent 间通信协议
│   │   └── builtin/          # 内置 Agent (8 个)
│   ├── tool/                 # 工具系统
│   │   ├── registry.ts       # 工具注册表
│   │   ├── loader.ts         # Python 工具加载器
│   │   ├── types.ts          # 类型定义
│   │   └── builtin/          # 内置工具 Python 入口
│   ├── session/              # 会话管理
│   │   ├── session.ts        # 会话服务接口
│   │   ├── live.ts           # SQLite 持久化实现
│   │   └── types.ts          # 会话类型定义
│   ├── provider/             # LLM 供应商
│   │   ├── provider.ts       # 统一接口
│   │   ├── auth.ts           # 认证管理
│   │   └── types.ts          # 类型定义
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
│   │   ├── rule-engine.ts    # 规则引擎
│   │   └── types.ts          # 类型定义
│   ├── config/               # 配置管理
│   ├── server/               # Web 服务
│   │   ├── index.ts          # 服务入口
│   │   ├── router.ts         # 路由注册
│   │   ├── middleware/       # 中间件模块（CORS/日志/认证/限流/静态文件）
│   │   ├── websocket.ts      # WebSocket 实时通信
│   │   ├── errors.ts         # 全局错误处理与负载均衡
│   │   ├── openapi.ts        # OpenAPI 文档生成
│   │   ├── terminal-mgr.ts   # 终端会话管理
│   │   ├── handlers/         # API 路由处理
│   │   │   ├── agent.ts      # Agent 调用
│   │   │   ├── chat.ts       # 流式对话
│   │   │   ├── session.ts    # 会话管理
│   │   │   ├── config.ts     # 配置管理
│   │   │   ├── files.ts      # 文件浏览 & 读写 API
│   │   │   ├── skills-management.ts  # Skill CRUD
│   │   │   ├── tools-management.ts   # Tool CRUD
│   │   │   └── ...
│   │   └── static/           # 前端静态资源（构建产物）
│   ├── cli/                  # CLI 界面
│   │   ├── index.ts          # CLI 入口
│   │   ├── repl.ts           # 交互式 REPL
│   │   ├── output.ts         # 终端输出格式化
│   │   └── commands/         # 命令定义（agent/chat/run/tool/web）
│   ├── bin/                  # CLI 启动入口（编译目标）
│   │   └── try.ts
│   ├── infra/                # 基础设施
│   │   ├── database.ts       # 数据库连接（SQLite + FTS5）
│   │   ├── env.ts            # 环境变量
│   │   ├── fs-util.ts        # 文件系统工具
│   │   ├── python-env.ts     # Python 环境自动检测
│   │   ├── license.ts        # License 验证（RSA 公钥）
│   │   ├── logger.ts         # 结构化日志
│   │   ├── metrics.ts        # Prometheus 指标
│   │   └── ...
│   ├── project/              # 项目管理（多 Project 加载与文件预览）
│   ├── web/                  # React 前端源码
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── WorkspacePicker.tsx   # Workspace 切换
│   │   │   │   ├── ChatPanel.tsx         # 对话面板
│   │   │   │   ├── FileExplorer.tsx      # 文件浏览器
│   │   │   │   ├── Timeline.tsx          # 步骤时间线
│   │   │   │   ├── Terminal.tsx          # 终端模拟器
│   │   │   │   └── SettingsDrawer.tsx    # 设置面板
│   │   │   └── ...
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── effect/               # Effect-TS 工具层
├── tools/                    # 工具实现（Python + TOOL.md）
│   ├── builtin/              # 内置工具（14 个）
│   │   ├── _shared/          # Windows 编码兼容层
│   │   ├── edit_file/
│   │   ├── read_file/
│   │   ├── write_file/
│   │   ├── run_command/
│   │   ├── grep/
│   │   ├── glob/
│   │   └── ...
│   └── user/                 # 用户自定义工具
├── skills/                   # Skill 定义
│   ├── builtin/
│   ├── user/
│   └── remote/
├── model/                    # 本地模型文件 (.gguf)
├── scripts/                  # 构建 & 工具脚本
│   ├── build-backend.ts      # 后端编译 + 二进制打包
│   └── ...
├── dist/                     # 构建产物
├── try.json                  # 项目配置
├── auth.example.json         # 认证配置模板
├── auth.json                 # 认证配置（不提交）
├── Dockerfile                # Docker 镜像
├── docker-compose.yml        # Docker 一键部署
├── .dockerignore
├── DEPLOYMENT.md             # 部署指南
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
| 前端 | React 19 + Vite 6 + Chakra UI v3 + SSE 流式 |
| 工具执行 | Python ≥3.10 (JSON stdin/stdout 协议) |
| 终端着色 | [Chalk](https://github.com/chalk/chalk) |
| 容器化 | Docker + docker-compose |

### 开发命令

```bash
bun test              # 运行测试
bun run typecheck     # TypeScript 类型检查
bun run build         # 构建 JS bundle
bun run build:compile # 编译独立二进制 (.exe)
bun run dev           # 开发模式（热重载）
bun run build:web     # 构建前端
```

### Docker 部署

```bash
# 构建镜像
docker build -t try:latest .

# docker-compose 一键部署
cp auth.example.json auth.json  # 填入 API Key 后
docker-compose up -d

# 访问 http://localhost:3456
```

> 详细部署指南（裸机 / Nginx 反向代理 / Systemd / K8s / 监控）见 [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## 许可

MIT

