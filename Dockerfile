# ---- Dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- Run ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Ookla's official CLI, used by the Network card's speedtest button. Their
# linux-x86_64 build is the musl one, so it runs on Alpine unmodified —
# verified with `speedtest --version` before this was added.
RUN apk add --no-cache ca-certificates curl \
    && curl -sL https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz \
       -o /tmp/speedtest.tgz \
    && tar xzf /tmp/speedtest.tgz -C /usr/local/bin speedtest \
    && rm /tmp/speedtest.tgz \
    && chmod +x /usr/local/bin/speedtest

# Speedtest results are cached here between runs. The app runs as `node`, so the
# directory must exist and be owned before the USER switch below — a Docker
# volume mounted over it inherits this ownership.
RUN mkdir -p /cache && chown node:node /cache

COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

CMD ["node", "server.js"]
