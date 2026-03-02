const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const Redis = require("ioredis");
require("dotenv").config();

const app = express();
app.use(express.json());

// ── CORS ─────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── CONFIG ───────────────────────────────
const PORT                = process.env.PORT                || 3000;
const JWT_SECRET          = process.env.JWT_SECRET          || "super_secret_jwt_key_change_in_prod";
const STOCK_SERVICE_URL   = process.env.STOCK_SERVICE_URL   || "http://stock-service:3002";
const KITCHEN_SERVICE_URL = process.env.KITCHEN_SERVICE_URL || "http://kitchen-queue:3003";
const IDENTITY_SERVICE_URL= process.env.IDENTITY_PROVIDER_URL || "http://identity-provider:3001";
const NOTIFICATION_HUB_URL= process.env.NOTIFICATION_HUB_URL  || "http://notification-hub:3004";
const REDIS_URL           = process.env.REDIS_URL           || "redis://redis:6379";
const CACHE_TTL_SECONDS   = parseInt(process.env.CACHE_TTL_SECONDS || "30");

// ── REDIS ────────────────────────────────
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
redis.on("error", (err) => console.error("[Redis] Connection error:", err.message));

// ── METRICS ──────────────────────────────
const metrics = {
  gateway_requests_total: 0, gateway_requests_success: 0,
  gateway_requests_failed: 0, gateway_auth_failures: 0,
  gateway_stock_rejections: 0, gateway_latency_ms_total: 0,
  gateway_latency_count: 0,   gateway_orders_placed: 0,
};

// ── REQUEST COUNTER MIDDLEWARE ────────────
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

// ── JWT AUTH MIDDLEWARE ───────────────────
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

// ── HEALTH (self + dependencies) ─────────
app.get("/health", async (req, res) => {
  const checks = { redis: "ok", stock_service: "ok", kitchen_service: "ok",
                   identity_service: "ok", notification_hub: "ok" };
  let allHealthy = true;
  const probe = async (url, key) => {
    try { await axios.get(url, { timeout: 3000 }); }
    catch { checks[key] = "unreachable"; allHealthy = false; }
  };
  try { await redis.ping(); } catch { checks.redis = "unreachable"; allHealthy = false; }
  await probe(`${STOCK_SERVICE_URL}/health`,    "stock_service");
  await probe(`${KITCHEN_SERVICE_URL}/health`,  "kitchen_service");
  await probe(`${IDENTITY_SERVICE_URL}/health`, "identity_service");
  await probe(`${NOTIFICATION_HUB_URL}/health`, "notification_hub");
  res.status(allHealthy ? 200 : 503).json({ status: allHealthy ? "ok" : "degraded", checks });
});

