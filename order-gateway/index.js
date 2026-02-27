const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const Redis = require("ioredis");
require("dotenv").config();

const app = express();
app.use(express.json());

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_change_in_prod";
const STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL || "http://stock-service:3002";
const KITCHEN_SERVICE_URL = process.env.KITCHEN_SERVICE_URL || "http://kitchen-queue:3003";
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || "30");

// ─────────────────────────────────────────
// REDIS CLIENT
// ─────────────────────────────────────────
const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  console.error("[Redis] Connection error:", err.message);
});

// ─────────────────────────────────────────
// IN-MEMORY METRICS
// ─────────────────────────────────────────
const metrics = {
  gateway_requests_total: 0,
  gateway_requests_success: 0,
  gateway_requests_failed: 0,
  gateway_auth_failures: 0,
  gateway_stock_rejections: 0,
  gateway_latency_ms_total: 0,
  gateway_latency_count: 0,
};

// ─────────────────────────────────────────
// MIDDLEWARE — Request counter & latency
// ─────────────────────────────────────────
app.use((req, res, next) => {
  metrics.gateway_requests_total++;
  req._startTime = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - req._startTime;
    metrics.gateway_latency_ms_total += duration;
    metrics.gateway_latency_count++;

    if (res.statusCode >= 400) {
      metrics.gateway_requests_failed++;
    } else {
      metrics.gateway_requests_success++;
    }
  });

  next();
});

// ─────────────────────────────────────────
// MIDDLEWARE — JWT Auth
// ─────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    metrics.gateway_auth_failures++;
    return res.status(401).json({ message: "Missing token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    metrics.gateway_auth_failures++;
    return res.status(401).json({ message: "Invalid token" });
  }
}

// ─────────────────────────────────────────
// HEALTH ENDPOINT
// ─────────────────────────────────────────
app.get("/health", async (req, res) => {
  const checks = { redis: "ok", stock_service: "ok", kitchen_service: "ok" };
  let allHealthy = true;

  // Check Redis
  try {
    await redis.ping();
  } catch {
    checks.redis = "unreachable";
    allHealthy = false;
  }

  // Check Stock Service
  try {
    await axios.get(`${STOCK_SERVICE_URL}/health`, { timeout: 3000 });
  } catch {
    checks.stock_service = "unreachable";
    allHealthy = false;
  }

  // Check Kitchen Service
  try {
    await axios.get(`${KITCHEN_SERVICE_URL}/health`, { timeout: 3000 });
  } catch {
    checks.kitchen_service = "unreachable";
    allHealthy = false;
  }

  const statusCode = allHealthy ? 200 : 503;
  res.status(statusCode).json({ status: allHealthy ? "ok" : "degraded", checks });
});

// ─────────────────────────────────────────
// METRICS ENDPOINT (Prometheus-style text)
// ─────────────────────────────────────────
app.get("/metrics", (req, res) => {
  const avgLatency =
    metrics.gateway_latency_count > 0
      ? (metrics.gateway_latency_ms_total / metrics.gateway_latency_count).toFixed(2)
      : 0;

  const output = [
    `# HELP gateway_requests_total Total number of requests received`,
    `# TYPE gateway_requests_total counter`,
    `gateway_requests_total ${metrics.gateway_requests_total}`,

    `# HELP gateway_requests_success Total successful requests`,
    `# TYPE gateway_requests_success counter`,
    `gateway_requests_success ${metrics.gateway_requests_success}`,

    `# HELP gateway_requests_failed Total failed requests (4xx/5xx)`,
    `# TYPE gateway_requests_failed counter`,
    `gateway_requests_failed ${metrics.gateway_requests_failed}`,

    `# HELP gateway_auth_failures Total JWT auth failures`,
    `# TYPE gateway_auth_failures counter`,
    `gateway_auth_failures ${metrics.gateway_auth_failures}`,

    `# HELP gateway_stock_rejections Total orders rejected due to insufficient stock`,
    `# TYPE gateway_stock_rejections counter`,
    `gateway_stock_rejections ${metrics.gateway_stock_rejections}`,

    `# HELP gateway_avg_latency_ms Average response latency in milliseconds`,
    `# TYPE gateway_avg_latency_ms gauge`,
    `gateway_avg_latency_ms ${avgLatency}`,
  ].join("\n");

  res.status(200).type("text/plain").send(output);
});

// ─────────────────────────────────────────
// POST /orders — Main order flow
// ─────────────────────────────────────────
app.post("/orders", requireAuth, async (req, res) => {
  const { itemId, quantity } = req.body;

  // Basic input validation
  if (!itemId || !quantity || quantity <= 0) {
    return res.status(400).json({ message: "itemId and a positive quantity are required" });
  }

  // ── Step 1: Redis cache stock check ──────
  // Reject immediately if cache says stock is 0 — protects DB from load
  try {
    const cachedStock = await redis.get(`stock:${itemId}`);
    if (cachedStock !== null && parseInt(cachedStock) < quantity) {
      metrics.gateway_stock_rejections++;
      return res.status(400).json({ message: "Insufficient stock (cache)" });
    }
  } catch (err) {
    // Redis down → log and continue (don't block orders over cache failure)
    console.warn("[Cache] Redis unavailable, skipping cache check:", err.message);
  }

  // ── Step 2: Decrement stock via Stock Service ──
  try {
    const stockRes = await axios.post(
      `${STOCK_SERVICE_URL}/decrement`,
      { itemId, quantity },
      { timeout: 5000 }
    );

    // Update cache with new stock value if returned
    if (stockRes.data.remaining !== undefined) {
      try {
        await redis.set(`stock:${itemId}`, stockRes.data.remaining, "EX", CACHE_TTL_SECONDS);
      } catch {
        // Cache write failure is non-fatal
      }
    }
  } catch (err) {
    if (err.response?.status === 400) {
      metrics.gateway_stock_rejections++;
      return res.status(400).json({
        message: err.response.data?.error || "Insufficient stock",
      });
    }
    console.error("[StockService] Error:", err.message);
    return res.status(503).json({ message: "Stock service unavailable" });
  }

  // ── Step 3: Forward to Kitchen Queue ──────
  try {
    await axios.post(
      `${KITCHEN_SERVICE_URL}/process`,
      { itemId, quantity, userId: req.user.id },
      { timeout: 5000 }
    );
  } catch (err) {
    // Kitchen queue failure is non-fatal for the student response
    // (order already stock-confirmed; kitchen will retry via RabbitMQ)
    console.error("[KitchenQueue] Error:", err.message);
  }

  return res.status(200).json({ message: "Order accepted" });
});

// ─────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Order Gateway running on port ${PORT}`);
});

module.exports = app; // exported for unit testing