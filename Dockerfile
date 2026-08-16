# ==================== STAGE 1: BUILD ====================
FROM node:22-slim AS builder

# No native build tools needed: sharp 0.34 ships prebuilt binaries via
# @img/sharp-linux-x64 (see pnpm-lock.yaml), so nothing is compiled here.

WORKDIR /app

RUN corepack enable pnpm
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
# Cache the pnpm store so repeat builds only fetch new packages.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
# Build + drop devDeps. --ignore-scripts: after pruning, the root `prepare`
# (husky) no longer exists, and esbuild/sharp ship their native binaries as
# production deps (no postinstall needed at runtime).
RUN pnpm run build \
    && pnpm prune --prod --ignore-scripts

# ==================== STAGE 2: RUNTIME ====================
FROM node:22-slim

# Instalar ffmpeg (incluye VAAPI con el driver iHD para GPUs Intel/AMD).
# sharp usa su binario nativo incluido en node_modules
# (via @img/sharp-linux-x64), no necesita libvips del sistema.
# Cache apt para builds repetidos más rápidos.
# intel-media-va-driver es un paquete "recommends" de ffmpeg/libva que
# --no-install-recommends omite; sin él VAAPI no encuentra driver y el bot cae
# a software. En hosts sin GPU el micro-encode de validación falla igualmente
# y se degrada a libx264, así que es seguro instalarlo siempre.
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    intel-media-va-driver \
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
