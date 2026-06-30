# ====================================================
# Try — AI 编程助手 Docker 镜像
# ====================================================

FROM oven/bun:1

# 设置工作目录
WORKDIR /app

# 安装 Python（可选，用于用户工具和 Skill 脚本）+ curl（健康检查）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件并安装
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# 复制源码、工具、技能、公钥
COPY src/ ./src/
COPY tools/ ./tools/
COPY skills/ ./skills/
COPY scripts/ ./scripts/
COPY license_public.pem ./
COPY tsconfig.json ./

# 构建：前端 Vite → dist/web/，后端 Bun 编译 → 二进制 (公钥注入)
RUN bun run build:web
RUN bun run build:compile

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3456/api/health || exit 1

# 声明持久化目录
VOLUME ["/app/data", "/app/model", "/app/workspace"]

# 暴露 Web 端口
EXPOSE 3456

# 启动：运行编译好的二进制
CMD ["./dist/try-bin", "web", "--host", "0.0.0.0"]
