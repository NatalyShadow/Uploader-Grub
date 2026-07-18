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

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ==================== STAGE 2: RUNTIME ====================
FROM node:22-slim

# Instalar ffmpeg y librerías runtime para sharp (libvips)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libvips42 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar artefactos compilados desde el builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src/logo.webp ./dist/logo.webp
COPY --from=builder /app/package.json ./

# Make app files readable by any UID (container runs with host user)
RUN chmod -R a+rX /app

# HOME=/data so that $HOME/... in config.json resolves to /data/...
ENV HOME=/data

CMD ["node", "dist/index.js"]
