# ─────────────────────────────────────────────
#  Kitchen Queue Service — DevSprint 2026
#  Port: 3003
# ─────────────────────────────────────────────

FROM node:20-alpine

# Install wget for healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./

# Install production dependencies
# Using npm install instead of npm ci — lock file is regenerated locally
# Switch back to `npm ci --omit=dev` after committing a fresh package-lock.json
RUN npm install --omit=dev

# Copy source
COPY src/ ./src/

EXPOSE 3003

# Starts Express server (which also spawns the background worker)
CMD ["node", "src/index.js"]