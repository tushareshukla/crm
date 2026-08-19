# Single image for the whole monorepo: api (Bun), app (Next.js), agent (eve), migrate.
# Node 24 is required by `eve`; Bun runs the API and package scripts.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /app
COPY . .
# prisma.config.ts calls env("DATABASE_URL") during `prisma generate` (postinstall) — dummy at build time.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN bun install --frozen-lockfile || bun install
# NEXT_PUBLIC_API_URL is baked at build time from API_URL.
ARG API_URL
ARG APP_URL
ENV API_URL=$API_URL APP_URL=$APP_URL NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=3072
RUN cd apps/app && bun run build
ENV NODE_ENV=production
CMD ["bun", "--version"]
