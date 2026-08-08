# ==================== STAGE 1: BUILD ====================
FROM node:22-slim AS builder

# Instalar dependencias nativas para compilar TypeScript y sharp (libvips)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable pnpm
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

COPY . .
# Build + drop devDeps. --ignore-scripts: after pruning, the root `prepare`
# (husky) no longer exists, and esbuild/sharp ship their native binaries as
# production deps (no postinstall needed at runtime).
RUN pnpm run build \
    && pnpm prune --prod --ignore-scripts

# ==================== STAGE 2: RUNTIME ====================
FROM node:22-slim

# Instalar ffmpeg. sharp usa su binario nativo incluido en node_modules
# (via @img/sharp-linux-x64), no necesita libvips del sistema.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar artefactos compilados desde el builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Make app files readable by any UID (container runs with host user)
RUN chmod -R a+rX /app

# HOME=/data so that $HOME/... in config.json resolves to /data/...
ENV HOME=/data
# Production mode: sharp's bundled native binary is used and devDeps were
# already pruned in the builder stage.
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
