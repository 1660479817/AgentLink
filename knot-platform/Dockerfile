# 容器镜像：构建和运行分两个阶段。
# 目标机不需要 Node 工具链，也不需要 git；拉下来就能跑。
#
#   docker build -t knot-platform .
#   docker run --rm -e DATABASE_URL=... -p 8080:8080 knot-platform
#
# 带 Postgres 的整站用 docker-compose.yml。

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV npm_config_update_notifier=false

# 先只拷依赖清单，让 npm ci 这一层能命中缓存。
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY web/package.json web/
COPY packages/knot-config/package.json packages/knot-config/
COPY packages/knot-markdown/package.json packages/knot-markdown/
COPY packages/knot-doc-reader/package.json packages/knot-doc-reader/
RUN npm ci --no-audit --no-fund

COPY . .
# 构建 WebUI，然后把只在构建时用的依赖剪掉。
RUN npm run build:web && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    BIND_HOST=0.0.0.0 \
    UPLOAD_DIR=/data/uploads \
    STATIC_WEB_DIR=/app/web/dist

WORKDIR /app
RUN groupadd --system --gid 10001 knot \
  && useradd --system --uid 10001 --gid knot --home-dir /app knot \
  && mkdir -p /data/uploads \
  && chown -R knot:knot /data

COPY --from=build --chown=knot:knot /app/package.json /app/package-lock.json ./
COPY --from=build --chown=knot:knot /app/node_modules ./node_modules
COPY --from=build --chown=knot:knot /app/backend ./backend
COPY --from=build --chown=knot:knot /app/packages ./packages
COPY --from=build --chown=knot:knot /app/web/dist ./web/dist
COPY --from=build --chown=knot:knot /app/help.md ./help.md
COPY --from=build --chown=knot:knot /app/ops ./ops

USER knot
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# 迁移由 compose 的 command 先跑；单独 docker run 时先执行：
#   docker run --rm knot-platform node backend/scripts/migrate.js
CMD ["node", "backend/src/index.js"]
