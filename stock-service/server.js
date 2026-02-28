const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const redis = require("redis");

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// ─── PostgreSQL ───────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "cafeteria",
  password: process.env.DB_PASSWORD || "secret",
  database: process.env.DB_NAME || "cafeteria_db",
});

// ─── Redis ────────────────────────────────────────────────────
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
redisClient.connect().catch(console.error);

const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS) || 30;

// ─── DB Init ──────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stocks (
      id        SERIAL PRIMARY KEY,
      name      VARCHAR(255) UNIQUE NOT NULL,
      quantity  INTEGER NOT NULL CHECK (quantity >= 0),
      version   INTEGER NOT NULL DEFAULT 0
    )
  `);
  console.log("✅ DB table ready");
}

// ─── Cache helpers ────────────────────────────────────────────
function cacheKey(id) {
  return `stock:${id}`;
}

async function invalidateCache(id) {
  await redisClient.del(cacheKey(id)).catch(() => {});
  await redisClient.del("stocks:all").catch(() => {});
}

// ─── Health ───────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    await redisClient.ping();
    res.json({ status: "ok", service: "stock-service" });
  } catch (err) {
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

// ─── Metrics ──────────────────────────────────────────────────
let metrics = { totalRequests: 0, errors: 0, totalLatencyMs: 0 };

app.get("/metrics", (req, res) => {
  res.json({
    totalRequests: metrics.totalRequests,
    errors: metrics.errors,
    avgLatencyMs: metrics.totalRequests
      ? (metrics.totalLatencyMs / metrics.totalRequests).toFixed(2)
      : 0,
  });
});

// Middleware to track metrics
app.use((req, res, next) => {
  const start = Date.now();
  metrics.totalRequests++;
  res.on("finish", () => {
    metrics.totalLatencyMs += Date.now() - start;
    if (res.statusCode >= 500) metrics.errors++;
  });
  next();
});

// ─── GET all stocks ───────────────────────────────────────────
app.get("/api/stocks", async (req, res) => {
  try {
    const cached = await redisClient.get("stocks:all").catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const result = await pool.query("SELECT id, name, quantity FROM stocks ORDER BY id");
    await redisClient.setEx("stocks:all", CACHE_TTL, JSON.stringify(result.rows)).catch(() => {});
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stocks" });
  }
});

// ─── GET single stock ─────────────────────────────────────────
app.get("/api/stocks/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const cached = await redisClient.get(cacheKey(id)).catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const result = await pool.query("SELECT id, name, quantity FROM stocks WHERE id = $1", [id]);
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });

    await redisClient.setEx(cacheKey(id), CACHE_TTL, JSON.stringify(result.rows[0])).catch(() => {});
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stock" });
  }
});

// ─── POST add stock ───────────────────────────────────────────
app.post("/api/stocks", async (req, res) => {
  const { name, quantity } = req.body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }
  const qty = parseInt(quantity);
  if (isNaN(qty) || qty < 0) {
    return res.status(400).json({ error: "quantity must be a non-negative integer" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO stocks (name, quantity) VALUES ($1, $2) RETURNING id, name, quantity",
      [name.trim(), qty]
    );
    await redisClient.del("stocks:all").catch(() => {});
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Item already exists" });
    res.status(500).json({ error: "Failed to add stock" });
  }
});

// ─── PATCH deduct stock (optimistic locking) ──────────────────
// Body: { quantity: <amount to deduct>, version: <current version> }
app.patch("/api/stocks/:id/deduct", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const amount = parseInt(req.body.quantity);
  const version = parseInt(req.body.version);

  if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: "quantity must be positive" });
  if (isNaN(version)) return res.status(400).json({ error: "version is required for optimistic locking" });

  try {
    // Optimistic locking: only update if version matches
    const result = await pool.query(
      `UPDATE stocks
       SET quantity = quantity - $1, version = version + 1
       WHERE id = $2 AND version = $3 AND quantity >= $1
       RETURNING id, name, quantity, version`,
      [amount, id, version]
    );

    if (!result.rows.length) {
      // Check why it failed
      const check = await pool.query("SELECT quantity, version FROM stocks WHERE id = $1", [id]);
      if (!check.rows.length) return res.status(404).json({ error: "Item not found" });
      if (check.rows[0].version !== version) return res.status(409).json({ error: "Version conflict, retry" });
      return res.status(422).json({ error: "Insufficient stock" });
    }

    await invalidateCache(id);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Deduction failed" });
  }
});

// ─── PUT update stock ─────────────────────────────────────────
app.put("/api/stocks/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const qty = parseInt(req.body.quantity);
  if (isNaN(qty) || qty < 0) return res.status(400).json({ error: "quantity must be a non-negative integer" });

  try {
    const result = await pool.query(
      "UPDATE stocks SET quantity = $1, version = version + 1 WHERE id = $2 RETURNING id, name, quantity",
      [qty, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    await invalidateCache(id);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to update stock" });
  }
});

// ─── DELETE stock ─────────────────────────────────────────────
app.delete("/api/stocks/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const result = await pool.query("DELETE FROM stocks WHERE id = $1 RETURNING id", [id]);
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    await invalidateCache(id);
    res.json({ message: "Item deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete stock" });
  }
});

// ─── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ stock-service running on port ${PORT}`);
  });
}).catch((err) => {
  console.error("❌ Failed to init DB:", err);
  process.exit(1);
});