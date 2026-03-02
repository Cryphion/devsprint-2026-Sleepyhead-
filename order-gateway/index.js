const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const Redis = require("ioredis");
require("dotenv").config();

const app = express();
app.use(express.json());

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── CONFIG ────────────────────────────────────────────────────────────────────
const PORT                 = process.env.PORT                  || 3000;
const JWT_SECRET           = process.env.JWT_SECRET            || "super_secret_jwt_key_change_in_prod";
const STOCK_SERVICE_URL    = process.env.STOCK_SERVICE_URL     || "http://stock-service:3002";
const KITCHEN_QUEUE_URL    = process.env.KITCHEN_QUEUE_URL     || "http://kitchen-queue:3003";
const IDENTITY_SERVICE_URL = process.env.IDENTITY_PROVIDER_URL || "http://identity-provider:3001";
const NOTIFICATION_HUB_URL = process.env.NOTIFICATION_HUB_URL  || "http://notification-hub:3004";
const REDIS_URL            = process.env.REDIS_URL             || "redis://redis:6379";
const CACHE_TTL_SECONDS    = parseInt(process.env.CACHE_TTL_SECONDS || "30");

// ── REDIS ─────────────────────────────────────────────────────────────────────
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
redis.on("error", (err) => console.error("[Redis] Connection error:", err.message));

// ── IN-MEMORY METRICS ─────────────────────────────────────────────────────────
const metrics = {
  gateway_requests_total:   0,
  gateway_requests_success: 0,
  gateway_requests_failed:  0,
  gateway_auth_failures:    0,
  gateway_stock_rejections: 0,
  gateway_latency_ms_total: 0,
  gateway_latency_count:    0,
  gateway_orders_placed:    0,
};

// ── REQUEST COUNTER MIDDLEWARE ────────────────────────────────────────────────
app.use((req, res, next) => {
  metrics.gateway_requests_total++;
  req._startTime = Date.now();
  res.on("finish", () => {
    const d = Date.now() - req._startTime;
    metrics.gateway_latency_ms_total += d;
    metrics.gateway_latency_count++;
    if (res.statusCode >= 400) metrics.gateway_requests_failed++;
    else metrics.gateway_requests_success++;
  });
  next();
});

