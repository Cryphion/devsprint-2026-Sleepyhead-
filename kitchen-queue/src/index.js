const express = require("express");
const { isHealthy: redisHealthy } = require("./redis");
const { connect, publishOrder, isHealthy: rabbitHealthy } = require("./rabbitmq");
const { startWorker } = require("./worker");
const { getMetrics } = require("./metrics");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3003;

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /order
 * Called by the Order Gateway over HTTP.
 * Publishes the order to RabbitMQ and immediately returns 202.
 * Does NOT wait for cooking — that happens asynchronously in the worker.
 *
 * Body: { orderId, studentId, items: [...] }
 */
app.post("/order", async (req, res) => {
  const { orderId, studentId, items } = req.body;

  if (!orderId || !studentId || !items) {
    return res.status(400).json({ error: "orderId, studentId and items are required" });
  }

  try {
    await publishOrder({ orderId, studentId, items, enqueuedAt: Date.now() });
    console.log(`[API] Order ${orderId} published to RabbitMQ`);
    return res.status(202).json({
      message: "Order accepted",
      orderId,
    });
  } catch (err) {
    console.error("[API] Failed to publish order:", err.message);
    return res.status(503).json({ error: "Queue unavailable, try again" });
  }
});

/**
 * GET /health
 * Returns 200 only if BOTH Redis (idempotency store) and RabbitMQ (broker) are up.
 * Returns 503 if either dependency is down.
 */
app.get("/health", async (_req, res) => {
  const [redisOk, rabbitOk] = await Promise.all([
    redisHealthy(),
    Promise.resolve(rabbitHealthy()),
  ]);

  const status = redisOk && rabbitOk ? "ok" : "degraded";
  const code = status === "ok" ? 200 : 503;

  return res.status(code).json({
    status,
    redis: redisOk ? "up" : "down",
    rabbitmq: rabbitOk ? "up" : "down",
  });
});

/**
 * GET /metrics
 * Machine-readable metrics for the admin dashboard / Prometheus scraping.
 */
app.get("/metrics", (_req, res) => {
  return res.status(200).json(getMetrics());
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function start() {
  // Connect to RabbitMQ before accepting any traffic
  await connect();

  app.listen(PORT, () => {
    console.log(`[Kitchen Queue] HTTP server listening on port ${PORT}`);
  });

  // Start the background consumer — subscribes to RabbitMQ queue
  await startWorker();
}

start().catch((err) => {
  console.error("[Kitchen Queue] Fatal startup error:", err.message);
  process.exit(1);
});

module.exports = app; // exported for testing