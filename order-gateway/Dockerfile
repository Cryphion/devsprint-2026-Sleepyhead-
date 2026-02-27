# ─────────────────────────────────────────────────────────
#  Order Gateway — Production Dockerfile
#  Build:  docker build -t order-gateway .
#  Run:    docker run -p 3000:3000 --env-file .env order-gateway
# ─────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ──────────────────────
FROM node:18-alpine AS deps

WORKDIR /app

# Copy only manifests first — leverages Docker layer cache.
# Re-runs npm ci only when package*.json changes.
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Final runtime image ───────────────────────
FROM node:18-alpine AS runtime

RUN apk update && apk upgrade --no-cache  # ← add this
RUN apk add --no-cache wget

# Install wget for healthcheck (used by docker-compose healthcheck)
RUN apk add --no-cache wget

WORKDIR /app

# Copy installed production deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Port must match PORT env var (default 3000)
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]