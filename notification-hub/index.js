"use strict";

/**
 * index.js — Notification Hub Entry Point
 * ----------------------------------------
 * Starts:
 *   1. Express HTTP server  → /health, /metrics
 *   2. WebSocket server     → real-time push to students (same port)
 *   3. Redis subscriber     → listens on "order_updates" channel
 *
 * Port: 3004 (set via PORT env var)
 */

const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const Redis = require("ioredis");

const wsManager = require("./wsManager");
const { createSubscriber } = require("./subscriber");
const health = require("./health");
const metrics = require("./metrics");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3004", 10);
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ── Redis (for health checks + general commands) ──────────────────────────────
const redisClient = new Redis(REDIS_URL, {
  lazyConnect: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    console.log(`[Redis] Reconnect attempt #${times} in ${delay}ms`);
    return delay;
  },
});

redisClient.on("connect", () => console.log("[Redis] Main client connected"));
redisClient.on("error", (err) => console.error("[Redis] Main client error:", err.message));

// Inject Redis into health module
health.setRedisClient(redisClient);

// Inject metrics into wsManager so it can track connect/disconnect counts
wsManager.setMetrics(metrics);

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Mount routes
app.use(health.router);
app.use(metrics.router);

// Root info route
app.get("/", (req, res) => {
  res.json({
    service: "notification-hub",
    version: "1.0.0",
    endpoints: {
      health: "GET /health",
      metrics: "GET /metrics",
      websocket: `ws://host:${PORT}  (send { type:'register', studentId:'...' })`,
    },
  });
});

// ── HTTP + WebSocket Server ───────────────────────────────────────────────────
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] New connection from ${ip}`);
  wsManager.register(ws);
});

wss.on("error", (err) => {
  console.error("[WSS] Server error:", err.message);
});

// Start heartbeat to prune dead connections
wsManager.startHeartbeat(wss);

// ── Redis Subscriber ──────────────────────────────────────────────────────────
// Must be a separate ioredis instance (pub/sub locks the connection)
createSubscriber(REDIS_URL);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[NotificationHub] HTTP + WS server listening on port ${PORT}`);
  console.log(`[NotificationHub] Health:  http://localhost:${PORT}/health`);
  console.log(`[NotificationHub] Metrics: http://localhost:${PORT}/metrics`);
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[NotificationHub] ${signal} received — shutting down gracefully`);

  wss.close(() => console.log("[WS] Server closed"));

  await redisClient.quit().catch(() => {});

  server.close(() => {
    console.log("[NotificationHub] HTTP server closed");
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown stalls
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));