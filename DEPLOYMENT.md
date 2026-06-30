# Try 部署指南

AI 编程助手 Try 的完整部署文档。

## 目录

- [快速开始](#快速开始)
- [Docker 部署](#docker-部署)
- [裸机部署](#裸机部署)
- [配置参考](#配置参考)
- [健康检查](#健康检查)
- [监控指标](#监控指标)
- [运维命令](#运维命令)
- [安全建议](#安全建议)

---

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 配置 API Key
cp auth.example.json auth.json
# 编辑 auth.json 填入你的 API Key

# 3. 启动服务
bun run web
# 打开 http://127.0.0.1:3456
```

---

## Docker 部署

### 构建镜像

```bash
docker build -t try:latest .
```

### 使用 docker-compose（推荐）

```bash
# 复制环境变量模板
cp .env.example .env
# 编辑 .env 填入真实 API Key

# 启动
docker-compose up -d
```

### 服务端点

| 端点 | 说明 |
|------|------|
| `http://localhost:3456/` | Web UI |
| `http://localhost:3456/api/v1/health` | 存活探针 |
| `http://localhost:3456/api/v1/ready` | 就绪探针 |
| `http://localhost:3456/api/v1/metrics` | Prometheus 指标 |

### Docker Compose 配置说明

```yaml
services:
  try:
    image: try:latest
    ports:
      - "3456:3456"
    volumes:
      - ./auth.json:/app/auth.json:ro      # API Key（只读）
      - ./try_data:/app/data                # 数据库持久化
      - ./workspace:/app/workspace          # Agent 工作目录
      - ./skills:/app/skills:ro             # 技能文件（只读）
      - ./model:/app/model:ro               # 本地模型（只读）
      - ./logs:/app/logs                    # 日志目录
    environment:
      - TRY_PORT=3456
      - TRY_HOST=0.0.0.0
      - TRY_LOG_LEVEL=info
      - TRY_DB_PATH=/app/data/try.db
      - TRY_PROVIDER=deepseek
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3456/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

---

## 裸机部署

### 系统要求

- **运行时**: [Bun](https://bun.sh) ≥ 1.0
- **可选**: Python ≥ 3.10（部分 Skill 脚本需要）
- **磁盘**: ≥ 500MB（模型文件另计）

### 安装步骤

```bash
# 1. 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 2. 克隆项目
git clone <repo-url> try
cd try

# 3. 安装依赖
bun install

# 4. 配置
cp auth.example.json auth.json
# 编辑 auth.json 填入 API Key
cp .env.example .env
# 编辑 .env 设置运行参数

# 5. 启动（前台）
bun run web

# 6. 后台运行（systemd / pm2 / screen 等）
```

### Systemd 服务

```ini
# /etc/systemd/system/try.service
[Unit]
Description=Try AI Coding Assistant
After=network.target

[Service]
Type=simple
User=try
WorkingDirectory=/opt/try
EnvironmentFile=/opt/try/.env
ExecStart=/home/try/.bun/bin/bun run src/bin/try.ts web --no-open
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now try
sudo systemctl status try
```

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name try.example.com;

    # 允许 SSE 长连接
    proxy_buffering off;
    proxy_read_timeout 24h;

    location / {
        proxy_pass http://127.0.0.1:3456;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 配置参考

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TRY_PORT` | `3456` | 监听端口 |
| `TRY_HOST` | `127.0.0.1` | 监听地址 |
| `TRY_LOG_LEVEL` | `info` | 日志级别: debug / info / warn / error |
| `TRY_DB_PATH` | `./try.db` | SQLite 数据库路径 |
| `TRY_PROVIDER` | — | 覆盖模型提供商 |
| `TRY_MODEL` | — | 覆盖模型名称 |
| `TRY_TEMPERATURE` | — | 覆盖温度参数 |
| `TRY_WORKSPACE` | — | 覆盖工作目录 |
| `TRY_MAX_TURNS` | — | 覆盖最大对话轮数 |

### 工作目录 (Workspace)

Agent 的所有文件操作在会话的工作目录下进行，默认路径在容器内为 `/app/workspace`：

```bash
# docker-compose 中挂载宿主机目录
volumes:
  - ./workspace:/app/workspace

# 或在 .env 中指定路径
TRY_WORKSPACE=/data/projects
```

### 配置文件 (try.json)

```json
{
  "model": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "temperature": 0.7,
    "maxTokens": 4096
  },
  "permissions": {
    "defaultAllow": ["read"],
    "rules": [
      { "pattern": "**/*.md", "allow": ["read", "write"], "requireConfirm": false },
      { "pattern": "**/.env", "allow": [], "description": "禁止读取环境变量文件" }
    ]
  },
  "maxConversationTurns": 50,
  "workspaceRoot": "/app/workspace"
}
```

### API Key 文件 (auth.json)

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.openai.com/v1"
    },
    "deepseek": {
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.deepseek.com/v1"
    }
  }
}
```

---

## 健康检查

### Kubernetes Pod 探针

```yaml
livenessProbe:
  httpGet:
    path: /api/v1/health
    port: 3456
  initialDelaySeconds: 10
  periodSeconds: 15

readinessProbe:
  httpGet:
    path: /api/v1/ready
    port: 3456
  initialDelaySeconds: 5
  periodSeconds: 10
```

### Docker Compose 健康检查

```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:3456/api/v1/health || exit 1"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

---

## 监控指标

### Prometheus 抓取配置

```yaml
# prometheus.yml
scrape_configs:
  - job_name: "try"
    metrics_path: "/api/v1/metrics"
    static_configs:
      - targets: ["localhost:3456"]
```

### 可用指标

| 指标名 | 类型 | 说明 |
|--------|------|------|
| `http_requests_total` | Counter | HTTP 请求总数 |
| `http_request_duration_ms` | Histogram | 请求延迟分布 |
| `http_errors_total` | Counter | 错误请求总数 |
| `tool_calls_total` | Counter | 工具调用次数 |
| `chat_messages_total` | Counter | 聊天消息数 |
| `active_sessions` | Gauge | 活跃会话数 |

### Grafana 仪表盘

可通过 Prometheus 数据源导入指标展示，建议监控：

- 请求 QPS 和 P50/P90/P99 延迟
- 错误率（4xx/5xx 占比）
- 活跃会话趋势
- 工具调用频率

---

## 运维命令

### 数据库迁移

```bash
# 查看迁移状态（需要集成 CLI 命令）
bun run src/bin/try.ts db status

# 运行待执行的迁移（服务启动时自动执行）
bun run src/bin/try.ts db migrate

# 回滚最后一轮迁移
bun run src/bin/try.ts db rollback
```

### 审计日志

```bash
# 查询审计日志（API）
curl "http://localhost:3456/api/v1/audit-log?limit=50"

# 按操作类型过滤
curl "http://localhost:3456/api/v1/audit-log?action=chat_message&limit=20"

# 审计统计
curl "http://localhost:3456/api/v1/audit-log/stats"
```

### 日志管理

```bash
# 查看实时日志（JSON 格式）
tail -f logs/try.log | jq .

# 按级别过滤
cat logs/try.log | jq 'select(.level == "error")'

# 按 traceId 追踪
cat logs/try.log | jq 'select(.traceId == "xxx-xxx-xxx")'
```

### 备份与恢复

```bash
# 备份数据库
cp try.db "backups/try_$(date +%Y%m%d_%H%M%S).db"

# 备份配置
tar -czf "backups/try_config_$(date +%Y%m%d).tar.gz" auth.json try.json .env
```

---

## 安全建议

1. **API Key 保护**: 使用文件权限限制 `chmod 600 auth.json`，建议使用环境变量注入
2. **网络隔离**: 生产环境仅监听 `127.0.0.1`，通过反向代理暴露
3. **HTTPS**: 生产环境务必配置 TLS 证书（Nginx / Caddy / Traefik）
4. **审计日志**: 定期导出和归档 `_audit_log` 表
5. **权限最小化**: 通过 `try.json` 的 `permissions.rules` 限制文件访问范围
6. **容器安全**: 使用非 root 用户运行，挂载只读卷
7. **依赖更新**: 定期运行 `bun update` 和 `bun audit`
8. **日志脱敏**: 日志中不应包含完整 API Key 或敏感文件内容
