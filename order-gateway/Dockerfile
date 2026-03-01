# ─────────────────────────────────────────────────────────
#  Order Gateway — Production Dockerfile
# ─────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ──────────────────────
FROM node:18-alpine AS deps

WORKDIR /app

# Copy only package.json (NOT package-lock.json via glob).
# npm ci requires a lockfile — without one it produces a broken install.
# npm install resolves the full tree correctly from package.json alone.
COPY package.json ./
RUN npm install --omit=dev

# ── Stage 2: Final runtime image ───────────────────────
FROM node:18-alpine AS runtime

RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache wget

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]