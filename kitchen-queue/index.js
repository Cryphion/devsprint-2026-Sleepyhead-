// kitchen-service/src/index.js
require("dotenv").config();
const express = require("express");
const metrics = require("./metrics");
const { startWorker } = require("./worker");
const { getChannel } = require("./rabbitmq");

const app = express();
app.use(express.json());
app.use((req, res, next) => { metrics.requestCounter.inc(); next(); });

// ── Routes ───────────────────────────────────────────────────────
app.use("/", require("./routes"));

// ── Health ───────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    const ch = getChannel();
    if (!ch) throw new Error("RabbitMQ channel not ready");
    res.status(200).json({
      status: "ok",
      rabbitmq: "connected",
      queued: metrics.queuedOrders,
      processed: metrics.processedCount
    });
  } catch (err) {
    res.status(503).json({ status: "degraded", error: err.message });
  }
});

// ── Metrics ──────────────────────────────────────────────────────
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// ── Boot ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3003;

async function boot() {
  // Start RabbitMQ consumer worker
  await startWorker();

  app.listen(PORT, () => {
    console.log(`Kitchen Service running on :${PORT}`);
  });
}

boot().catch((err) => {
  console.error("Failed to start Kitchen Service:", err.message);
  process.exit(1);
});