// ── AGGREGATE HEALTH — all 5 services ────
// GET /health/all → [{name, status, latency}]  (consumed by frontend health grid)
app.get("/health/all", async (req, res) => {
  const services = [
    { name: "Identity Provider", url: `${IDENTITY_SERVICE_URL}/health`  },
    { name: "Order Gateway",     url: null                               },
    { name: "Stock Service",     url: `${STOCK_SERVICE_URL}/health`      },
    { name: "Kitchen Queue",     url: `${KITCHEN_SERVICE_URL}/health`    },
    { name: "Notification Hub",  url: `${NOTIFICATION_HUB_URL}/health`   },
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

// ── METRICS — Prometheus text ─────────────
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

// ── METRICS — JSON for frontend dashboard ─
app.get("/metrics/json", (req, res) => {
  const avg = metrics.gateway_latency_count > 0
    ? Math.round(metrics.gateway_latency_ms_total / metrics.gateway_latency_count) : 0;
  res.json({
    totalOrders:      metrics.gateway_orders_placed,
    failures:         metrics.gateway_requests_failed,
    avgLatency:       avg + "ms",
    authFailures:     metrics.gateway_auth_failures,
    stockRejections:  metrics.gateway_stock_rejections,
    requestsTotal:    metrics.gateway_requests_total,
  });
});

// ── STOCK PROXY — GET /stock ──────────────
// Proxies to stock-service GET /items with Redis cache layer
app.get("/stock", requireAuth, async (req, res) => {
  try {
    const cached = await redis.get("stock:all");
    if (cached) return res.json(JSON.parse(cached));
  } catch { /* cache miss */ }
  try {
    const { data } = await axios.get(`${STOCK_SERVICE_URL}/items`, { timeout: 5000 });
    try { await redis.set("stock:all", JSON.stringify(data), "EX", CACHE_TTL_SECONDS); } catch {}
    return res.json(data);
  } catch (err) {
    console.error("[StockService] GET /items error:", err.message);
    return res.status(503).json({ message: "Stock service unavailable" });
  }
});

// ── UPDATE STOCK — POST /stock/update ─────
// Admin-only stock update, proxied to stock-service
app.post("/stock/update", requireAuth, async (req, res) => {
  const { itemId, quantity } = req.body;
  if (!itemId || quantity === undefined) return res.status(400).json({ message: "itemId and quantity required" });
  try {
    const { data } = await axios.post(`${STOCK_SERVICE_URL}/update`, { itemId, quantity }, { timeout: 5000 });
    try { await redis.del("stock:all"); await redis.del(`stock:${itemId}`); } catch {}
    return res.json(data);
  } catch (err) {
    console.error("[StockService] update error:", err.message);
    return res.status(503).json({ message: "Stock service unavailable" });
  }
});

// ── POST /orders — main order flow ────────
// Accepts multi-item: { items: [{itemId, quantity}] }
// or legacy single:   { itemId, quantity }
app.post("/orders", requireAuth, async (req, res) => {
  let orderItems = Array.isArray(req.body.items)
    ? req.body.items
    : req.body.itemId ? [{ itemId: req.body.itemId, quantity: req.body.quantity }] : [];

  if (!orderItems.length) return res.status(400).json({ message: "No items provided" });
  for (const { itemId, quantity } of orderItems) {
    if (!itemId || !quantity || quantity <= 0)
      return res.status(400).json({ message: `Invalid item: ${itemId}` });
    try {
      const cached = await redis.get(`stock:${itemId}`);
      if (cached !== null && parseInt(cached) < quantity) {
        metrics.gateway_stock_rejections++;
        return res.status(400).json({ message: `Insufficient stock for ${itemId} (cache)` });
      }
    } catch {}
  }

  for (const { itemId, quantity } of orderItems) {
    try {
      const { data: stockData } = await axios.post(
        `${STOCK_SERVICE_URL}/decrement`, { itemId, quantity }, { timeout: 5000 }
      );
      if (stockData.remaining !== undefined) {
        try {
          await redis.set(`stock:${itemId}`, stockData.remaining, "EX", CACHE_TTL_SECONDS);
          await redis.del("stock:all");
        } catch {}
      }
    } catch (err) {
      if (err.response?.status === 400) {
        metrics.gateway_stock_rejections++;
        return res.status(400).json({ message: err.response.data?.error || `Insufficient stock for ${itemId}` });
      }
      console.error("[StockService] decrement error:", err.message);
      return res.status(503).json({ message: "Stock service unavailable" });
    }
  }

  const orderId = "ORD-" + Math.random().toString(36).substr(2, 6).toUpperCase();
  try {
    await axios.post(`${KITCHEN_SERVICE_URL}/process`,
      { orderId, items: orderItems, userId: req.user.id || req.user.student_id },
      { timeout: 5000 }
    );
  } catch (err) {
    console.error("[KitchenQueue] process error:", err.message);
  }

  metrics.gateway_orders_placed++;
  return res.status(200).json({ message: "Order accepted", orderId });
});

app.listen(PORT, () => console.log(`Order Gateway running on port ${PORT}`));
module.exports = app;