// ── JWT AUTH MIDDLEWARE ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const h = req.headers["authorization"];
  if (!h || !h.startsWith("Bearer ")) {
    metrics.gateway_auth_failures++;
    return res.status(401).json({ message: "Missing token" });
  }
  try {
    req.user = jwt.verify(h.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    metrics.gateway_auth_failures++;
    return res.status(401).json({ message: "Invalid token" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /health
// docker-compose healthcheck: wget -qO- http://localhost:3000/health || exit 1
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  const checks = {
    redis: "ok", stock_service: "ok", kitchen_queue: "ok",
    identity_service: "ok", notification_hub: "ok",
  };
  let allHealthy = true;
  const probe = async (url, key) => {
    try { await axios.get(url, { timeout: 3000 }); }
    catch { checks[key] = "unreachable"; allHealthy = false; }
  };
  try { await redis.ping(); } catch { checks.redis = "unreachable"; allHealthy = false; }
  await probe(`${STOCK_SERVICE_URL}/health`,    "stock_service");
  await probe(`${KITCHEN_QUEUE_URL}/health`,    "kitchen_queue");
  await probe(`${IDENTITY_SERVICE_URL}/health`, "identity_service");
  await probe(`${NOTIFICATION_HUB_URL}/health`, "notification_hub");
  res.status(allHealthy ? 200 : 503).json({ status: allHealthy ? "ok" : "degraded", checks });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /health/all
// Called by Script.js: mockApi.getHealth() → Admin "Service Health" page
// Returns: [{ name, status: "up"|"down", latency: number|null }]
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health/all", async (req, res) => {
  const services = [
    { name: "Identity Provider", url: `${IDENTITY_SERVICE_URL}/health` },
    { name: "Order Gateway",     url: null                              },
    { name: "Stock Service",     url: `${STOCK_SERVICE_URL}/health`     },
    { name: "Kitchen Queue",     url: `${KITCHEN_QUEUE_URL}/health`     },
    { name: "Notification Hub",  url: `${NOTIFICATION_HUB_URL}/health`  },
  ];
  const results = await Promise.all(services.map(async (svc) => {
    if (!svc.url) return { name: svc.name, status: "up", latency: 1 };
    const t0 = Date.now();
    try {
      await axios.get(svc.url, { timeout: 3000 });
      return { name: svc.name, status: "up", latency: Date.now() - t0 };
    } catch {
      return { name: svc.name, status: "down", latency: null };
    }
  }));
  res.json(results);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /metrics  (Prometheus text format)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/metrics", (req, res) => {
  const avg = metrics.gateway_latency_count > 0
    ? (metrics.gateway_latency_ms_total / metrics.gateway_latency_count).toFixed(2) : 0;
  res.type("text/plain").send([
    `gateway_requests_total ${metrics.gateway_requests_total}`,
    `gateway_requests_success ${metrics.gateway_requests_success}`,
    `gateway_requests_failed ${metrics.gateway_requests_failed}`,
    `gateway_auth_failures ${metrics.gateway_auth_failures}`,
    `gateway_stock_rejections ${metrics.gateway_stock_rejections}`,
    `gateway_avg_latency_ms ${avg}`,
    `gateway_orders_placed ${metrics.gateway_orders_placed}`,
  ].join("\n"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /metrics/json
// Called by Script.js: mockApi.getMetrics() → Admin "Performance" page
//
// Pulls authoritative cook counts from kitchen-queue:3003/metrics
// kitchen-queue/metrics.js returns: { totalProcessed, totalFailures, avgLatencyMs, uptime }
// Script.js expects:                { totalOrders,    failures,      avgLatency          }
// Falls back to gateway counters if kitchen-queue is unreachable.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/metrics/json", async (req, res) => {
  const gwAvg = metrics.gateway_latency_count > 0
    ? Math.round(metrics.gateway_latency_ms_total / metrics.gateway_latency_count) : 0;

  let kitchenData = null;
  try {
    const { data } = await axios.get(`${KITCHEN_QUEUE_URL}/metrics`, { timeout: 3000 });
    kitchenData = data;
  } catch { /* Kitchen Queue unreachable — degrade gracefully */ }

  res.json({
    totalOrders:     kitchenData?.totalProcessed ?? metrics.gateway_orders_placed,
    failures:        kitchenData?.totalFailures  ?? metrics.gateway_requests_failed,
    avgLatency:      kitchenData?.avgLatencyMs != null
                       ? `${kitchenData.avgLatencyMs}ms`
                       : `${gwAvg}ms`,
    authFailures:    metrics.gateway_auth_failures,
    stockRejections: metrics.gateway_stock_rejections,
    requestsTotal:   metrics.gateway_requests_total,
    uptime:          kitchenData?.uptime ?? Math.floor(process.uptime()),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /stock
// Called by Script.js: mockApi.getStock() → Student "Order" page menu
//
// Cache-first (Redis TTL = CACHE_TTL_SECONDS). Absorbs thundering herd.
// stock-service returns: [{ id, name, quantity, price }]
// Script.js expects:     [{ id, name, stock,    price }]
// ─────────────────────────────────────────────────────────────────────────────
app.get("/stock", requireAuth, async (req, res) => {
  try {
    const cached = await redis.get("stock:all");
    if (cached) return res.json(JSON.parse(cached));
  } catch { /* cache miss */ }

  try {
    const { data } = await axios.get(`${STOCK_SERVICE_URL}/api/stocks`, { timeout: 5000 });
    const mapped = data.map((item) => ({
      id:    String(item.id),
      name:  item.name,
      stock: item.quantity,   // rename quantity → stock for Script.js
      price: item.price ?? 0,
    }));
    try { await redis.set("stock:all", JSON.stringify(mapped), "EX", CACHE_TTL_SECONDS); } catch { /* cache write failure — non-fatal */ }
    return res.json(mapped);
  } catch (err) {
    console.error("[StockService] GET /api/stocks error:", err.message);
    return res.status(503).json({ message: "Stock service unavailable" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /stock/update
// Called by Script.js: mockApi.updateStock() → Admin "Manage Stock" page
// Busts Redis cache after update so students see fresh stock immediately.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/stock/update", requireAuth, async (req, res) => {
  const { itemId, quantity } = req.body;
  if (!itemId || quantity === undefined) {
    return res.status(400).json({ message: "itemId and quantity required" });
  }
  try {
    const { data } = await axios.put(
      `${STOCK_SERVICE_URL}/api/stocks/${itemId}`,
      { quantity },
      { timeout: 5000 }
    );
    try { await redis.del("stock:all"); await redis.del(`stock:${itemId}`); } catch { /* cache bust failure — non-fatal */ }
    return res.json(data);
  } catch (err) {
    console.error("[StockService] PUT /api/stocks error:", err.message);
    return res.status(503).json({ message: "Stock service unavailable" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /orders
// Called by Script.js: mockApi.placeOrder() → Student "Order" page
//
// Pipeline:
//   1. requireAuth middleware    — 401 if JWT missing/invalid
//   2. Redis fast cache check    — instant reject if cached stock < qty
//   3. GET  stock/:id            — fetch qty + version (optimistic lock)
//   4. PATCH stock/:id/deduct    — atomic deduction with version check
//   5. POST kitchen-queue:3003/order → publishOrder() → RabbitMQ
//      worker.js: processOrder() → notify() → notification-hub:3004 → WebSocket
//   6. Return 200 { orderId, status:"Pending" } immediately — async cooking
// ─────────────────────────────────────────────────────────────────────────────
app.post("/orders", requireAuth, async (req, res) => {
  let orderItems = Array.isArray(req.body.items)
    ? req.body.items
    : req.body.itemId
      ? [{ itemId: req.body.itemId, quantity: req.body.quantity }]
      : [];

  if (!orderItems.length) {
    return res.status(400).json({ message: "No items provided" });
  }

  for (const { itemId, quantity } of orderItems) {
    if (!itemId || !quantity || quantity <= 0) {
      return res.status(400).json({ message: `Invalid item: ${itemId}` });
    }
  }

  // ── Step 1: Fast Redis cache check ───────────────────────────────────────
  for (const { itemId, quantity } of orderItems) {
    try {
      const cached = await redis.get(`stock:${itemId}`);
      if (cached !== null && parseInt(cached) < quantity) {
        metrics.gateway_stock_rejections++;
        return res.status(400).json({
          message: `Insufficient stock for item ${itemId} (cache check)`,
        });
      }
    } catch { /* cache unavailable — fall through */ }
  }

  // ── Steps 2 & 3: Fetch version then deduct per item ──────────────────────
  for (const { itemId, quantity } of orderItems) {
    let currentItem;
    try {
      const { data } = await axios.get(
        `${STOCK_SERVICE_URL}/api/stocks/${itemId}`,
        { timeout: 5000 }
      );
      currentItem = data;
    } catch (err) {
      console.error(`[StockService] GET /api/stocks/${itemId} error:`, err.message);
      return res.status(503).json({ message: "Stock service unavailable" });
    }

    if (currentItem.quantity < quantity) {
      metrics.gateway_stock_rejections++;
      return res.status(400).json({ message: `Insufficient stock for item ${itemId}` });
    }

    try {
      const { data: deductResult } = await axios.patch(
        `${STOCK_SERVICE_URL}/api/stocks/${itemId}/deduct`,
        { quantity, version: currentItem.version },
        { timeout: 5000 }
      );
      try {
        await redis.set(`stock:${itemId}`, String(deductResult.quantity), "EX", CACHE_TTL_SECONDS);
        await redis.del("stock:all");
      } catch { /* cache update failure — non-fatal */ }
    } catch (err) {
      const status = err.response?.status;
      if (status === 409) {
        metrics.gateway_stock_rejections++;
        return res.status(409).json({ message: `Stock conflict for item ${itemId}, please retry` });
      }
      if (status === 422) {
        metrics.gateway_stock_rejections++;
        return res.status(400).json({ message: `Insufficient stock for item ${itemId}` });
      }
      console.error(`[StockService] PATCH deduct error for ${itemId}:`, err.message);
      return res.status(503).json({ message: "Stock service unavailable" });
    }
  }

  // ── Step 4: Forward to Kitchen Queue ─────────────────────────────────────
  const orderId = "ORD-" + Math.random().toString(36).substr(2, 6).toUpperCase();

  // JWT from identity-provider uses student_id; handle both spellings
  const studentId = req.user.student_id || req.user.studentId || req.user.id;

  try {
    // kitchen-queue/index.js: app.post("/order", ...)
    // kitchen-queue/index.js destructures: { orderId, studentId, items }
    await axios.post(
      `${KITCHEN_QUEUE_URL}/order`,
      { orderId, studentId, items: orderItems },
      { timeout: 5000 }
    );
    console.log(`[Gateway] Order ${orderId} → Kitchen Queue (student: ${studentId})`);
  } catch (err) {
    // Non-fatal: stock already deducted. RabbitMQ durability handles retry.
    console.error(`[Gateway] Kitchen Queue unreachable for order ${orderId}:`, err.message);
  }

  metrics.gateway_orders_placed++;

  // Script.js mockApi.placeOrder() reads data.orderId
  // "Pending" matches ORDER_STEPS[0] in Script.js
  return res.status(200).json({ message: "Order accepted", orderId, status: "Pending" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`✅ Order Gateway running on port ${PORT}`));
module.exports = app;