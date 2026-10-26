# Knot 实例镜像（非官方发布形态；本仓库 Linux/Docker 部署用）。
# 构建上下文应为已构建好的发布目录（含 backend/、packages/、web/dist/、node_modules/）。
# OpenClaw 2026.10+ 要求 Node ≥ 24.22.1；用 22 会在容器内直接 agent_failed。
FROM docker.m.daocloud.io/library/node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . /app

ENV NODE_ENV=production \
    BIND_HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

# 运行用户由 compose 的 user: "1000:1000" 指定，与宿主机 perfxlab 对齐。
CMD ["node", "backend/src/index.js"]
