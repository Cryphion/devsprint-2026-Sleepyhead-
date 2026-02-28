"use strict";

/**
 * health.js
 * ---------
 * GET /health
 *
 * Returns 200 if Redis is reachable, 503 otherwise.
 * Docker Compose uses this to determine service readiness.
 *
 * Response shape:
 * {
 *   "status": "ok" | "degraded",
 *   "dependencies": {
 *     "redis": "ok" | "error"
 *   },
 *   "uptime": 42
 * }
 */

const { Router } = require("express");

const router = Router();
let redisClient; // injected from index.js after Redis connects

function setRedisClient(client) {
  redisClient = client;
}

router.get("/health", async (req, res) => {
  const deps = { redis: "unknown" };
  let healthy = true;

  // ── Redis check ────────────────────────────────────────────────────────────
  try {
    const pong = await redisClient.ping();
    deps.redis = pong === "PONG" ? "ok" : "error";
    if (deps.redis !== "ok") healthy = false;
  } catch {
    deps.redis = "error";
    healthy = false;
  }

  const status = healthy ? "ok" : "degraded";
  const code = healthy ? 200 : 503;

  return res.status(code).json({
    service: "notification-hub",
    status,
    dependencies: deps,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

module.exports = { router, setRedisClient };